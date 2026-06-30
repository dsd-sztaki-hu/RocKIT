/**
 * Tests for socket daemon lifecycle control.
 */

const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const SHUTDOWN_CONTROL_MESSAGE = 'ROCKIT_ROCRATE_MCP_SHUTDOWN\n'

function getUnusedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = address && typeof address === 'object' ? address.port : undefined
      server.close(() => {
        if (typeof port === 'number') {
          resolve(port)
        } else {
          reject(new Error('Failed to allocate unused port'))
        }
      })
    })
    server.once('error', reject)
  })
}

function waitForOutput(child, pattern) {
  return new Promise((resolve, reject) => {
    child.__stderrText = child.__stderrText || ''
    if (!child.__stderrCollectorAttached) {
      child.__stderrCollectorAttached = true
      child.stderr.on('data', (chunk) => {
        child.__stderrText += chunk.toString('utf8')
      })
    }
    if (child.__stderrText.includes(pattern)) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for output: ${pattern}`))
    }, 5000)
    const onData = (chunk) => {
      const nextText = child.__stderrText + chunk.toString('utf8')
      if (nextText.includes(pattern)) {
        clearTimeout(timer)
        child.stderr.off('data', onData)
        resolve()
      }
    }
    child.stderr.on('data', onData)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      child.stderr.off('data', onData)
      reject(new Error(`Server exited early: code=${code} signal=${signal}`))
    })
  })
}

function waitForExitWithOutput(child, pattern) {
  return new Promise((resolve, reject) => {
    child.__stderrText = child.__stderrText || ''
    if (!child.__stderrCollectorAttached) {
      child.__stderrCollectorAttached = true
      child.stderr.on('data', (chunk) => {
        child.__stderrText += chunk.toString('utf8')
      })
    }
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Timed out waiting for exit output: ${pattern}`))
    }, 5000)
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (child.__stderrText.includes(pattern)) {
        resolve(code)
      } else {
        reject(
          new Error(
            `Server exited without expected output: ${pattern}\n${child.__stderrText}`,
          ),
        )
      }
    })
  })
}

function sendShutdown(socketPath) {
  return new Promise((resolve, reject) => {
    let response = ''
    const socket = net.createConnection(socketPath)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('Timed out waiting for shutdown response'))
    }, 5000)
    socket.once('connect', () => {
      socket.write(SHUTDOWN_CONTROL_MESSAGE)
    })
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8')
      if (response.includes('OK')) {
        clearTimeout(timer)
        socket.end()
        resolve()
      }
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Timed out waiting for server exit'))
    }, 5000)
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

async function run() {
  const serverPath = path.resolve(__dirname, '../lib/server.js')
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rocrate-mcp-socket-test-'))
  const dashboardPort = await getUnusedPort()
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\rocrate-mcp-socket-test-${process.pid}`
      : path.join(tempRoot, 'server.sock')

  const child = spawn(process.execPath, [serverPath, '--listen', socketPath], {
    env: {
      ...process.env,
      ROCRATE_DASHBOARD_ENABLED: 'true',
      ROCRATE_DASHBOARD_PORT: String(dashboardPort),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })

  try {
    await waitForOutput(child, `listening on ${socketPath}`)
    await waitForOutput(
      child,
      `Dashboard server listening on http://127.0.0.1:${dashboardPort}`,
    )

    if (process.platform !== 'win32') {
      const competingChild = spawn(process.execPath, [serverPath, '--listen', socketPath], {
        env: {
          ...process.env,
          ROCRATE_DASHBOARD_ENABLED: 'false',
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      const competingCode = await waitForExitWithOutput(
        competingChild,
        `socket already in use at ${socketPath}`,
      )
      assert.equal(competingCode, 1)
    }

    await sendShutdown(socketPath)
    const code = await waitForExit(child)
    assert.equal(code, 0)
    console.log('rocrate-mcp socket lifecycle test passed')
  } finally {
    if (!child.killed && child.exitCode === null) {
      child.kill()
    }
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})

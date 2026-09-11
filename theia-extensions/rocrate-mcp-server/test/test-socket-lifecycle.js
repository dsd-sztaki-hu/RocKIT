/**
 * Tests for socket daemon lifecycle control.
 */

const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const {
  shutdownRocrateMcpDaemon,
} = require('rockit-common/lib/node/rocrate-mcp-daemon-control')

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

function requestDashboardShutdown(port) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/daemon/shutdown',
        method: 'POST',
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          resolve({ status: res.statusCode, data })
        })
      },
    )
    req.on('error', reject)
    req.setTimeout(5000, () => {
      req.destroy()
      reject(new Error('Dashboard shutdown request timed out'))
    })
    req.end()
  })
}

function listen(server, socketPath) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()))
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
  let proxy
  let dashboardChild

  try {
    await waitForOutput(child, `listening on ${socketPath}`)
    await waitForOutput(
      child,
      `Dashboard server listening on http://127.0.0.1:${dashboardPort}`,
    )

    if (process.platform !== 'win32') {
      const competingChild = spawn(
        process.execPath,
        [serverPath, '--listen', socketPath],
        {
          env: {
            ...process.env,
            ROCRATE_DASHBOARD_ENABLED: 'false',
          },
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      )
      const competingCode = await waitForExitWithOutput(
        competingChild,
        `socket already in use at ${socketPath}`,
      )
      assert.equal(competingCode, 1)
    }

    proxy = spawn(process.execPath, [serverPath, '--connect', socketPath], {
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(proxy.exitCode, null)

    const shutdownResult = await shutdownRocrateMcpDaemon(socketPath)
    assert.deepEqual(shutdownResult, { status: 'stopped' })
    const code = await waitForExit(child)
    assert.equal(code, 0)
    const secondShutdownResult = await shutdownRocrateMcpDaemon(socketPath)
    assert.deepEqual(secondShutdownResult, { status: 'not-running' })

    const dashboardSocketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\rocrate-mcp-dashboard-test-${process.pid}`
        : path.join(tempRoot, 'dashboard.sock')
    const dashboardControlPort = await getUnusedPort()
    dashboardChild = spawn(
      process.execPath,
      [serverPath, '--listen', dashboardSocketPath],
      {
        env: {
          ...process.env,
          ROCRATE_DASHBOARD_ENABLED: 'true',
          ROCRATE_DASHBOARD_PORT: String(dashboardControlPort),
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    )
    await waitForOutput(dashboardChild, `listening on ${dashboardSocketPath}`)
    await waitForOutput(
      dashboardChild,
      `Dashboard server listening on http://127.0.0.1:${dashboardControlPort}`,
    )
    const dashboardShutdownResp = await requestDashboardShutdown(dashboardControlPort)
    assert.equal(dashboardShutdownResp.status, 202)
    assert.deepEqual(JSON.parse(dashboardShutdownResp.data), {
      success: true,
      status: 'shutting-down',
    })
    assert.equal(await waitForExit(dashboardChild), 0)
    dashboardChild = undefined

    const unresponsiveSocketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\rocrate-mcp-unresponsive-${process.pid}`
        : path.join(tempRoot, 'unresponsive.sock')
    const unresponsiveServer = net.createServer((socket) => {
      socket.on('data', () => {})
    })
    await listen(unresponsiveServer, unresponsiveSocketPath)
    try {
      const failedShutdownResult = await shutdownRocrateMcpDaemon(
        unresponsiveSocketPath,
        { requestTimeoutMs: 100, waitTimeoutMs: 100, pollIntervalMs: 25 },
      )
      assert.equal(failedShutdownResult.status, 'failed')
      assert.equal(unresponsiveServer.listening, true)
    } finally {
      await closeServer(unresponsiveServer)
    }
    console.log('rocrate-mcp socket lifecycle test passed')
  } finally {
    if (proxy && !proxy.killed && proxy.exitCode === null) {
      proxy.kill()
    }
    if (!child.killed && child.exitCode === null) {
      child.kill()
    }
    if (dashboardChild && !dashboardChild.killed && dashboardChild.exitCode === null) {
      dashboardChild.kill()
    }
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})

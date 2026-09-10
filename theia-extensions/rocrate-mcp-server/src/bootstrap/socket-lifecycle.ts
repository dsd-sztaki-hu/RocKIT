import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'
import { ROCRATE_MCP_SHUTDOWN_CONTROL_MESSAGE } from 'rockit-common/lib/common/rocrate-mcp-config'

type SocketLifecycleOptions = {
  execPath: string
  serverScriptPath?: string
  stdin: NodeJS.ReadableStream
  stdout: NodeJS.WritableStream
  stderr: NodeJS.WritableStream
  onSocketConnection: (socket: net.Socket, socketPath: string) => void
}

export function parseSocketPathFromArgs(
  args: string[],
  flag: string,
): string | undefined {
  const index = args.indexOf(flag)
  if (index < 0) {
    return undefined
  }
  const value = args[index + 1]
  if (!value || value.trim() === '') {
    return undefined
  }
  return value.trim()
}

function isWindowsNamedPipe(socketPath: string): boolean {
  return process.platform === 'win32' && socketPath.startsWith('\\\\.\\pipe\\')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function canConnectToSocket(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createConnection(socketPath)
    probe.once('connect', () => {
      probe.end()
      resolve(true)
    })
    probe.once('error', () => {
      probe.destroy()
      resolve(false)
    })
  })
}

function isTransientSocketConnectError(error: unknown): boolean {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined
  return code === 'ENOENT' || code === 'ECONNREFUSED'
}

async function ensureDaemon(
  socketPath: string,
  options: SocketLifecycleOptions,
): Promise<void> {
  const alreadyRunning = await canConnectToSocket(socketPath)
  if (alreadyRunning) {
    return
  }
  if (!options.serverScriptPath) {
    throw new Error('Cannot resolve server script path for daemon startup.')
  }
  const child = spawn(
    options.execPath,
    [options.serverScriptPath, '--listen', socketPath],
    {
      detached: true,
      stdio: 'ignore',
    },
  )
  child.unref()

  const maxAttempts = 20
  const waitMs = 100
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    const running = await canConnectToSocket(socketPath)
    if (running) {
      return
    }
  }
  throw new Error(`Daemon startup timeout: socket not ready at ${socketPath}`)
}

async function startSocketDaemon(
  socketPath: string,
  options: SocketLifecycleOptions,
): Promise<void> {
  if (!isWindowsNamedPipe(socketPath)) {
    const parent = path.dirname(socketPath)
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true })
    }
  }
  if (!isWindowsNamedPipe(socketPath) && fs.existsSync(socketPath)) {
    if (await canConnectToSocket(socketPath)) {
      options.stderr.write(
        `rocrate-mcp-server: socket already in use at ${socketPath}; refusing to replace a running daemon\n`,
      )
      process.exitCode = 1
      return
    }
    try {
      fs.unlinkSync(socketPath)
    } catch {
      // stale socket cleanup is best effort
    }
  }
  const activeSockets = new Set<net.Socket>()
  let shutdownStarted = false
  const shutdownControlMessage = Buffer.from(ROCRATE_MCP_SHUTDOWN_CONTROL_MESSAGE, 'utf8')
  const server = net.createServer((socket) => {
    activeSockets.add(socket)
    socket.once('close', () => activeSockets.delete(socket))
    let handedOff = false
    let firstData = Buffer.alloc(0)
    const handOffToMcp = (chunk?: Buffer) => {
      if (handedOff) {
        return
      }
      handedOff = true
      socket.off('data', onFirstData)
      socket.off('end', onProbeEnd)
      if (chunk) {
        socket.unshift(chunk)
      }
      options.onSocketConnection(socket, socketPath)
    }
    const shutdown = () => {
      if (shutdownStarted) {
        return
      }
      shutdownStarted = true
      const exitTimer = setTimeout(() => process.exit(0), 2000)
      exitTimer.unref()
      socket.end('OK\n')
      for (const activeSocket of activeSockets) {
        if (activeSocket !== socket) {
          activeSocket.end()
        }
      }
      server.close(() => {
        clearTimeout(exitTimer)
        process.exit(0)
      })
    }
    const onFirstData = (chunk: Buffer) => {
      firstData = Buffer.concat([firstData, chunk])
      if (
        firstData.length < shutdownControlMessage.length &&
        shutdownControlMessage.subarray(0, firstData.length).equals(firstData)
      ) {
        return
      }
      if (
        firstData
          .subarray(0, shutdownControlMessage.length)
          .equals(shutdownControlMessage)
      ) {
        shutdown()
        return
      }
      handOffToMcp(firstData)
    }
    const onProbeEnd = () => {
      socket.destroy()
    }
    socket.once('data', onFirstData)
    socket.once('end', onProbeEnd)
  })
  server.on('error', (error) => {
    options.stderr.write(
      `rocrate-mcp-server: socket daemon error: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
  server.listen(socketPath, () => {
    options.stderr.write(`rocrate-mcp-server: listening on ${socketPath}\n`)
  })
}

async function startSocketProxy(
  socketPath: string,
  options: SocketLifecycleOptions,
): Promise<void> {
  const connectOnce = (): Promise<net.Socket> =>
    new Promise((resolve, reject) => {
      const socket = net.createConnection(socketPath)
      socket.once('connect', () => {
        resolve(socket)
      })
      socket.once('error', (error) => {
        socket.destroy()
        reject(error)
      })
    })

  const connectWithRetry = async (
    attempts: number,
    waitMs: number,
  ): Promise<net.Socket> => {
    let lastError: unknown
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await connectOnce()
      } catch (error) {
        lastError = error
        if (!isTransientSocketConnectError(error) || attempt === attempts - 1) {
          break
        }
        await sleep(waitMs)
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  try {
    let socket: net.Socket
    try {
      socket = await connectWithRetry(8, 100)
    } catch (error) {
      if (!isTransientSocketConnectError(error)) {
        throw error
      }
      await ensureDaemon(socketPath, options)
      socket = await connectWithRetry(20, 100)
    }
    options.stdin.pipe(socket)
    socket.pipe(options.stdout)
    socket.on('error', () => {
      // Forwarding errors are surfaced by MCP client timeouts/stdio closure.
    })
  } catch (error) {
    options.stderr.write(
      `rocrate-mcp-server: proxy connection failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}

/**
 * Handles daemon/proxy socket modes from CLI args.
 * Returns true when one of the socket modes was executed.
 */
export async function handleSocketLifecycleArgs(
  args: string[],
  options: SocketLifecycleOptions,
): Promise<boolean> {
  const ensureSocketPath = parseSocketPathFromArgs(args, '--ensure-daemon')
  if (ensureSocketPath) {
    await ensureDaemon(ensureSocketPath, options)
    return true
  }

  const listenSocketPath = parseSocketPathFromArgs(args, '--listen')
  if (listenSocketPath) {
    await startSocketDaemon(listenSocketPath, options)
    return true
  }

  const connectSocketPath = parseSocketPathFromArgs(args, '--connect')
  if (connectSocketPath) {
    await startSocketProxy(connectSocketPath, options)
    return true
  }

  return false
}

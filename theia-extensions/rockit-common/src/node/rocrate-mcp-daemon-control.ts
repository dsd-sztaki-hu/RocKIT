// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import * as net from 'node:net'
import { ROCRATE_MCP_SHUTDOWN_CONTROL_MESSAGE } from '../common/rocrate-mcp-config'

const DEFAULT_REQUEST_TIMEOUT_MS = 1000
const DEFAULT_WAIT_TIMEOUT_MS = 5000
const DEFAULT_POLL_INTERVAL_MS = 100

export type RocrateMcpDaemonShutdownResult =
  | { status: 'not-running' }
  | { status: 'stopped' }
  | { status: 'failed'; reason: string }

export type RocrateMcpDaemonShutdownOptions = {
  requestTimeoutMs?: number
  waitTimeoutMs?: number
  pollIntervalMs?: number
}

type ShutdownRequestResult = {
  connected: boolean
  acknowledged: boolean
  error?: unknown
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return undefined
  }
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isSocketAbsentError(error: unknown): boolean {
  return getErrorCode(error) === 'ENOENT' || getErrorCode(error) === 'ECONNREFUSED'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function probeRocrateMcpDaemon(socketPath: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const socket = net.createConnection(socketPath)
    let timer: NodeJS.Timeout | undefined

    const finish = (running: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer) {
        clearTimeout(timer)
      }
      socket.destroy()
      resolve(running)
    }

    timer = setTimeout(() => finish(false), timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('close', () => finish(false))
  })
}

function requestRocrateMcpDaemonShutdown(
  socketPath: string,
  timeoutMs: number,
): Promise<ShutdownRequestResult> {
  return new Promise((resolve) => {
    let settled = false
    let connected = false
    let acknowledged = false
    let response = ''
    let error: unknown
    const socket = net.createConnection(socketPath)
    let timer: NodeJS.Timeout | undefined

    const finish = (): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer) {
        clearTimeout(timer)
      }
      socket.destroy()
      resolve({ connected, acknowledged, error })
    }

    socket.once('connect', () => {
      connected = true
      socket.write(ROCRATE_MCP_SHUTDOWN_CONTROL_MESSAGE)
    })
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8')
      if (response.trim() === 'OK') {
        acknowledged = true
        socket.end()
      }
    })
    socket.once('error', (socketError) => {
      error = socketError
      finish()
    })
    socket.once('close', finish)
    timer = setTimeout(() => finish(), timeoutMs)
  })
}

export function isRocrateMcpDaemonAvailable(
  socketPath: string,
  timeoutMs = DEFAULT_POLL_INTERVAL_MS,
): Promise<boolean> {
  return probeRocrateMcpDaemon(socketPath, timeoutMs)
}

async function waitForRocrateMcpDaemonStopped(
  socketPath: string,
  options: Required<
    Pick<RocrateMcpDaemonShutdownOptions, 'waitTimeoutMs' | 'pollIntervalMs'>
  >,
): Promise<boolean> {
  const deadline = Date.now() + options.waitTimeoutMs
  do {
    if (!(await probeRocrateMcpDaemon(socketPath, options.pollIntervalMs))) {
      return true
    }
    if (Date.now() >= deadline) {
      return false
    }
    await sleep(options.pollIntervalMs)
  } while (Date.now() < deadline)

  return !(await probeRocrateMcpDaemon(socketPath, options.pollIntervalMs))
}

/**
 * Requests the RO-Crate MCP daemon to stop through its Unix socket or Windows
 * named pipe. It deliberately does not terminate processes by PID or name.
 */
export async function shutdownRocrateMcpDaemon(
  socketPath: string,
  options: RocrateMcpDaemonShutdownOptions = {},
): Promise<RocrateMcpDaemonShutdownResult> {
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const request = await requestRocrateMcpDaemonShutdown(socketPath, requestTimeoutMs)

  if (!request.connected) {
    if (!request.error || isSocketAbsentError(request.error)) {
      return { status: 'not-running' }
    }
    return {
      status: 'failed',
      reason: `could not connect to ${socketPath}: ${getErrorMessage(request.error)}`,
    }
  }

  if (!request.acknowledged) {
    return {
      status: 'failed',
      reason: request.error
        ? `daemon did not acknowledge shutdown on ${socketPath}: ${getErrorMessage(request.error)}`
        : `daemon did not acknowledge shutdown on ${socketPath} within ${requestTimeoutMs} ms`,
    }
  }

  const stopped = await waitForRocrateMcpDaemonStopped(socketPath, {
    waitTimeoutMs,
    pollIntervalMs,
  })
  if (!stopped) {
    return {
      status: 'failed',
      reason: `daemon acknowledged shutdown but remained available at ${socketPath} for ${waitTimeoutMs} ms`,
    }
  }

  return { status: 'stopped' }
}

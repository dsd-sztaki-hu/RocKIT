// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import * as os from 'node:os'
import { resolveRocrateMcpSocketPath } from 'rockit-common/lib/common/rocrate-mcp-config'
import { shutdownRocrateMcpDaemon } from 'rockit-common/lib/node/rocrate-mcp-daemon-control'

function getSocketPath(): string {
  return resolveRocrateMcpSocketPath({
    homeDir: os.homedir(),
    platform: process.platform,
    socketPathOverride: process.env.ROCKIT_ROCRATE_MCP_SOCKET_PATH,
    username: process.env.USERNAME,
  })
}

export async function runShutdown(): Promise<number> {
  const socketPath = getSocketPath()
  const result = await shutdownRocrateMcpDaemon(socketPath)

  if (result.status === 'not-running') {
    return 0
  }
  if (result.status === 'stopped') {
    process.stderr.write(`rocrate-mcp-server: stopped existing daemon at ${socketPath}\n`)
    return 0
  }

  process.stderr.write(
    `rocrate-mcp-server: refusing to continue while the existing daemon is running: ${result.reason}\n`,
  )
  return 1
}

void runShutdown().then((exitCode) => {
  process.exitCode = exitCode
})

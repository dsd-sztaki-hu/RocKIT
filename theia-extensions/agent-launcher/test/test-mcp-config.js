// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  chooseMcpServerName,
  hasRememberedMcpSetting,
  mcpServerMatches,
  mcpServerUsesSocket,
  parseMcpServerEntries,
  rememberMcpKeepSetting,
} = require('../lib/electron-browser/mcp-config.js')

const socketPath = '/Users/balazs/.rockit/rocrate-mcp-server.sock'

test('detects a standalone Codex server that uses the shared socket', () => {
  const content = [
    '[mcp_servers.rocrate]',
    'command = "rocrate-mcp-server"',
    `args = ["--connect", "${socketPath}"]`,
    'startup_timeout_sec = 30',
    'env = { ROCRATE_MCP_DEFAULT_MODE = "local" }',
    '',
    '[mcp_servers.other]',
    'command = "other"',
    'args = []',
  ].join('\n')

  const entries = parseMcpServerEntries(content, 'toml', 'codex')
  assert.equal(entries.length, 2)
  assert.equal(entries[0].name, 'rocrate')
  assert.equal(mcpServerUsesSocket(entries[0], socketPath, false), true)
  assert.equal(
    mcpServerMatches(entries[0], 'rocrate-mcp-server', ['--connect', socketPath]),
    true,
  )
})

test('normalizes OpenCode command arrays and JSON MCP servers', () => {
  const openCodeEntries = parseMcpServerEntries(
    JSON.stringify({
      mcp: {
        rocrate: {
          command: ['rocrate-mcp-server', '--connect', socketPath],
        },
      },
    }),
    'json',
    'opencode',
  )
  const jsonEntries = parseMcpServerEntries(
    JSON.stringify({
      mcpServers: {
        rocrate: {
          command: 'rocrate-mcp-server',
          args: ['--connect', socketPath],
        },
      },
    }),
    'json',
    'gemini',
  )

  assert.equal(mcpServerUsesSocket(openCodeEntries[0], socketPath, false), true)
  assert.equal(mcpServerUsesSocket(jsonEntries[0], socketPath, false), true)
})

test('chooses a free alongside name', () => {
  assert.equal(chooseMcpServerName(['rocrate', 'rockitmcp', 'rockitmcp2']), 'rockitmcp3')
})

test('remembers keep decisions by exact configuration snapshot', () => {
  const originalContent = [
    '[mcp_servers.rocrate]',
    'command = "rocrate-mcp-server"',
    `args = ["--connect", "${socketPath}"]`,
    'startup_timeout_sec = 30',
    'env = { ROCRATE_MCP_DEFAULT_MODE = "local" }',
  ].join('\n')
  const [originalEntry] = parseMcpServerEntries(originalContent, 'toml', 'codex')
  assert.ok(originalEntry)
  const keptSetting = {
    agentId: 'codex',
    configPath: '/Users/balazs/.codex/config.toml',
    kind: 'toml',
    serverName: 'rocrate',
    signature: originalEntry.signature,
  }
  const stored = rememberMcpKeepSetting([], keptSetting)
  assert.equal(hasRememberedMcpSetting(stored, keptSetting), true)
  const [changedEntry] = parseMcpServerEntries(
    originalContent.replace(
      'ROCRATE_MCP_DEFAULT_MODE = "local"',
      'ROCRATE_MCP_DEFAULT_MODE = "remote"',
    ),
    'toml',
    'codex',
  )
  assert.ok(changedEntry)
  assert.notEqual(changedEntry.signature, originalEntry.signature)
  assert.equal(
    hasRememberedMcpSetting(stored, {
      ...keptSetting,
      signature: changedEntry.signature,
    }),
    false,
  )
})

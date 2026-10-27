// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  buildMcpConfigSection,
  discoverInstalledAgents,
  getInstallLaunchConfig,
  isConfirmationAccepted,
  installMcpConfig,
  parseInstallAgentId,
  prepareMcpConfig,
  upsertJsonMcpConfig,
  upsertTomlMcpConfig,
} = require('../lib/cli/install')

const launchConfig = getInstallLaunchConfig()
const expectedSocketPath =
  process.env.ROCKIT_ROCRATE_MCP_SOCKET_PATH ||
  (process.platform === 'win32'
    ? `\\\\.\\pipe\\rockit-rocrate-mcp-${process.env.USERNAME ?? 'user'}`
    : path.join(os.homedir(), '.rockit', 'rocrate-mcp-server.sock'))
const expectedCommand = process.env.ROCRATE_MCP_INSTALL_COMMAND || 'rocrate-mcp-server'
const expectedLocale = process.env.ROCRATE_DASHBOARD_LOCALE || 'en'

assert.deepEqual(launchConfig, {
  command: expectedCommand,
  args: ['--connect', expectedSocketPath],
  env: {
    ROCRATE_MCP_DEFAULT_MODE: 'local',
    ROCRATE_DASHBOARD_LOCALE: expectedLocale,
  },
})
assert.equal(parseInstallAgentId(['-i', 'codex']), 'codex')
assert.equal(parseInstallAgentId(['--install', 'gemini']), 'gemini')
assert.equal(parseInstallAgentId(['-i=codex']), 'codex')
assert.equal(parseInstallAgentId(['-i']), undefined)
assert.equal(isConfirmationAccepted(''), true)
assert.equal(isConfirmationAccepted('y'), true)
assert.equal(isConfirmationAccepted('yes'), true)
assert.equal(isConfirmationAccepted('n'), false)

const toml = upsertTomlMcpConfig(
  '[mcp_servers.other]\ncommand = "other"\n\n[mcp_servers.rocrate]\ncommand = "old"\n\n[mcp_servers.rocrate.tools.search]\napproval_mode = "approve"\n',
  launchConfig,
)
assert.match(toml, /\[mcp_servers\.other\]/)
assert.ok(toml.includes(`command = ${JSON.stringify(expectedCommand)}`))
const tomlArgs = toml.match(/^args = (\[.*\])$/m)
assert.ok(tomlArgs, 'TOML config should include connection arguments')
assert.deepEqual(JSON.parse(tomlArgs[1]), ['--connect', expectedSocketPath])
assert.match(toml, /\[mcp_servers\.rocrate\.tools\.search\]/)
assert.doesNotMatch(toml, /command = "old"/)

assert.equal(
  buildMcpConfigSection({ id: 'codex', configKind: 'toml' }, launchConfig),
  upsertTomlMcpConfig('', launchConfig),
)

const json = JSON.parse(
  upsertJsonMcpConfig(JSON.stringify({ existing: true }), 'gemini', launchConfig),
)
assert.equal(json.existing, true)
assert.deepEqual(json.mcpServers.rocrate, {
  command: expectedCommand,
  args: ['--connect', expectedSocketPath],
  env: {
    ROCRATE_MCP_DEFAULT_MODE: 'local',
    ROCRATE_DASHBOARD_LOCALE: expectedLocale,
  },
})

const opencode = JSON.parse(upsertJsonMcpConfig('{}', 'opencode', launchConfig))
const opencodeSection = JSON.parse(
  buildMcpConfigSection({ id: 'opencode', configKind: 'json' }, launchConfig),
)
assert.deepEqual(opencode.mcp.rocrate.command, [
  expectedCommand,
  '--connect',
  expectedSocketPath,
])
assert.equal(opencode.mcp.rocrate.type, 'local')
assert.equal(opencode.mcp.rocrate.enabled, true)
assert.deepEqual(opencodeSection, opencode)

const opencodeV2 = JSON.parse(
  upsertJsonMcpConfig(
    JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        servers: {
          existing: { type: 'local', command: ['existing-mcp'] },
        },
      },
    }),
    'opencode',
    launchConfig,
  ),
)
assert.deepEqual(opencodeV2.mcp.servers.rocrate.command, [
  expectedCommand,
  '--connect',
  expectedSocketPath,
])
assert.equal(opencodeV2.mcp.servers.rocrate.type, 'local')
assert.equal(opencodeV2.mcp.servers.rocrate.disabled, false)
assert.equal('enabled' in opencodeV2.mcp.servers.rocrate, false)
assert.deepEqual(opencodeV2.mcp.servers.existing, {
  type: 'local',
  command: ['existing-mcp'],
})

const opencodeV1NamedServers = JSON.parse(
  upsertJsonMcpConfig(
    JSON.stringify({
      mcp: { servers: { type: 'local', command: ['legacy-server'] } },
    }),
    'opencode',
    launchConfig,
  ),
)
assert.deepEqual(opencodeV1NamedServers.mcp.servers, {
  type: 'local',
  command: ['legacy-server'],
})
assert.equal(opencodeV1NamedServers.mcp.rocrate.enabled, true)

for (const agentId of ['claude', 'gemini', 'qwen', 'kilo', 'roo']) {
  const config = JSON.parse(upsertJsonMcpConfig('{}', agentId, launchConfig))
  assert.deepEqual(config.mcpServers.rocrate.args, launchConfig.args)
  assert.deepEqual(config.mcpServers.rocrate.env, launchConfig.env)
}

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rocrate-mcp-installer-'))
fs.mkdirSync(path.join(tempHome, '.codex'))
fs.mkdirSync(path.join(tempHome, '.opencode'))
const discovered = discoverInstalledAgents({
  homeDir: tempHome,
  pathValue: '',
  platform: 'win32',
})
const codex = discovered.find((agent) => agent.id === 'codex')
assert.ok(codex, 'Codex should be discovered from its marker directory')
assert.equal(codex.discoveredBy, 'marker')
assert.equal(codex.configPath, path.join(tempHome, '.codex', 'config.toml'))
const opencodeAgent = discovered.find((agent) => agent.id === 'opencode')
assert.ok(opencodeAgent, 'OpenCode should be discovered from its marker directory')
assert.equal(
  opencodeAgent.configPath,
  path.join(tempHome, '.config', 'opencode', 'opencode.json'),
)
const prepared = prepareMcpConfig(codex, launchConfig)
assert.equal(prepared.configPath, codex.configPath)
assert.equal(prepared.currentContent, '')
assert.equal(prepared.changed, true)
assert.equal(prepared.updatedContent, upsertTomlMcpConfig('', launchConfig))
assert.equal(installMcpConfig(codex, launchConfig).changed, true)
assert.ok(
  fs.readFileSync(codex.configPath, 'utf8').includes(`command = ${JSON.stringify(expectedCommand)}`),
)
assert.equal(installMcpConfig(codex, launchConfig).changed, false)
fs.rmSync(tempHome, { recursive: true, force: true })

console.log('rocrate-mcp installer test passed')

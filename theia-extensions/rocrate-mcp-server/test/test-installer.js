const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
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
  path.join(os.homedir(), '.rockit', 'rocrate-mcp-server.sock')
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
assert.match(toml, /command = "rocrate-mcp-server"/)
assert.match(toml, /args = \["--connect", ".*rocrate-mcp-server\.sock"\]/)
assert.match(toml, /\[mcp_servers\.rocrate\.tools\.search\]/)
assert.doesNotMatch(toml, /command = "old"/)

const json = JSON.parse(
  upsertJsonMcpConfig(JSON.stringify({ existing: true }), 'gemini', launchConfig),
)
assert.equal(json.existing, true)
assert.deepEqual(json.mcpServers.rocrate, {
  command: 'rocrate-mcp-server',
  args: ['--connect', expectedSocketPath],
  env: {
    ROCRATE_MCP_DEFAULT_MODE: 'local',
    ROCRATE_DASHBOARD_LOCALE: 'en',
  },
})

const opencode = JSON.parse(upsertJsonMcpConfig('{}', 'opencode', launchConfig))
assert.deepEqual(opencode.mcp.rocrate.command, [
  'rocrate-mcp-server',
  '--connect',
  expectedSocketPath,
])
assert.equal(opencode.mcp.rocrate.type, 'local')

for (const agentId of ['claude', 'gemini', 'qwen', 'kilo', 'roo']) {
  const config = JSON.parse(upsertJsonMcpConfig('{}', agentId, launchConfig))
  assert.deepEqual(config.mcpServers.rocrate.args, launchConfig.args)
  assert.deepEqual(config.mcpServers.rocrate.env, launchConfig.env)
}

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rocrate-mcp-installer-'))
fs.mkdirSync(path.join(tempHome, '.codex'))
const discovered = discoverInstalledAgents({
  homeDir: tempHome,
  pathValue: '',
  platform: 'win32',
})
const codex = discovered.find((agent) => agent.id === 'codex')
assert.ok(codex, 'Codex should be discovered from its marker directory')
assert.equal(codex.discoveredBy, 'marker')
assert.equal(codex.configPath, path.join(tempHome, '.codex', 'config.toml'))
const prepared = prepareMcpConfig(codex, launchConfig)
assert.equal(prepared.configPath, codex.configPath)
assert.equal(prepared.currentContent, '')
assert.equal(prepared.changed, true)
assert.equal(prepared.updatedContent, upsertTomlMcpConfig('', launchConfig))
assert.equal(installMcpConfig(codex, launchConfig).changed, true)
assert.match(fs.readFileSync(codex.configPath, 'utf8'), /command = "rocrate-mcp-server"/)
assert.equal(installMcpConfig(codex, launchConfig).changed, false)
fs.rmSync(tempHome, { recursive: true, force: true })

console.log('rocrate-mcp installer test passed')

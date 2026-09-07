const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  discoverInstalledAgents,
  getInstallLaunchConfig,
  installMcpConfig,
  upsertJsonMcpConfig,
  upsertTomlMcpConfig,
} = require('../lib/cli/install')

const launchConfig = getInstallLaunchConfig()

const toml = upsertTomlMcpConfig(
  '[mcp_servers.other]\ncommand = "other"\n\n[mcp_servers.rocrate]\ncommand = "old"\n\n[mcp_servers.rocrate.tools.search]\napproval_mode = "approve"\n',
  launchConfig,
)
assert.match(toml, /\[mcp_servers\.other\]/)
assert.match(toml, /command = "rocrate-mcp-server"/)
assert.match(toml, /\[mcp_servers\.rocrate\.tools\.search\]/)
assert.doesNotMatch(toml, /command = "old"/)

const json = JSON.parse(
  upsertJsonMcpConfig(
    JSON.stringify({ existing: true }),
    'gemini',
    launchConfig,
  ),
)
assert.equal(json.existing, true)
assert.deepEqual(json.mcpServers.rocrate, {
  command: 'rocrate-mcp-server',
  args: [],
  env: { ROCRATE_MCP_DEFAULT_MODE: 'local' },
})

const opencode = JSON.parse(upsertJsonMcpConfig('{}', 'opencode', launchConfig))
assert.deepEqual(opencode.mcp.rocrate.command, ['rocrate-mcp-server'])
assert.equal(opencode.mcp.rocrate.type, 'local')

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rocrate-mcp-installer-'))
fs.mkdirSync(path.join(tempHome, '.codex'))
const discovered = discoverInstalledAgents({ homeDir: tempHome, pathValue: '', platform: 'win32' })
const codex = discovered.find((agent) => agent.id === 'codex')
assert.ok(codex, 'Codex should be discovered from its marker directory')
assert.equal(codex.discoveredBy, 'marker')
assert.equal(codex.configPath, path.join(tempHome, '.codex', 'config.toml'))
assert.equal(installMcpConfig(codex, launchConfig).changed, true)
assert.match(fs.readFileSync(codex.configPath, 'utf8'), /command = "rocrate-mcp-server"/)
assert.equal(installMcpConfig(codex, launchConfig).changed, false)
fs.rmSync(tempHome, { recursive: true, force: true })

console.log('rocrate-mcp installer test passed')

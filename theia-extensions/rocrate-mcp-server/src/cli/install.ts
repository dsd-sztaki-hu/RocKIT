import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'

export type AgentConfigKind = 'toml' | 'json'

export type AgentSpec = {
  id: string
  displayName: string
  executables: readonly string[]
  markerPaths: readonly string[]
  configPath: string
  configKind: AgentConfigKind
}

export type DiscoveredAgent = AgentSpec & {
  executable?: string
  discoveredBy: 'executable' | 'marker'
}

export type InstallLaunchConfig = {
  command: string
  args: string[]
  env: Record<string, string>
}

type DiscoveryOptions = {
  homeDir?: string
  pathValue?: string
  platform?: NodeJS.Platform
}

const AGENT_DEFINITIONS = [
  {
    id: 'codex',
    displayName: 'Codex',
    executables: ['codex'],
    markerPaths: ['.codex'],
    config: { relativePath: ['.codex', 'config.toml'], kind: 'toml' as const },
  },
  {
    id: 'claude',
    displayName: 'Claude Code',
    executables: ['claude'],
    markerPaths: ['.claude'],
    config: { relativePath: ['.claude.json'], kind: 'json' as const },
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    executables: ['opencode'],
    markerPaths: ['.opencode'],
    config: { relativePath: ['.config', 'opencode', 'config.json'], kind: 'json' as const },
  },
  {
    id: 'kilo',
    displayName: 'Kilo Code',
    executables: ['kilo'],
    markerPaths: ['.kilo'],
    config: { relativePath: ['.kilo', 'config.json'], kind: 'json' as const },
  },
  {
    id: 'roo',
    displayName: 'Roo Code',
    executables: ['roo'],
    markerPaths: ['.roo'],
    config: { relativePath: ['.roo', 'config.json'], kind: 'json' as const },
  },
  {
    id: 'gemini',
    displayName: 'Gemini CLI',
    executables: ['gemini', 'gemini-cli'],
    markerPaths: ['.gemini'],
    config: { relativePath: ['.gemini', 'settings.json'], kind: 'json' as const },
  },
  {
    id: 'qwen',
    displayName: 'Qwen Code',
    executables: ['qwen-code', 'qwen'],
    markerPaths: ['.qwen', '.gemini'],
    config: { relativePath: ['.qwen', 'settings.json'], kind: 'json' as const },
  },
] as const

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function findExecutable(
  candidates: readonly string[],
  homeDir: string,
  pathValue: string,
  platform: NodeJS.Platform,
): string | undefined {
  const commonBinDirs =
    platform === 'win32'
      ? [path.join(homeDir, '.local', 'bin'), 'C:\\Program Files\\nodejs']
      : [path.join(homeDir, '.volta', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
  const directories = [...new Set([...pathValue.split(path.delimiter), ...commonBinDirs])].filter(
    (directory) => directory.length > 0,
  )
  const extensions = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']

  for (const directory of directories) {
    for (const candidate of candidates) {
      for (const extension of extensions) {
        const executablePath = path.join(directory, `${candidate}${extension}`)
        if (isFile(executablePath)) {
          return executablePath
        }
      }
    }
  }

  return undefined
}

export function discoverInstalledAgents(options: DiscoveryOptions = {}): DiscoveredAgent[] {
  const homeDir = options.homeDir ?? os.homedir()
  const platform = options.platform ?? process.platform
  const pathValue = options.pathValue ?? process.env.PATH ?? ''

  return AGENT_DEFINITIONS.flatMap((definition) => {
    const executable = findExecutable(
      definition.executables,
      homeDir,
      pathValue,
      platform,
    )
    const marker = definition.markerPaths.find((markerPath) =>
      fs.existsSync(path.join(homeDir, markerPath)),
    )
    if (!executable && !marker) {
      return []
    }

    return [
      {
        ...definition,
        configPath: path.join(homeDir, ...definition.config.relativePath),
        configKind: definition.config.kind,
        executable,
        discoveredBy: executable ? ('executable' as const) : ('marker' as const),
      },
    ]
  })
}

export function getInstallLaunchConfig(): InstallLaunchConfig {
  return {
    command: process.env.ROCRATE_MCP_INSTALL_COMMAND || 'rocrate-mcp-server',
    args: [],
    env: {
      ROCRATE_MCP_DEFAULT_MODE: 'local',
    },
  }
}

function toTomlBasicString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\u0008/g, '\\b')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\f/g, '\\f')
    .replace(/\r/g, '\\r')}"`
}

function toTomlInlineTable(values: Record<string, string>): string {
  return `{ ${Object.entries(values)
    .map(([key, value]) => `${key} = ${toTomlBasicString(value)}`)
    .join(', ')} }`
}

function buildTomlSnippet(launchConfig: InstallLaunchConfig): string {
  return [
    '[mcp_servers.rocrate]',
    `command = ${toTomlBasicString(launchConfig.command)}`,
    `args = [${launchConfig.args.map(toTomlBasicString).join(', ')}]`,
    'startup_timeout_sec = 30',
    `env = ${toTomlInlineTable(launchConfig.env)}`,
  ].join('\n')
}

export function upsertTomlMcpConfig(
  content: string,
  launchConfig: InstallLaunchConfig,
): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)
  if (lines.length === 1 && lines[0] === '') {
    lines.length = 0
  }

  const sectionStart = lines.findIndex((line) => line.trim() === '[mcp_servers.rocrate]')
  const snippetLines = buildTomlSnippet(launchConfig).split('\n')
  if (sectionStart >= 0) {
    let sectionEnd = sectionStart + 1
    while (sectionEnd < lines.length && !/^\s*\[/.test(lines[sectionEnd])) {
      sectionEnd += 1
    }
    lines.splice(sectionStart, sectionEnd - sectionStart, ...snippetLines)
  } else {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
      lines.push('')
    }
    lines.push(...snippetLines)
  }

  const result = lines.join(newline)
  return result.endsWith(newline) ? result : `${result}${newline}`
}

function toSerializableLaunchConfig(launchConfig: InstallLaunchConfig): {
  command: string
  args: string[]
  env: Record<string, string>
} {
  return {
    command: launchConfig.command,
    args: launchConfig.args,
    env: launchConfig.env,
  }
}

export function upsertJsonMcpConfig(
  content: string,
  agentId: string,
  launchConfig: InstallLaunchConfig,
): string {
  const parsed: Record<string, any> = content.trim() === '' ? {} : JSON.parse(content)
  if (agentId === 'opencode') {
    parsed.mcp = {
      ...(parsed.mcp || {}),
      rocrate: {
        type: 'local',
        enabled: true,
        command: [launchConfig.command, ...launchConfig.args],
        environment: launchConfig.env,
      },
    }
  } else {
    parsed.mcpServers = {
      ...(parsed.mcpServers || {}),
      rocrate: toSerializableLaunchConfig(launchConfig),
    }
  }
  return `${JSON.stringify(parsed, null, 2)}\n`
}

function writeFileAtomically(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  const mode = fs.existsSync(filePath) ? fs.statSync(filePath).mode & 0o777 : 0o600
  fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode })
  fs.renameSync(temporaryPath, filePath)
}

export function installMcpConfig(
  agent: DiscoveredAgent,
  launchConfig = getInstallLaunchConfig(),
): { changed: boolean; configPath: string } {
  const current = fs.existsSync(agent.configPath)
    ? fs.readFileSync(agent.configPath, 'utf8')
    : ''
  const updated =
    agent.configKind === 'toml'
      ? upsertTomlMcpConfig(current, launchConfig)
      : upsertJsonMcpConfig(current, agent.id, launchConfig)
  const changed = current !== updated
  if (changed) {
    writeFileAtomically(agent.configPath, updated)
  }
  return { changed, configPath: agent.configPath }
}

function agentSourceLabel(agent: DiscoveredAgent): string {
  return agent.discoveredBy === 'executable'
    ? `executable: ${agent.executable}`
    : 'configuration directory found'
}

export async function runInteractiveInstall(): Promise<number> {
  if (!stdin.isTTY || !stdout.isTTY) {
    process.stderr.write('rocrate-mcp-server -i requires an interactive terminal.\n')
    return 1
  }

  const agents = discoverInstalledAgents()
  if (agents.length === 0) {
    process.stdout.write(
      'No supported coding agents were detected. Supported agents: Codex, Claude Code, OpenCode, Kilo Code, Roo Code, Gemini CLI, and Qwen Code.\n',
    )
    return 1
  }

  process.stdout.write('Detected coding agents:\n\n')
  agents.forEach((agent, index) => {
    process.stdout.write(
      `  ${index + 1}) ${agent.displayName} (${agent.id}) — ${agentSourceLabel(agent)}\n`,
    )
  })
  process.stdout.write('  0) Cancel\n\n')

  const rl = createInterface({ input: stdin, output: stdout })
  try {
    const choice = await rl.question('Select an agent: ')
    const selectedIndex = Number.parseInt(choice.trim(), 10) - 1
    const selected = agents[selectedIndex]
    if (!selected) {
      process.stdout.write('Installation cancelled.\n')
      return 0
    }

    const launchConfig = getInstallLaunchConfig()
    process.stdout.write(
      `\nThis will add or update the "rocrate" MCP server in:\n${selected.configPath}\n\n` +
        `command: ${launchConfig.command}\n` +
        `mode: ${launchConfig.env.ROCRATE_MCP_DEFAULT_MODE}\n\n`,
    )
    const confirmation = await rl.question('Continue? [y/N] ')
    if (!/^y(?:es)?$/i.test(confirmation.trim())) {
      process.stdout.write('Installation cancelled.\n')
      return 0
    }

    const result = installMcpConfig(selected, launchConfig)
    process.stdout.write(
      result.changed
        ? `Installed rocrate-mcp-server for ${selected.displayName}. Restart the agent to load the new MCP configuration.\n`
        : `rocrate-mcp-server is already configured for ${selected.displayName}.\n`,
    )
    return 0
  } catch (error) {
    process.stderr.write(
      `Installation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 1
  } finally {
    rl.close()
  }
}

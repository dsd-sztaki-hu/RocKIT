// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { stdin, stdout } from 'node:process'
import { clearScreenDown, emitKeypressEvents, moveCursor } from 'node:readline'
import { createInterface } from 'node:readline/promises'
import { resolveRocrateMcpSocketPath } from 'rockit-common/lib/common/rocrate-mcp-config'

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
  discoveredBy: 'executable' | 'marker' | 'explicit'
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
    config: {
      relativePath: ['.config', 'opencode', 'config.json'],
      kind: 'json' as const,
    },
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
      : [
          path.join(homeDir, '.volta', 'bin'),
          '/opt/homebrew/bin',
          '/usr/local/bin',
          '/usr/bin',
        ]
  const directories = [
    ...new Set([...pathValue.split(path.delimiter), ...commonBinDirs]),
  ].filter((directory) => directory.length > 0)
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

type AgentDefinition = (typeof AGENT_DEFINITIONS)[number]

function createAgent(
  definition: AgentDefinition,
  homeDir: string,
  pathValue: string,
  platform: NodeJS.Platform,
  discoveredBy: DiscoveredAgent['discoveredBy'],
): DiscoveredAgent {
  return {
    id: definition.id,
    displayName: definition.displayName,
    executables: definition.executables,
    markerPaths: definition.markerPaths,
    configPath: path.join(homeDir, ...definition.config.relativePath),
    configKind: definition.config.kind,
    executable: findExecutable(definition.executables, homeDir, pathValue, platform),
    discoveredBy,
  }
}

export function discoverInstalledAgents(
  options: DiscoveryOptions = {},
): DiscoveredAgent[] {
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
      createAgent(
        definition,
        homeDir,
        pathValue,
        platform,
        executable ? 'executable' : 'marker',
      ),
    ]
  })
}

function resolveExplicitAgent(agentId: string): DiscoveredAgent | undefined {
  const normalizedId = agentId.trim().toLowerCase()
  const definition = AGENT_DEFINITIONS.find((candidate) => candidate.id === normalizedId)
  if (!definition) {
    return undefined
  }

  return createAgent(
    definition,
    os.homedir(),
    process.env.PATH ?? '',
    process.platform,
    'explicit',
  )
}

export function parseInstallAgentId(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '-i' || arg === '--install') {
      const value = args[index + 1]
      return value && !value.startsWith('-') ? value : undefined
    }
    for (const prefix of ['-i=', '--install=']) {
      if (arg.startsWith(prefix)) {
        const value = arg.slice(prefix.length).trim()
        return value === '' ? undefined : value
      }
    }
  }
  return undefined
}

function getInstallSocketPath(): string {
  return resolveRocrateMcpSocketPath({
    homeDir: os.homedir(),
    platform: process.platform,
    socketPathOverride: process.env.ROCKIT_ROCRATE_MCP_SOCKET_PATH,
    username: process.env.USERNAME,
  })
}

export function getInstallLaunchConfig(): InstallLaunchConfig {
  return {
    command: process.env.ROCRATE_MCP_INSTALL_COMMAND || 'rocrate-mcp-server',
    args: ['--connect', getInstallSocketPath()],
    env: {
      ROCRATE_MCP_DEFAULT_MODE: 'local',
      ROCRATE_DASHBOARD_LOCALE: process.env.ROCRATE_DASHBOARD_LOCALE || 'en',
    },
  }
}

function toTomlBasicString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .split(String.fromCharCode(8))
    .join('\\b')
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
  const parsed: Record<string, unknown> = content.trim() === '' ? {} : JSON.parse(content)
  const existingMcp =
    parsed.mcp && typeof parsed.mcp === 'object' && !Array.isArray(parsed.mcp)
      ? (parsed.mcp as Record<string, unknown>)
      : {}
  const existingMcpServers =
    parsed.mcpServers &&
    typeof parsed.mcpServers === 'object' &&
    !Array.isArray(parsed.mcpServers)
      ? (parsed.mcpServers as Record<string, unknown>)
      : {}
  if (agentId === 'opencode') {
    parsed.mcp = {
      ...existingMcp,
      rocrate: {
        type: 'local',
        enabled: true,
        command: [launchConfig.command, ...launchConfig.args],
        environment: launchConfig.env,
      },
    }
  } else {
    parsed.mcpServers = {
      ...existingMcpServers,
      rocrate: toSerializableLaunchConfig(launchConfig),
    }
  }
  return `${JSON.stringify(parsed, null, 2)}\n`
}

export function buildMcpConfigSection(
  agent: Pick<DiscoveredAgent, 'id' | 'configKind'>,
  launchConfig: InstallLaunchConfig,
): string {
  if (agent.configKind === 'toml') {
    return `${buildTomlSnippet(launchConfig)}\n`
  }
  return upsertJsonMcpConfig('{}', agent.id, launchConfig)
}

function writeFileAtomically(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  const mode = fs.existsSync(filePath) ? fs.statSync(filePath).mode & 0o777 : 0o600
  fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', mode })
  fs.renameSync(temporaryPath, filePath)
}

export type PreparedMcpConfig = {
  configPath: string
  currentContent: string
  updatedContent: string
  changed: boolean
}

export function prepareMcpConfig(
  agent: DiscoveredAgent,
  launchConfig = getInstallLaunchConfig(),
): PreparedMcpConfig {
  const currentContent = fs.existsSync(agent.configPath)
    ? fs.readFileSync(agent.configPath, 'utf8')
    : ''
  const updatedContent =
    agent.configKind === 'toml'
      ? upsertTomlMcpConfig(currentContent, launchConfig)
      : upsertJsonMcpConfig(currentContent, agent.id, launchConfig)
  return {
    configPath: agent.configPath,
    currentContent,
    updatedContent,
    changed: currentContent !== updatedContent,
  }
}

function installPreparedMcpConfig(prepared: PreparedMcpConfig): {
  changed: boolean
  configPath: string
} {
  const currentContent = fs.existsSync(prepared.configPath)
    ? fs.readFileSync(prepared.configPath, 'utf8')
    : ''
  if (currentContent !== prepared.currentContent) {
    throw new Error(
      `Configuration changed while awaiting confirmation: ${prepared.configPath}`,
    )
  }
  if (prepared.changed) {
    writeFileAtomically(prepared.configPath, prepared.updatedContent)
  }
  return { changed: prepared.changed, configPath: prepared.configPath }
}

export function installMcpConfig(
  agent: DiscoveredAgent,
  launchConfig = getInstallLaunchConfig(),
): { changed: boolean; configPath: string } {
  return installPreparedMcpConfig(prepareMcpConfig(agent, launchConfig))
}

function agentSourceLabel(agent: DiscoveredAgent): string {
  if (agent.discoveredBy === 'executable') {
    return `executable: ${agent.executable}`
  }
  if (agent.discoveredBy === 'marker') {
    return 'configuration directory found'
  }
  return agent.executable
    ? `explicit selection (executable: ${agent.executable})`
    : 'explicit selection'
}

async function selectAgentWithKeyboard(
  agents: readonly DiscoveredAgent[],
): Promise<DiscoveredAgent | undefined> {
  process.stdout.write(
    'Use ↑/↓ to select, Enter to confirm, or type a number followed by Enter.\n\n',
  )

  let selectedIndex = 0
  let renderedLines = 0
  const render = (): void => {
    if (renderedLines > 0) {
      moveCursor(stdout, 0, -renderedLines)
      clearScreenDown(stdout)
    }
    const lines = agents.map((agent, index) => {
      const marker = selectedIndex === index ? '>' : ' '
      return ` ${marker} ${index + 1}) ${agent.displayName} (${agent.id}) — ${agentSourceLabel(agent)}`
    })
    const cancelMarker = selectedIndex === agents.length ? '>' : ' '
    lines.push(` ${cancelMarker} 0) Cancel`)
    stdout.write(`${lines.join('\n')}\n`)
    renderedLines = lines.length
  }

  emitKeypressEvents(stdin)
  const wasRaw = stdin.isRaw === true
  stdin.setRawMode(true)
  stdin.resume()

  return new Promise((resolve) => {
    const cleanup = (): void => {
      stdin.off('keypress', onKeypress)
      stdin.setRawMode(wasRaw)
      stdin.pause()
      stdout.write('\n')
    }
    const finish = (): void => {
      cleanup()
      resolve(selectedIndex === agents.length ? undefined : agents[selectedIndex])
    }
    const onKeypress = (input: string, key: { name?: string; ctrl?: boolean }): void => {
      if (key.ctrl && key.name === 'c') {
        selectedIndex = agents.length
        finish()
        return
      }
      if (key.name === 'up') {
        selectedIndex = (selectedIndex + agents.length) % (agents.length + 1)
        render()
        return
      }
      if (key.name === 'down') {
        selectedIndex = (selectedIndex + 1) % (agents.length + 1)
        render()
        return
      }
      if (key.name === 'return' || key.name === 'enter') {
        finish()
        return
      }
      if (key.name === 'escape' || input.toLowerCase() === 'q') {
        selectedIndex = agents.length
        finish()
        return
      }
      if (/^[0-9]$/.test(input)) {
        const numericChoice = Number.parseInt(input, 10)
        if (numericChoice === 0) {
          selectedIndex = agents.length
          render()
        } else if (numericChoice <= agents.length) {
          selectedIndex = numericChoice - 1
          render()
        }
      }
    }

    stdin.on('keypress', onKeypress)
    render()
  })
}

function printConfigurationPreview(
  prepared: PreparedMcpConfig,
  configSection: string,
): void {
  const content = configSection.endsWith('\n') ? configSection : `${configSection}\n`
  const action = prepared.changed
    ? 'will be written'
    : 'is already present; no write is needed'
  process.stdout.write(
    `\nThe following MCP configuration section ${action} to:\n${prepared.configPath}\n\n` +
      '----- BEGIN MCP SECTION -----\n' +
      content +
      '----- END MCP SECTION -----\n\n',
  )
}

export function isConfirmationAccepted(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized === '' || normalized === 'y' || normalized === 'yes'
}

export async function runInteractiveInstall(requestedAgentId?: string): Promise<number> {
  if (!stdin.isTTY || !stdout.isTTY) {
    process.stderr.write('rocrate-mcp-server -i requires an interactive terminal.\n')
    return 1
  }

  const agents = discoverInstalledAgents()
  let selected: DiscoveredAgent | undefined
  if (requestedAgentId) {
    selected = resolveExplicitAgent(requestedAgentId)
    if (!selected) {
      process.stderr.write(
        `Unknown agent "${requestedAgentId}". Supported agent IDs: codex, claude, opencode, kilo, roo, gemini, qwen.\n`,
      )
      return 1
    }
    process.stdout.write(`Installing for ${selected.displayName} (${selected.id}).\n`)
  } else {
    if (agents.length === 0) {
      process.stdout.write(
        'No supported coding agents were detected. Supported agents: Codex, Claude Code, OpenCode, Kilo Code, Roo Code, Gemini CLI, and Qwen Code.\n',
      )
      return 1
    }
    process.stdout.write('Detected coding agents:\n\n')
    selected = await selectAgentWithKeyboard(agents)
    if (!selected) {
      process.stdout.write('Installation cancelled.\n')
      return 0
    }
  }

  const launchConfig = getInstallLaunchConfig()
  const configSection = buildMcpConfigSection(selected, launchConfig)
  let prepared: PreparedMcpConfig
  try {
    prepared = prepareMcpConfig(selected, launchConfig)
  } catch (error) {
    process.stderr.write(
      `Installation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 1
  }
  printConfigurationPreview(prepared, configSection)
  if (!prepared.changed) {
    return 0
  }

  const rl = createInterface({ input: stdin, output: stdout })
  try {
    const confirmation = await rl.question('Continue? [Y/n] ')
    if (!isConfirmationAccepted(confirmation)) {
      process.stdout.write('Installation cancelled.\n')
      return 0
    }

    const result = installPreparedMcpConfig(prepared)
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

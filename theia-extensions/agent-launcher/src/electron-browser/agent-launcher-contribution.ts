import {
  Command,
  CommandContribution,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
  SelectionService,
  URI,
} from '@theia/core'
import { ApplicationShell, CommonCommands, WidgetManager } from '@theia/core/lib/browser'
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs'
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables'
import { FileUri } from '@theia/core/lib/common/file-uri'
import { isWindows } from '@theia/core/lib/common/os'
import { UriAwareCommandHandler } from '@theia/core/lib/common/uri-command-handler'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service'
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { NavigatorContextMenu } from 'file-explorer/lib/browser/navigator-contribution'
import * as path from 'path'
import {
  getRocrateMcpServerPathCandidates,
  resolveAppProjectPathFromLocation,
  resolveRocrateMcpSocketPath,
} from '../../../aroma2-common/lib/common/rocrate-mcp-config'
import { NativeAgentProvider } from '../common/native-agent-protocol'
import { NativeAgentChatWidget } from './native-agent-chat-widget'

type AgentSpec = {
  id: string
  menuLabel: string
  executables: string[]
  markerPaths?: string[]
}

type AgentConfigKind = 'toml' | 'json'
type AgentMcpConfigSpec = {
  agentId: string
  configPath: string
  kind: AgentConfigKind
}

type RocrateMcpLaunchConfig = {
  command: string
  args: string[]
  env: Record<string, string>
  socketPath?: string
}

type AgentInstructionPort = {
  ensureAgentFiles(directoryUri: URI, agentId: string): Promise<void>
}

const AGENT_SPECS: AgentSpec[] = [
  {
    id: 'codex',
    menuLabel: 'Edit with Codex',
    executables: ['codex'],
    markerPaths: ['.codex'],
  },
  {
    id: 'claude',
    menuLabel: 'Edit with Claude',
    executables: ['claude'],
    markerPaths: ['.claude'],
  },
  {
    id: 'opencode',
    menuLabel: 'Edit with Opencode',
    executables: ['opencode'],
    markerPaths: ['.opencode'],
  },
  {
    id: 'kilo',
    menuLabel: 'Edit with Kilo',
    executables: ['kilo'],
    markerPaths: ['.kilo'],
  },
  { id: 'roo', menuLabel: 'Edit with Roo', executables: ['roo'], markerPaths: ['.roo'] },
  {
    id: 'gemini',
    menuLabel: 'Edit with Gemini',
    executables: ['gemini', 'gemini-cli'],
    markerPaths: ['.gemini'],
  },
  {
    id: 'qwen',
    menuLabel: 'Edit with Qwen',
    executables: ['qwen-code', 'qwen'],
    markerPaths: ['.qwen', '.gemini'],
  },
]

const sharedAvailableAgents = new Map<string, string>()
const AGENT_TERMINAL_ICON_CLASS = 'codicon codicon-hubot'

function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || !b || a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

function agentCommandId(agentId: string): string {
  return `openAgent.${agentId}`
}

function agentTerminalCommandId(agentId: string): string {
  return `openAgent.${agentId}.terminal`
}

function agentChatCommandId(agentId: string): string {
  return `openAgent.${agentId}.chat`
}

function supportsNativeChat(agentId: string): agentId is NativeAgentProvider {
  return agentId === 'codex' || agentId === 'claude'
}

function toSerializableLaunchConfig(launchConfig: RocrateMcpLaunchConfig): {
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

@injectable()
export class AgentLauncherContribution implements MenuContribution, CommandContribution {
  @inject(SelectionService) protected readonly selectionService: SelectionService
  @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService
  @inject(FileService) protected readonly fileService: FileService
  @inject(TerminalService) protected readonly terminalService: TerminalService
  @inject(EnvVariablesServer) protected readonly envVariablesServer: EnvVariablesServer
  @inject(WidgetManager) protected readonly widgetManager: WidgetManager
  @inject(ApplicationShell) protected readonly shell: ApplicationShell
  @inject('AgentInstructionService')
  protected readonly agentInstructionService: AgentInstructionPort

  protected homeDirPath: string | undefined

  @postConstruct()
  protected init(): void {
    void this.loadHomeDirPath()
    void this.detectAvailableAgents()
  }

  registerCommands(commands: CommandRegistry): void {
    for (const spec of AGENT_SPECS) {
      const command: Command = Command.toDefaultLocalizedCommand({
        id: agentCommandId(spec.id),
        category: CommonCommands.FILE_CATEGORY,
        label: spec.menuLabel,
      })
      commands.registerCommand(
        command,
        UriAwareCommandHandler.MonoSelect(this.selectionService, {
          execute: async (uri) => {
            await this.openAgentForUri(uri, spec.id)
          },
          isEnabled: (uri) =>
            !!this.workspaceService.getWorkspaceRootUri(uri) &&
            this.isAgentAvailableForMenu(spec),
          isVisible: (uri) =>
            !!this.workspaceService.getWorkspaceRootUri(uri) &&
            this.isAgentAvailableForMenu(spec),
        }),
      )

      const terminalCommand: Command = Command.toDefaultLocalizedCommand({
        id: agentTerminalCommandId(spec.id),
        category: CommonCommands.FILE_CATEGORY,
        label: 'Open in Terminal',
      })
      commands.registerCommand(
        terminalCommand,
        UriAwareCommandHandler.MonoSelect(this.selectionService, {
          execute: async (uri) => {
            await this.openAgentForUri(uri, spec.id)
          },
          isEnabled: (uri) =>
            !!this.workspaceService.getWorkspaceRootUri(uri) &&
            sharedAvailableAgents.has(spec.id),
          isVisible: (uri) =>
            supportsNativeChat(spec.id) &&
            !!this.workspaceService.getWorkspaceRootUri(uri) &&
            sharedAvailableAgents.has(spec.id),
        }),
      )

      if (supportsNativeChat(spec.id)) {
        const nativeAgentId = spec.id
        const chatCommand: Command = Command.toDefaultLocalizedCommand({
          id: agentChatCommandId(nativeAgentId),
          category: CommonCommands.FILE_CATEGORY,
          label: 'Chat in AROMA',
        })
        commands.registerCommand(
          chatCommand,
          UriAwareCommandHandler.MonoSelect(this.selectionService, {
            execute: async (uri) => {
              await this.openNativeChatForUri(uri, nativeAgentId)
            },
            isEnabled: (uri) =>
              !!this.workspaceService.getWorkspaceRootUri(uri) &&
              sharedAvailableAgents.has(spec.id),
            isVisible: (uri) =>
              !!this.workspaceService.getWorkspaceRootUri(uri) &&
              sharedAvailableAgents.has(spec.id),
          }),
        )
      }
    }
  }

  registerMenus(menus: MenuModelRegistry): void {
    for (const spec of AGENT_SPECS) {
      if (supportsNativeChat(spec.id)) {
        const submenu = [...NavigatorContextMenu.AGENTS, spec.id]
        menus.registerSubmenu(submenu, spec.menuLabel)
        menus.registerMenuAction(submenu, {
          commandId: agentChatCommandId(spec.id),
          label: 'Chat in AROMA',
          order: 'a',
        })
        menus.registerMenuAction(submenu, {
          commandId: agentTerminalCommandId(spec.id),
          label: 'Open in Terminal',
          order: 'b',
        })
        continue
      }
      menus.registerMenuAction(NavigatorContextMenu.AGENTS, {
        commandId: agentCommandId(spec.id),
        label: spec.menuLabel,
      })
    }
  }

  protected async openNativeChatForUri(
    uri: URI,
    agentId: NativeAgentProvider,
  ): Promise<void> {
    const directoryUri = await this.resolveDirectoryUri(uri)
    const cwd = FileUri.fsPath(directoryUri)
    const mcpReady = await this.ensureAgentMcpConfigured(agentId, directoryUri)
    if (!mcpReady) {
      return
    }
    await this.agentInstructionService.ensureAgentFiles(directoryUri, agentId)
    const widget = await this.widgetManager.getOrCreateWidget(NativeAgentChatWidget.ID, {
      instanceId: `${NativeAgentChatWidget.ID}:${agentId}:${Date.now().toString(36)}`,
      provider: agentId,
      cwd,
    })
    await this.shell.addWidget(widget, { area: 'right' })
    await this.shell.activateWidget(widget.id)
  }

  protected async openAgentForUri(uri: URI, agentId: string): Promise<void> {
    const directoryUri = await this.resolveDirectoryUri(uri)
    const cwd = FileUri.fsPath(directoryUri)
    const agentName = this.formatAgentName(agentId)
    const terminal = await this.terminalService.newTerminal({
      cwd,
      title: agentName,
      iconClass: AGENT_TERMINAL_ICON_CLASS,
    })
    this.terminalService.open(terminal, { mode: 'activate' })
    await terminal.start()
    await this.waitForTerminalOpen(terminal, 1000)
    this.setAgentTerminalStatus(terminal, agentId, 'Preparing...')

    const executable = await this.resolveAgentExecutable(agentId)
    if (!executable) {
      this.setAgentTerminalStatus(terminal, agentId, 'Executable not found')
      return
    }

    this.setAgentTerminalStatus(terminal, agentId, 'Checking MCP...')
    const mcpReady = await this.ensureAgentMcpConfigured(agentId, directoryUri)
    if (!mcpReady) {
      this.setAgentTerminalStatus(terminal, agentId, 'MCP setup cancelled/failed')
      return
    }

    this.setAgentTerminalStatus(terminal, agentId, 'Updating instructions...')
    await this.agentInstructionService.ensureAgentFiles(directoryUri, agentId)

    this.setAgentTerminalStatus(terminal, agentId, `Starting ${executable}...`)
    const launchArgs = this.buildAgentLaunchArgs(agentId, executable)
    try {
      await terminal.executeCommand({ cwd, args: launchArgs })
      this.setAgentTerminalStatus(terminal, agentId, 'Running')
    } catch {
      terminal.sendText(`${this.buildAgentFallbackCommand(agentId, executable)}\n`)
      this.setAgentTerminalStatus(terminal, agentId, 'Running')
    }
  }

  protected setAgentTerminalStatus(
    terminal: TerminalWidget,
    agentId: string,
    status: string,
  ): void {
    const name = this.formatAgentName(agentId)
    const label = `${name} - ${status}`
    terminal.title.label = label
    terminal.title.caption = label
    terminal.title.iconClass = AGENT_TERMINAL_ICON_CLASS
  }

  protected formatAgentName(agentId: string): string {
    return agentId.charAt(0).toUpperCase() + agentId.slice(1)
  }

  protected buildAgentLaunchArgs(agentId: string, executable: string): string[] {
    const args = this.buildRawAgentLaunchArgs(agentId, executable)
    if (isWindows) {
      return [
        'powershell.exe',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        this.buildWindowsAgentLifecycleCommand(args),
      ]
    }
    return ['bash', '-lc', this.buildUnixAgentLifecycleCommand(args)]
  }

  protected buildRawAgentLaunchArgs(agentId: string, executable: string): string[] {
    if (agentId === 'qwen') {
      return [executable, '--prompt-interactive', 'Hi!']
    }
    if (agentId === 'opencode') {
      return [executable]
    }
    return [executable, 'Hi!']
  }

  protected buildAgentFallbackCommand(agentId: string, executable: string): string {
    const args = this.buildRawAgentLaunchArgs(agentId, executable)
    if (isWindows) {
      return [
        'powershell.exe',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        this.quoteForWindowsCommand(this.buildWindowsAgentLifecycleCommand(args)),
      ].join(' ')
    }
    return `bash -lc ${this.quoteForBash(this.buildUnixAgentLifecycleCommand(args))}`
  }

  protected buildUnixAgentLifecycleCommand(args: string[]): string {
    const command = args.map((arg) => this.quoteForBash(arg)).join(' ')
    const cleanup =
      'cleanup() { if command -v pkill >/dev/null 2>&1; then pkill -TERM -P "$$" 2>/dev/null || true; fi; }'
    return [
      cleanup,
      'trap cleanup EXIT HUP INT TERM',
      command,
      'status=$?',
      'cleanup',
      'exit "$status"',
    ].join('; ')
  }

  protected quoteForBash(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`
  }

  protected buildWindowsAgentLifecycleCommand(args: string[]): string {
    const executable = this.quoteForPowerShell(args[0] ?? '')
    const agentArgs = args.slice(1).map((arg) => this.quoteForPowerShell(arg)).join(', ')
    const argumentList = agentArgs ? `@(${agentArgs})` : '@()'
    return [
      '$ErrorActionPreference = "SilentlyContinue"',
      `$agent = Start-Process -FilePath ${executable} -ArgumentList ${argumentList} -NoNewWindow -PassThru`,
      'function Stop-Agent {',
      'if ($script:agent -and -not $script:agent.HasExited) {',
      'taskkill.exe /PID $script:agent.Id /T /F | Out-Null',
      'Stop-Process -Id $script:agent.Id -Force',
      '}',
      '}',
      'try {',
      'while (-not $agent.WaitForExit(1000)) {}',
      'exit $agent.ExitCode',
      '} finally {',
      'Stop-Agent',
      '}',
    ].join('; ')
  }

  protected quoteForPowerShell(value: string): string {
    return `'${value.replace(/'/g, `''`)}'`
  }

  protected quoteForWindowsCommand(value: string): string {
    return `"${value.replace(/"/g, '\\"')}"`
  }

  protected async resolveDirectoryUri(uri: URI): Promise<URI> {
    const stat = await this.fileService.resolve(uri)
    return stat.isDirectory ? uri : uri.parent
  }

  protected async ensureAgentMcpConfigured(
    agentId: string,
    directoryUri: URI,
  ): Promise<boolean> {
    const cwd = FileUri.fsPath(directoryUri)
    const spec = this.resolveAgentMcpConfig(agentId, directoryUri)
    if (!spec) return false

    let launchConfig: RocrateMcpLaunchConfig
    try {
      launchConfig = await this.resolveRocrateMcpLaunchConfig()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      await new ConfirmDialog({ title: 'AROMA MCP Error', msg }).open()
      return false
    }
    if (agentId === 'claude') {
      return this.ensureClaudeMcpConfigured(directoryUri, launchConfig, cwd)
    }

    if (await this.isRocrateMcpConfigured(spec, launchConfig)) return true

    const snippet = this.buildRocrateMcpSnippet(spec, launchConfig)
    const accepted = await new ConfirmDialog({
      title: 'AROMA MCP Not Configured',
      msg: `AROMA MCP has not yet been configured for ${agentId}.\n\nConfig file: ${spec.configPath}\n\nAdd this configuration now?\n\n${snippet}`,
    }).open()

    if (!accepted) return false

    try {
      await this.writeRocrateMcpConfig(spec, launchConfig)
      return true
    } catch {
      return false
    }
  }

  protected resolveAgentMcpConfig(
    agentId: string,
    directoryUri: URI,
  ): AgentMcpConfigSpec | undefined {
    const home = this.resolveHomeDir(directoryUri)
    if (!home) return undefined
    const s = isWindows ? '\\' : '/'
    const configs: Record<string, { path: string; kind: AgentConfigKind }> = {
      codex: { path: `${home}${s}.codex${s}config.toml`, kind: 'toml' },
      claude: { path: `${home}${s}.claude.json`, kind: 'json' },
      opencode: { path: `${home}${s}.config${s}opencode${s}config.json`, kind: 'json' },
      kilo: { path: `${home}${s}.kilo${s}config.json`, kind: 'json' },
      roo: { path: `${home}${s}.roo${s}config.json`, kind: 'json' },
      gemini: { path: `${home}${s}.gemini${s}settings.json`, kind: 'json' },
      qwen: { path: `${home}${s}.qwen${s}settings.json`, kind: 'json' },
    }
    const cfg = configs[agentId]
    return cfg ? { agentId, configPath: cfg.path, kind: cfg.kind } : undefined
  }

  protected resolveHomeDir(directoryUri: URI): string | undefined {
    const candidates = this.getHomeDirs()
    if (candidates.length > 0) return candidates[0]
    const directoryPath = FileUri.fsPath(directoryUri)
    if (!isWindows) {
      const match = directoryPath.match(/^\/(Users|home)\/([^/]+)/)
      return match ? `/${match[1]}/${match[2]}` : undefined
    }
    const winMatch = directoryPath.match(/^[a-zA-Z]:\\Users\\[^\\]+/)
    return winMatch ? winMatch[0] : undefined
  }

  protected async isRocrateMcpConfigured(
    spec: AgentMcpConfigSpec,
    launchConfig: RocrateMcpLaunchConfig,
  ): Promise<boolean> {
    const configUri = FileUri.create(spec.configPath)
    if (!(await this.fileService.exists(configUri))) return false
    const content = await this.readTextFile(configUri)

    if (spec.kind === 'toml') {
      return (
        content.includes(`command = ${this.toTomlString(launchConfig.command)}`) &&
        content.includes(
          `args = [${launchConfig.args
            .map((arg) => this.toTomlString(arg))
            .join(', ')}]`,
        )
      )
    }
    try {
      const parsed = JSON.parse(content)
      if (spec.agentId === 'opencode') {
        const rocrate = parsed.mcp?.rocrate
        return (
          Array.isArray(rocrate?.command) &&
          arraysEqual(rocrate.command, [launchConfig.command, ...launchConfig.args])
        )
      }
      const rocrate = parsed.mcpServers?.rocrate
      return (
        rocrate?.command === launchConfig.command &&
        arraysEqual(rocrate?.args, launchConfig.args)
      )
    } catch {
      return false
    }
  }

  protected buildRocrateMcpSnippet(
    spec: AgentMcpConfigSpec,
    launchConfig: RocrateMcpLaunchConfig,
  ): string {
    if (spec.kind === 'toml') {
      return [
        '[mcp_servers.rocrate]',
        `command = ${this.toTomlString(launchConfig.command)}`,
        `args = [${launchConfig.args.map((arg) => this.toTomlString(arg)).join(', ')}]`,
        'startup_timeout_sec = 30',
        'env = { ROCRATE_MCP_DEFAULT_MODE = "local" }',
      ].join('\n')
    }
    if (spec.agentId === 'opencode') {
      return JSON.stringify(
        {
          mcp: {
            rocrate: {
              type: 'local',
              enabled: true,
              command: [launchConfig.command, ...launchConfig.args],
              environment: launchConfig.env,
            },
          },
        },
        null,
        2,
      )
    }
    return JSON.stringify(
      { mcpServers: { rocrate: toSerializableLaunchConfig(launchConfig) } },
      null,
      2,
    )
  }

  protected async resolveRocrateServerPath(): Promise<string> {
    const processEnv = (globalThis as any).process?.env
    const processPlatform =
      ((globalThis as any).process?.platform as NodeJS.Platform | undefined) ?? 'darwin'
    const runtime = this.getElectronRuntimePaths()
    const appProjectPath =
      this.normalizeFsPath(this.getEnvValue(processEnv, 'THEIA_APP_PROJECT_PATH')) ??
      this.resolveAppProjectPathFromLocation(
        typeof window === 'undefined' ? undefined : window.location.pathname,
      )
    const unique = this.getRocrateMcpServerPathCandidates({
      appProjectPath,
      resourcesPath: this.normalizeFsPath(runtime.resourcesPath),
      serverPathOverride: this.normalizeFsPath(
        this.getEnvValue(processEnv, 'AROMA_ROCRATE_MCP_SERVER_PATH'),
      ),
    }).map((candidate) => this.normalizeFsPath(candidate) ?? candidate)
    for (const candidate of unique) {
      if (await this.pathExists(candidate)) return candidate
    }
    throw new Error(`Server not found. Tried: ${unique.join(' | ')}`)
  }

  protected async resolveRocrateMcpLaunchConfig(): Promise<RocrateMcpLaunchConfig> {
    const nodeCommand = await this.findExecutableAbsolutePath(['node'])
    if (!nodeCommand) throw new Error('Node not found in PATH.')
    const serverPath = await this.resolveRocrateServerPath()
    const socketPath = this.resolveRocrateMcpSocketPath()
    return {
      command: nodeCommand,
      args: [serverPath, '--connect', socketPath],
      env: { ROCRATE_MCP_DEFAULT_MODE: 'local' },
      socketPath,
    }
  }

  protected resolveRocrateMcpSocketPath(): string {
    const env = (globalThis as any).process?.env
    const override = this.getEnvValue(env, 'AROMA_ROCRATE_MCP_SOCKET_PATH')
    if (override) return this.normalizeFsPath(override) ?? override
    if (isWindows) {
      const username = this.getEnvValue(env, 'USERNAME') ?? 'user'
      return `\\\\.\\pipe\\aroma-rocrate-mcp-${username}`
    }
    const processPlatform =
      ((globalThis as any).process?.platform as NodeJS.Platform | undefined) ?? 'darwin'
    const homeDirs = this.getHomeDirs()
    const base = this.joinFsPath(homeDirs.length > 0 ? homeDirs[0] : undefined, '.aroma') ?? '/tmp/aroma'
    return this.joinFsPath(base, 'rocrate-mcp-server.sock') ?? `${base}/rocrate-mcp-server.sock`
  }

    protected resolveRocrateMcpSocketPath(): string {
        const env = (globalThis as any).process?.env
        const processPlatform =
            ((globalThis as any).process?.platform as NodeJS.Platform | undefined) ?? 'darwin'
        const homeDirs = this.getHomeDirs()
        let override = this.getEnvValue(env, 'AROMA_ROCRATE_MCP_SOCKET_PATH')
        if (override) {
            override = this.normalizeFsPath(override) ?? override
        }
        if (isWindows) {
            const username = this.getEnvValue(env, 'USERNAME') ?? 'user'
            override = `\\\\.\\pipe\\aroma-rocrate-mcp-${username}`
        }
        return resolveRocrateMcpSocketPath({
            homeDir: homeDirs.length > 0 ? homeDirs[0] : this.homeDirPath,
            platform: processPlatform,
            socketPathOverride: override,
            username: env?.USERNAME,
        })
    }

    protected async writeRocrateMcpConfig(
    spec: AgentMcpConfigSpec,
    launchConfig: RocrateMcpLaunchConfig,
  ): Promise<void> {
    const configUri = FileUri.create(spec.configPath)
    await this.fileService.createFolder(configUri.parent)
    const exists = await this.fileService.exists(configUri)

    if (spec.kind === 'toml') {
      const snippet = this.buildRocrateMcpSnippet(spec, launchConfig)
      const content = exists ? await this.readTextFile(configUri) : ''
      const updated = content.includes('[mcp_servers.rocrate]')
        ? content.replace(/\[mcp_servers\.rocrate\][\s\S]*?(?=\n\[|$)/, snippet)
        : `${content}\n${snippet}`
      await this.fileService.write(configUri, updated)
      return
    }

    const content = exists ? await this.readTextFile(configUri) : '{}'
    const json = JSON.parse(content)
    if (spec.agentId === 'opencode') {
      json.mcp = {
        ...(json.mcp || {}),
        rocrate: {
          type: 'local',
          enabled: true,
          command: [launchConfig.command, ...launchConfig.args],
          environment: launchConfig.env,
        },
      }
    } else {
      json.mcpServers = {
        ...(json.mcpServers || {}),
        rocrate: toSerializableLaunchConfig(launchConfig),
      }
    }
    await this.fileService.write(configUri, JSON.stringify(json, null, 2))
  }

  protected async ensureClaudeMcpConfigured(
    directoryUri: URI,
    launchConfig: RocrateMcpLaunchConfig,
    cwd: string,
  ): Promise<boolean> {
    const home = this.resolveHomeDir(directoryUri)
    if (!home) {
      return false
    }
    if (await this.isClaudeMcpConfigured(home, launchConfig)) {
      return true
    }
    const claudeExecutable =
      (await this.findExecutableAbsolutePath(['claude'])) ?? 'claude'
    const payload = this.buildClaudeAddMcpPayload(launchConfig)
    const accepted = await new ConfirmDialog({
      title: 'AROMA MCP Not Configured',
      msg: [
        'AROMA MCP has not yet been configured for claude.',
        '',
        'AROMA will run:',
        'claude mcp add-json --scope user rocrate <payload>',
        '',
        `claude: ${claudeExecutable}`,
        `node: ${launchConfig.command}`,
        `server: ${launchConfig.args.join(' ')}`,
        '',
        'Add this configuration now?',
      ].join('\n'),
    }).open()
    if (!accepted) {
      return false
    }
    try {
      if (!isWindows) {
        await this.executeCommandArgs(
          cwd,
          [claudeExecutable, 'mcp', 'remove', '--scope', 'user', 'rocrate'],
          'claude.mcp.remove',
          true,
        )
      }
      await this.executeCommandArgs(
        cwd,
        [claudeExecutable, 'mcp', 'add-json', '--scope', 'user', 'rocrate', payload],
        'claude.mcp.add',
      )
      return this.waitForClaudeMcpConfigured(home, launchConfig)
    } catch {
      return false
    }
  }

  protected buildClaudeAddMcpPayload(launchConfig: RocrateMcpLaunchConfig): string {
    return JSON.stringify({
      type: 'stdio',
      command: launchConfig.command,
      args: launchConfig.args,
      env: launchConfig.env,
    })
  }

  protected async isClaudeMcpConfigured(
    homeDir: string,
    launchConfig: RocrateMcpLaunchConfig,
  ): Promise<boolean> {
    const candidates = [
      path.join(homeDir, '.claude.json'),
      path.join(homeDir, '.claude', '.mcp.json'),
    ]
    for (const candidate of candidates) {
      const uri = FileUri.create(candidate)
      if (!(await this.pathExists(candidate))) {
        continue
      }
      try {
        const parsed = JSON.parse(await this.readTextFile(uri))
        const rocrate =
          parsed?.mcpServers?.rocrate ??
          parsed?.mcp?.servers?.rocrate ??
          parsed?.servers?.rocrate
        if (
          rocrate?.command === launchConfig.command &&
          Array.isArray(rocrate?.args) &&
          arraysEqual(rocrate.args, launchConfig.args)
        ) {
          return true
        }
      } catch {}
    }
    return false
  }

  protected async waitForClaudeMcpConfigured(
    homeDir: string,
    launchConfig: RocrateMcpLaunchConfig,
  ): Promise<boolean> {
    const maxAttempts = 20
    const waitMs = 250
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const configured = await this.isClaudeMcpConfigured(homeDir, launchConfig)
      if (configured) {
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
    return false
  }

  protected async executeCommandArgs(
    cwd: string,
    args: string[],
    label: string,
    ignoreFailures = false,
  ): Promise<void> {
    const terminal = await this.terminalService.newTerminal({ cwd })
    await terminal.start()
    await this.waitForTerminalOpen(terminal, 2000)
    try {
      await terminal.executeCommand({ cwd, args })
    } catch (error) {
      if (!ignoreFailures) {
        console.warn('[agent-launcher] command.execute.error', {
          label,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    } finally {
      setTimeout(() => terminal.dispose(), 3000)
    }
  }

  protected async detectAvailableAgents(): Promise<void> {
    for (const spec of AGENT_SPECS) {
      const executable = await this.resolveAgentExecutable(spec.id)
      if (executable) {
        sharedAvailableAgents.set(spec.id, executable)
      }
    }
  }

  protected async resolveAgentExecutable(agentId: string): Promise<string | undefined> {
    const cached = sharedAvailableAgents.get(agentId)
    if (cached) return cached
    const spec = AGENT_SPECS.find((candidate) => candidate.id === agentId)
    if (!spec) return undefined
    const executable = await this.findExecutableInPath(spec.executables)
    if (executable) {
      sharedAvailableAgents.set(agentId, executable)
    }
    return executable
  }

  protected isAgentAvailableForMenu(spec: AgentSpec): boolean {
    if (sharedAvailableAgents.has(spec.id)) return true
    const executable = this.findExecutableInPathSync(spec.executables)
    if (executable) {
      sharedAvailableAgents.set(spec.id, executable)
      return true
    }
    return false
  }

  protected async findExecutableInPath(
    candidates: string[],
  ): Promise<string | undefined> {
    const abs = await this.findExecutableAbsolutePath(candidates)
    return abs ? path.basename(abs).replace(/\.(exe|cmd|bat)$/i, '') : undefined
  }

  protected findExecutableInPathSync(candidates: string[]): string | undefined {
    const abs = this.findExecutableAbsolutePathSync(candidates)
    return abs ? path.basename(abs).replace(/\.(exe|cmd|bat)$/i, '') : undefined
  }

  protected async findExecutableAbsolutePath(
    candidates: string[],
  ): Promise<string | undefined> {
    const local = this.findExecutableAbsolutePathSync(candidates)
    if (local) return local
    for (const full of this.getExecutablePathCandidates(candidates)) {
      if (await this.pathExists(full)) return full
    }
    return undefined
  }

  protected findExecutableAbsolutePathSync(candidates: string[]): string | undefined {
    for (const full of this.getExecutablePathCandidates(candidates)) {
      if (this.pathExistsSync(full)) return full
    }
    return undefined
  }

  protected getExecutablePathCandidates(candidates: string[]): string[] {
    const processEnv = (globalThis as any).process?.env
    const dirs = this.getExecutableSearchDirs(processEnv)
    const exts = this.getExecutableExtensions(processEnv)
    const paths: string[] = []

    for (const dir of dirs) {
      for (const candidate of candidates) {
        for (const ext of exts) {
          const alreadyHasExt = isWindows && path.extname(candidate) !== ''
          paths.push(path.join(dir, alreadyHasExt ? candidate : candidate + ext))
        }
      }
    }
    return paths
  }

  protected getExecutableSearchDirs(env: NodeJS.ProcessEnv | undefined): string[] {
    const pathValue = this.getEnvValue(env, 'PATH') ?? ''
    return [
      ...new Set(
        [
          ...pathValue.split(isWindows ? ';' : ':'),
          ...this.getRuntimeExecutableDirs(),
          ...this.getCommonBinDirs(),
        ]
          .map((dir) => this.normalizeExecutableSearchDir(dir))
          .filter((dir): dir is string => !!dir && this.isAbsoluteFsPath(dir)),
      ),
    ]
  }

  protected async hasAgentMarker(spec: AgentSpec): Promise<boolean> {
    if (!spec.markerPaths) return false
    const homes = this.getHomeDirs()
    for (const home of homes) {
      for (const marker of spec.markerPaths) {
        if (await this.pathExists(path.join(home, marker))) {
          return true
        }
      }
    }
    return false
  }

  protected hasAgentMarkerSync(spec: AgentSpec): boolean {
    if (!spec.markerPaths) return false
    const homes = this.getHomeDirs()
    for (const home of homes) {
      for (const marker of spec.markerPaths) {
        if (this.pathExistsSync(path.join(home, marker))) {
          return true
        }
      }
    }
    return false
  }

  protected getHomeDirs(): string[] {
    const env = (globalThis as any).process?.env
    return [
      this.homeDirPath,
      this.getEnvValue(env, 'HOME'),
      this.getEnvValue(env, 'USERPROFILE'),
    ].filter((value): value is string => !!value)
  }

  protected getElectronRuntimePaths(): { resourcesPath?: string; execPath?: string } {
    const processValue = (globalThis as any).process
    return {
      resourcesPath: processValue?.resourcesPath,
      execPath: processValue?.execPath,
    }
  }

  protected getEnvValue(
    env: NodeJS.ProcessEnv | undefined,
    name: string,
  ): string | undefined {
    if (!env) return undefined
    const direct = env[name]
    if (direct !== undefined) return direct
    const lower = name.toLowerCase()
    const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === lower)
    return key ? env[key] : undefined
  }

  protected getProcessPlatform(): NodeJS.Platform {
    const platform = (globalThis as any).process?.platform as NodeJS.Platform | undefined
    return isWindows ? 'win32' : platform ?? 'darwin'
  }

  protected normalizeFsPath(fsPath: string | undefined): string | undefined {
    if (!fsPath) return undefined
    if (isWindows && /^\/[a-zA-Z]:[\\/]/.test(fsPath)) {
      return fsPath.slice(1)
    }
    return fsPath
  }

  protected resolveAppProjectPathFromLocation(pathname: string | undefined): string | undefined {
    if (!pathname) return undefined
    let current = decodeURIComponent(pathname)
    current = this.normalizeFsPath(current) ?? current
    const separator = isWindows ? '\\' : '/'
    const parts = current.split(/[\\/]/).filter((part) => part.length > 0)
    while (parts.length > 0) {
      const candidate = isWindows ? parts.join(separator) : `${separator}${parts.join(separator)}`
      if (
        candidate.endsWith('electron-app') ||
        candidate.endsWith('browser-app') ||
        candidate.endsWith('aroma-2')
      ) {
        return candidate
      }
      parts.pop()
    }
    return undefined
  }

  protected getRocrateMcpServerPathCandidates(options: {
    appProjectPath?: string
    resourcesPath?: string
    serverPathOverride?: string
  }): string[] {
    const candidates: string[] = []
    if (options.serverPathOverride) candidates.push(options.serverPathOverride)
    if (options.appProjectPath) {
      const base =
        options.appProjectPath.endsWith('electron-app') ||
        options.appProjectPath.endsWith('browser-app')
          ? this.joinFsPath(options.appProjectPath, '..')
          : options.appProjectPath
      const candidate = this.joinFsPath(
        base,
        'theia-extensions',
        'rocrate-mcp-server',
        'lib',
        'server.js',
      )
      if (candidate) candidates.push(candidate)
    }
    if (options.resourcesPath) {
      for (const prefix of ['app', '']) {
        const candidate = this.joinFsPath(
          options.resourcesPath,
          prefix,
          'theia-extensions',
          'rocrate-mcp-server',
          'lib',
          'server.js',
        )
        if (candidate) candidates.push(candidate)
      }
    }
    return [
      ...new Set(
        candidates
          .map((candidate) => this.normalizeFsPath(candidate))
          .filter((candidate): candidate is string => !!candidate && this.isAbsoluteFsPath(candidate)),
      ),
    ]
  }

  protected joinFsPath(
    first: string | undefined,
    ...segments: string[]
  ): string | undefined {
    if (!first) return undefined
    const separator = isWindows ? '\\' : '/'
    const parts = [first, ...segments].filter((part) => part.length > 0)
    const resolved: string[] = []
    for (const part of parts.join(separator).split(/[\\/]/)) {
      if (!part || part === '.') continue
      if (part === '..') {
        resolved.pop()
        continue
      }
      resolved.push(part)
    }
    if (isWindows) {
      const root = /^[a-zA-Z]:$/.test(resolved[0] ?? '') ? `${resolved.shift()}\\` : ''
      return `${root}${resolved.join('\\')}`
    }
    return `/${resolved.join('/')}`
  }

  protected toTomlString(value: string): string {
    return `"${value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t')}"`
  }

  protected getExecutableExtensions(env: NodeJS.ProcessEnv | undefined): string[] {
    if (!isWindows) return ['']
    const configured = this.getEnvValue(env, 'PATHEXT')
      ?.split(';')
      .map((ext) => ext.trim().toLowerCase())
      .filter(Boolean)
    const exts = configured && configured.length > 0 ? configured : ['.exe', '.cmd', '.bat']
    return [...new Set([...exts, ''])]
  }

  protected normalizeExecutableSearchDir(dir: string | undefined): string | undefined {
    const normalized = dir?.trim().replace(/^"(.*)"$/, '$1')
    return normalized || undefined
  }

  protected isAbsoluteFsPath(fsPath: string): boolean {
    return isWindows ? /^[a-zA-Z]:[\\/]/.test(fsPath) || /^\\\\/.test(fsPath) : fsPath.startsWith('/')
  }

  protected getRuntimeExecutableDirs(): string[] {
    const processValue = (globalThis as any).process
    const runtime = this.getElectronRuntimePaths()
    return [processValue?.cwd?.(), runtime.execPath ? path.dirname(runtime.execPath) : undefined]
      .filter((value): value is string => !!value)
  }

  protected async loadHomeDirPath(): Promise<void> {
    try {
      const uri = await this.envVariablesServer.getHomeDirUri()
      if (uri) this.homeDirPath = new URI(uri).path.fsPath()
    } catch {}
  }

  protected getCommonBinDirs(): string[] {
    const home = this.getHomeDirs()[0]
    if (!isWindows) {
      return [
        home ? `${home}/.volta/bin` : '',
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
      ].filter(Boolean)
    }
    const localAppData = this.getEnvValue((globalThis as any).process?.env, 'LOCALAPPDATA')
    const appData = this.getEnvValue((globalThis as any).process?.env, 'APPDATA')
    return [
      home ? `${home}\\.local\\bin` : '',
      appData ? `${appData}\\npm` : '',
      localAppData ? `${localAppData}\\Programs\\nodejs` : '',
      'C:\\Program Files\\nodejs',
      'C:\\Program Files (x86)\\nodejs',
      'C:\\nvm4w\\nodejs',
    ].filter(Boolean)
  }

  protected async readTextFile(uri: URI): Promise<string> {
    return (await this.fileService.read(uri)).value.toString()
  }

    protected async pathExists(fsPath: string): Promise<boolean> {
        if (this.pathExistsSync(fsPath)) return true
        try {
            return await this.fileService.exists(FileUri.create(fsPath))
        } catch {
            return false
        }
    }

    protected pathExistsSync(fsPath: string): boolean {
        try {
            const nodeRequire = (globalThis as any).require ?? (window as any).require
            const fsModule = nodeRequire?.('fs') as { existsSync?: (path: string) => boolean } | undefined
            return fsModule?.existsSync?.(fsPath) ?? false
        } catch {
            return false
        }
    }

    protected waitForTerminalOpen(
    terminal: TerminalWidget,
    timeout: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeout)
      terminal.onDidOpen(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}

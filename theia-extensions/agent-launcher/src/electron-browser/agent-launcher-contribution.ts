// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import {
  Command,
  CommandContribution,
  CommandRegistry,
  MAIN_MENU_BAR,
  MenuContribution,
  MenuModelRegistry,
  SelectionService,
  URI,
  UriSelection,
} from '@theia/core'
import { ApplicationShell, CommonCommands, WidgetManager } from '@theia/core/lib/browser'
import {
  AbstractDialog,
  ConfirmDialog,
  DialogProps,
} from '@theia/core/lib/browser/dialogs'
import { StorageService } from '@theia/core/lib/browser/storage-service'
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables'
import { FileUri } from '@theia/core/lib/common/file-uri'
import { nls } from '@theia/core/lib/common/nls'
import { isWindows } from '@theia/core/lib/common/os'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service'
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import {
  getRocrateMcpServerPathCandidates,
  resolveAppProjectPathFromLocation,
  resolveRocrateMcpSocketPath,
} from 'rockit-common/lib/common/rocrate-mcp-config'
import {
  AROMA_AGENT_INSTRUCTIONS_COPY_TO_WORKSPACE,
  AgentLauncherPreferences,
} from '../common/agent-launcher-preferences'
import { NativeAgentProvider } from '../common/native-agent-protocol'
import type { McpKeepSetting, ParsedMcpServer } from './mcp-config'
import {
  chooseMcpServerName,
  forgetMcpKeepSetting,
  hasRememberedMcpSetting,
  mcpServerMatches,
  mcpServerUsesSocket,
  parseMcpServerEntries,
  rememberMcpKeepSetting,
} from './mcp-config'
import { NativeAgentChatWidget } from './native-agent-chat-widget'

type AgentSpec = {
  id: string
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

type RocrateMcpRuntime = {
  command: string
  env: Record<string, string>
}

type AgentInstructionPort = {
  ensureAgentFiles(directoryUri: URI, agentId: string): Promise<void>
}

type RocrateMcpConflictDecision = 'keep' | 'overwrite' | 'alongside'

const MCP_KEEP_SETTINGS_STORAGE_KEY = 'rockit:agent-launcher:kept-mcp-settings'

type RocrateMcpConflictDialogProps = DialogProps & {
  summary: string
  socketLabel: string
  socketPath: string
  questionTitle: string
  question: string
  overwriteTitle: string
  alongsideTitle: string
  overwriteSnippet: string
  alongsideSnippet: string
  keepLabel: string
  alongsideLabel: string
  overwriteLabel: string
}

class RocrateMcpConflictDialog extends AbstractDialog<RocrateMcpConflictDecision> {
  protected decision: RocrateMcpConflictDecision = 'keep'

  constructor(props: RocrateMcpConflictDialogProps) {
    super(props)
    this.contentNode.classList.add('rocrate-mcp-conflict-content')
    this.appendText('p', 'rocrate-mcp-conflict-summary', props.summary)

    const socket = this.node.ownerDocument.createElement('div')
    socket.className = 'rocrate-mcp-conflict-socket'
    const socketLabel = this.node.ownerDocument.createElement('span')
    socketLabel.className = 'rocrate-mcp-conflict-label'
    socketLabel.textContent = props.socketLabel
    const socketValue = this.node.ownerDocument.createElement('code')
    socketValue.textContent = props.socketPath
    socket.append(socketLabel, socketValue)
    this.contentNode.appendChild(socket)

    const question = this.node.ownerDocument.createElement('div')
    question.className = 'rocrate-mcp-conflict-question'
    const questionTitle = this.node.ownerDocument.createElement('div')
    questionTitle.className = 'rocrate-mcp-conflict-question-title'
    questionTitle.textContent = props.questionTitle
    const questionText = this.node.ownerDocument.createElement('div')
    questionText.className = 'rocrate-mcp-conflict-question-text'
    questionText.textContent = props.question
    question.append(questionTitle, questionText)
    this.contentNode.appendChild(question)

    this.appendCodeSection(props.overwriteTitle, props.overwriteSnippet)
    this.appendCodeSection(props.alongsideTitle, props.alongsideSnippet)

    this.appendChoiceButton(props.overwriteLabel, 'overwrite', false)
    this.appendChoiceButton(props.alongsideLabel, 'alongside', false)
    this.appendChoiceButton(props.keepLabel, 'keep', true)
  }

  get value(): RocrateMcpConflictDecision {
    return this.decision
  }

  protected appendChoiceButton(
    text: string,
    decision: RocrateMcpConflictDecision,
    primary: boolean,
  ): void {
    const button = primary
      ? this.appendAcceptButton(text)
      : this.appendButton(text, false)
    button.addEventListener('click', () => {
      this.decision = decision
      void this.accept()
    })
  }

  protected appendText(
    tagName: 'p',
    className: string,
    text: string,
  ): void {
    const element = this.node.ownerDocument.createElement(tagName)
    element.className = className
    element.textContent = text
    this.contentNode.appendChild(element)
  }

  protected appendCodeSection(title: string, snippet: string): void {
    const section = this.node.ownerDocument.createElement('section')
    section.className = 'rocrate-mcp-conflict-code-section'
    const heading = this.node.ownerDocument.createElement('div')
    heading.className = 'rocrate-mcp-conflict-code-title'
    heading.textContent = title
    const code = this.node.ownerDocument.createElement('pre')
    code.className = 'rocrate-mcp-conflict-code'
    code.textContent = snippet
    section.append(heading, code)
    this.contentNode.appendChild(section)
  }
}

const AGENT_SPECS: AgentSpec[] = [
  {
    id: 'codex',
    executables: ['codex'],
    markerPaths: ['.codex'],
  },
  {
    id: 'claude',
    executables: ['claude'],
    markerPaths: ['.claude'],
  },
  {
    id: 'opencode',
    executables: ['opencode'],
  },
  {
    id: 'kilo',
    executables: ['kilo'],
    markerPaths: ['.kilo'],
  },
  { id: 'roo', executables: ['roo'], markerPaths: ['.roo'] },
  {
    id: 'gemini',
    executables: ['gemini', 'gemini-cli'],
    markerPaths: ['.gemini'],
  },
  {
    id: 'qwen',
    executables: ['qwen-code', 'qwen'],
    markerPaths: ['.qwen', '.gemini'],
  },
]

const sharedAvailableAgents = new Map<string, string>()
const AGENT_TERMINAL_ICON_CLASS = 'codicon codicon-hubot'
const INSIDE_ROCKIT_AGENT_CONTEXT_PROMPT = [
  'You are launched from inside RocKIT.',
  '',
  'Before doing RO-Crate work, call the RO-Crate MCP tool `set_agent_session_context` with:',
  '{"launchContext":"inside_rockit","editorAlreadyOpen":true}',
  '',
  'Because RocKIT is already open for this session, do not suggest opening AROMA after edits.',
].join('\n')

const RO_CRATE_AI_MENU_PATH = [...MAIN_MENU_BAR, '4z_ro_crate', '4_ai']

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

function recordsEqual(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  if (!a || !b) {
    return false
  }
  const aEntries = Object.entries(a)
  const bEntries = Object.entries(b)
  if (aEntries.length !== bEntries.length) {
    return false
  }
  return aEntries.every(([key, value]) => b[key] === value)
}

function isMcpKeepSetting(value: unknown): value is McpKeepSetting {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.agentId === 'string' &&
    typeof candidate.configPath === 'string' &&
    (candidate.kind === 'toml' || candidate.kind === 'json') &&
    typeof candidate.serverName === 'string' &&
    typeof candidate.signature === 'string'
  )
}

function joinPlatformPath(base: string, ...segments: string[]): string {
  const separator = isWindows ? '\\' : '/'
  const normalizedBase = base.replace(/[\\/]+$/, '')
  const normalizedSegments = segments.map((segment) =>
    segment.replace(/^[\\/]+|[\\/]+$/g, ''),
  )
  return [normalizedBase, ...normalizedSegments].join(separator)
}

function basenamePlatformPath(value: string): string {
  return value.split(/[\\/]/).pop() ?? value
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isElectronRuntimePath(value: string | undefined): boolean {
  return !!value && (
    /(?:^|[\\/])electron(?:\.exe)?$/i.test(value) ||
    /[\\/]electron[\\/]dist[\\/]electron(?:\.exe)?$/i.test(value)
  )
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
  @inject(StorageService) protected readonly storageService: StorageService
  @inject(WidgetManager) protected readonly widgetManager: WidgetManager
  @inject(ApplicationShell) protected readonly shell: ApplicationShell
  @inject(AgentLauncherPreferences)
  protected readonly preferences: AgentLauncherPreferences
  @inject('AgentInstructionService')
  protected readonly agentInstructionService: AgentInstructionPort

  protected homeDirPath: string | undefined

  @postConstruct()
  protected init(): void {
    void this.initializeAgentDetection()
  }

  protected async initializeAgentDetection(): Promise<void> {
    await this.loadHomeDirPath()
    await this.detectAvailableAgents()
  }

  registerCommands(commands: CommandRegistry): void {
    for (const spec of AGENT_SPECS) {
      const command: Command = {
        id: agentCommandId(spec.id),
        category: nls.localizeByDefault(CommonCommands.FILE_CATEGORY),
        label: this.editWithAgentLabel(spec.id),
      }
      commands.registerCommand(
        command,
        {
          execute: async (uri?: URI) => {
            const targetUri = this.resolveAgentTargetUri(uri)
            if (targetUri) {
              await this.openAgentForUri(targetUri, spec.id)
            }
          },
          isEnabled: () => this.canOpenAgent(spec.id),
          isVisible: () => this.canOpenAgent(spec.id),
        },
      )

      const terminalCommand: Command = {
        id: agentTerminalCommandId(spec.id),
        category: nls.localizeByDefault(CommonCommands.FILE_CATEGORY),
        label: nls.localize('rockit/agentLauncher/openInTerminal', 'Open in Terminal'),
      }
      commands.registerCommand(
        terminalCommand,
        {
          execute: async (uri?: URI) => {
            const targetUri = this.resolveAgentTargetUri(uri)
            if (targetUri) {
              await this.openAgentForUri(targetUri, spec.id)
            }
          },
          isEnabled: () => this.canOpenAgent(spec.id),
          isVisible: () => supportsNativeChat(spec.id) && this.canOpenAgent(spec.id),
        },
      )

      if (supportsNativeChat(spec.id)) {
        const nativeAgentId = spec.id
        const chatCommand: Command = {
          id: agentChatCommandId(nativeAgentId),
          category: nls.localizeByDefault(CommonCommands.FILE_CATEGORY),
          label: nls.localize('rockit/agentLauncher/chatInRockit', 'Chat in RocKIT'),
        }
        commands.registerCommand(
          chatCommand,
          {
            execute: async (uri?: URI) => {
              const targetUri = this.resolveAgentTargetUri(uri)
              if (targetUri) {
                await this.openNativeChatForUri(targetUri, nativeAgentId)
              }
            },
            isEnabled: () => this.canOpenAgent(spec.id),
            isVisible: () => this.canOpenAgent(spec.id),
          },
        )
      }
    }
  }

  registerMenus(menus: MenuModelRegistry): void {
    for (const [index, spec] of AGENT_SPECS.entries()) {
      const orderPrefix = `a${String(index).padStart(2, '0')}`
      if (supportsNativeChat(spec.id)) {
        const agentMenuPath = [
          ...RO_CRATE_AI_MENU_PATH,
          `edit_with_${spec.id}`,
        ]
        menus.registerSubmenu(agentMenuPath, this.editWithAgentLabel(spec.id), {
          sortString: orderPrefix,
        })
        menus.registerMenuAction(agentMenuPath, {
          commandId: agentChatCommandId(spec.id),
          label: nls.localize('rockit/agentLauncher/inRockit', 'In RocKIT'),
          order: 'a',
        })
        menus.registerMenuAction(agentMenuPath, {
          commandId: agentTerminalCommandId(spec.id),
          label: nls.localize('rockit/agentLauncher/inTerminal', 'In terminal'),
          order: 'b',
        })
        continue
      }
      menus.registerMenuAction(RO_CRATE_AI_MENU_PATH, {
        commandId: agentCommandId(spec.id),
        label: this.editWithAgentLabel(spec.id),
        order: orderPrefix,
      })
    }
  }

  protected editWithAgentLabel(agentId: string): string {
    return nls.localize(
      'rockit/agentLauncher/editWithAgent',
      'Edit with {0}',
      this.formatAgentName(agentId),
    )
  }

  protected canOpenAgent(agentId: string): boolean {
    return (
      sharedAvailableAgents.has(agentId) &&
      this.workspaceService.tryGetRoots().length > 0
    )
  }

  protected resolveAgentTargetUri(explicitUri?: URI): URI | undefined {
    const selectedUri =
      explicitUri instanceof URI
        ? explicitUri
        : UriSelection.getUri(this.selectionService.selection)
    if (selectedUri) {
      const rootUri = this.workspaceService.getWorkspaceRootUri(selectedUri)
      if (rootUri) {
        return rootUri
      }
    }
    return this.workspaceService.tryGetRoots()[0]?.resource
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
    if (this.shouldCopyAgentInstructions()) {
      await this.agentInstructionService.ensureAgentFiles(directoryUri, agentId)
    }
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
    this.setAgentTerminalStatus(
      terminal,
      agentId,
      nls.localize('rockit/agentLauncher/preparing', 'Preparing...'),
    )

    const executable = sharedAvailableAgents.get(agentId)
    if (!executable) {
      this.setAgentTerminalStatus(
        terminal,
        agentId,
        nls.localize('rockit/agentLauncher/executableNotFound', 'Executable not found'),
      )
      return
    }

    this.setAgentTerminalStatus(
      terminal,
      agentId,
      nls.localize('rockit/agentLauncher/checkingMcp', 'Checking MCP...'),
    )
    const mcpReady = await this.ensureAgentMcpConfigured(agentId, directoryUri)
    if (!mcpReady) {
      this.setAgentTerminalStatus(
        terminal,
        agentId,
        nls.localize(
          'rockit/agentLauncher/mcpSetupFailed',
          'MCP setup cancelled/failed',
        ),
      )
      return
    }

    if (this.shouldCopyAgentInstructions()) {
      this.setAgentTerminalStatus(
        terminal,
        agentId,
        nls.localize(
          'rockit/agentLauncher/updatingInstructions',
          'Updating instructions...',
        ),
      )
      await this.agentInstructionService.ensureAgentFiles(directoryUri, agentId)
    } else {
      this.setAgentTerminalStatus(
        terminal,
        agentId,
        nls.localize(
          'rockit/agentLauncher/usingWorkflowDocs',
          'Using MCP workflow docs...',
        ),
      )
    }

    this.setAgentTerminalStatus(
      terminal,
      agentId,
      nls.localize('rockit/agentLauncher/startingAgent', 'Starting {0}...', executable),
    )
    const launchArgs = this.buildAgentLaunchArgs(agentId, executable)
    try {
      await terminal.executeCommand({ cwd, args: launchArgs })
      this.setAgentTerminalStatus(
        terminal,
        agentId,
        nls.localize('rockit/agentLauncher/running', 'Running'),
      )
    } catch {
      terminal.sendText(`${this.buildAgentFallbackCommand(agentId, executable)}\n`)
      this.setAgentTerminalStatus(
        terminal,
        agentId,
        nls.localize('rockit/agentLauncher/running', 'Running'),
      )
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

  protected shouldCopyAgentInstructions(): boolean {
    return this.preferences[AROMA_AGENT_INSTRUCTIONS_COPY_TO_WORKSPACE] === true
  }

  protected buildAgentLaunchArgs(agentId: string, executable: string): string[] {
    const args = this.buildRawAgentLaunchArgs(agentId, executable)
    if (isWindows) {
      return args
    }
    return ['bash', '-lc', this.buildUnixAgentLifecycleCommand(args)]
  }

  protected buildRawAgentLaunchArgs(agentId: string, executable: string): string[] {
    if (agentId === 'codex') {
      return [
        executable,
        '-c',
        `developer_instructions=${toTomlBasicString(INSIDE_ROCKIT_AGENT_CONTEXT_PROMPT)}`,
      ]
    }
    if (agentId === 'claude') {
      return [executable, '--append-system-prompt', INSIDE_ROCKIT_AGENT_CONTEXT_PROMPT]
    }
    return [executable]
  }

  protected buildAgentFallbackCommand(agentId: string, executable: string): string {
    const args = this.buildRawAgentLaunchArgs(agentId, executable)
    if (isWindows) {
      return args.map((arg) => this.quoteForWindowsCommand(arg)).join(' ')
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
      await new ConfirmDialog({
        title: nls.localize('rockit/agentLauncher/mcpErrorTitle', 'RocKIT MCP Error'),
        msg,
        ok: nls.localize('rockit/agentLauncher/close', 'Close'),
      }).open()
      return false
    }
    if (agentId === 'claude') {
      return this.ensureClaudeMcpConfigured(directoryUri, launchConfig, cwd, spec)
    }

    if (await this.isRocrateMcpConfigured(spec, launchConfig)) return true

    const entries = await this.readMcpConfigEntries(spec)
    const sameSocketConflict = this.findSameSocketConflict(entries, launchConfig)
    let serverName = 'rocrate'
    if (sameSocketConflict) {
      if (await this.hasRememberedMcpKeep(spec, sameSocketConflict)) {
        return true
      }
      const alternateName = chooseMcpServerName(entries.map((entry) => entry.name))
      const decision = await this.promptMcpSocketConflict(
        agentId,
        spec,
        launchConfig,
        sameSocketConflict,
        alternateName,
      )
      if (!decision) {
        return false
      }
      if (decision === 'keep') {
        await this.rememberMcpKeep(spec, sameSocketConflict)
        return true
      }
      await this.forgetMcpKeep(spec, sameSocketConflict)
      if (decision === 'alongside') {
        serverName = alternateName
      }
    } else {
      const snippet = this.buildRocrateMcpSnippet(spec, launchConfig)
      const accepted = await new ConfirmDialog({
        title: nls.localize(
          'rockit/agentLauncher/mcpNotConfiguredTitle',
          'RocKIT MCP Not Configured',
        ),
        msg: nls.localize(
          'rockit/agentLauncher/mcpNotConfiguredMessage',
          'RocKIT MCP has not yet been configured for {0}.\n\nConfig file: {1}\n\nAdd this configuration now?\n\n{2}',
          this.formatAgentName(agentId),
          spec.configPath,
          snippet,
        ),
        ok: nls.localize('rockit/agentLauncher/addConfiguration', 'Add Configuration'),
        cancel: nls.localize('rockit/common/cancel', 'Cancel'),
      }).open()

      if (!accepted) return false
    }

    try {
      await this.writeRocrateMcpConfig(spec, launchConfig, serverName)
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
    const entries = parseMcpServerEntries(content, spec.kind, spec.agentId)
    if (entries.length > 0) {
      return entries.some(
        (entry) =>
          mcpServerMatches(entry, launchConfig.command, launchConfig.args) &&
          (spec.kind !== 'toml' || recordsEqual(entry.env, launchConfig.env)),
      )
    }

    if (spec.kind === 'toml') {
      return (
        content.includes(`command = ${toTomlBasicString(launchConfig.command)}`) &&
        content.includes(
          `args = [${launchConfig.args.map((arg) => toTomlBasicString(arg)).join(', ')}]`,
        ) &&
        content.includes(`env = ${toTomlInlineTable(launchConfig.env)}`)
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

  protected async readMcpConfigEntries(
    spec: AgentMcpConfigSpec,
  ): Promise<ParsedMcpServer[]> {
    const configUri = FileUri.create(spec.configPath)
    if (!(await this.fileService.exists(configUri))) {
      return []
    }
    try {
      return parseMcpServerEntries(
        await this.readTextFile(configUri),
        spec.kind,
        spec.agentId,
      )
    } catch {
      return []
    }
  }

  protected findSameSocketConflict(
    entries: ParsedMcpServer[],
    launchConfig: RocrateMcpLaunchConfig,
  ): ParsedMcpServer | undefined {
    const socketPath = launchConfig.socketPath
    if (!socketPath) {
      return undefined
    }
    return entries.find(
      (entry) =>
        entry.name === 'rocrate' && mcpServerUsesSocket(entry, socketPath, isWindows),
    )
  }

  protected createMcpKeepSetting(
    spec: AgentMcpConfigSpec,
    server: ParsedMcpServer,
  ): McpKeepSetting {
    return {
      agentId: spec.agentId,
      configPath: server.configPath ?? spec.configPath,
      kind: spec.kind,
      serverName: server.name,
      signature: server.signature,
    }
  }

  protected async hasRememberedMcpKeep(
    spec: AgentMcpConfigSpec,
    server: ParsedMcpServer,
  ): Promise<boolean> {
    const setting = this.createMcpKeepSetting(spec, server)
    const storedSettings = await this.readRememberedMcpKeeps()
    return hasRememberedMcpSetting(storedSettings, setting)
  }

  protected async rememberMcpKeep(
    spec: AgentMcpConfigSpec,
    server: ParsedMcpServer,
  ): Promise<void> {
    const setting = this.createMcpKeepSetting(spec, server)
    const storedSettings = await this.readRememberedMcpKeeps()
    const nextSettings = rememberMcpKeepSetting(storedSettings, setting)
    try {
      await this.storageService.setData(MCP_KEEP_SETTINGS_STORAGE_KEY, nextSettings)
    } catch (error) {
      console.warn('[agent-launcher] failed to remember MCP keep decision', error)
    }
  }

  protected async forgetMcpKeep(
    spec: AgentMcpConfigSpec,
    server: ParsedMcpServer,
  ): Promise<void> {
    const setting = this.createMcpKeepSetting(spec, server)
    const storedSettings = await this.readRememberedMcpKeeps()
    const nextSettings = forgetMcpKeepSetting(storedSettings, setting)
    if (nextSettings.length === storedSettings.length) {
      return
    }
    try {
      await this.storageService.setData(MCP_KEEP_SETTINGS_STORAGE_KEY, nextSettings)
    } catch (error) {
      console.warn('[agent-launcher] failed to clear MCP keep decision', error)
    }
  }

  protected async readRememberedMcpKeeps(): Promise<McpKeepSetting[]> {
    try {
      const stored = await this.storageService.getData<unknown>(
        MCP_KEEP_SETTINGS_STORAGE_KEY,
      )
      return Array.isArray(stored) ? stored.filter(isMcpKeepSetting) : []
    } catch (error) {
      console.warn('[agent-launcher] failed to read MCP keep decisions', error)
      return []
    }
  }

  protected async promptMcpSocketConflict(
    agentId: string,
    spec: AgentMcpConfigSpec,
    launchConfig: RocrateMcpLaunchConfig,
    conflict: ParsedMcpServer,
    alternateName: string,
  ): Promise<RocrateMcpConflictDecision | undefined> {
    const rocrateSnippet = this.buildRocrateMcpSnippet(spec, launchConfig)
    const alternateSnippet = this.buildRocrateMcpSnippet(
      spec,
      launchConfig,
      alternateName,
    )
    const decision = await new RocrateMcpConflictDialog({
      title: nls.localize(
        'rockit/agentLauncher/mcpSocketConflictTitle',
        'RocKIT MCP Conflict',
      ),
      maxWidth: 860,
      wordWrap: 'break-word',
      summary: nls.localize(
        'rockit/agentLauncher/mcpSocketConflictSummary',
        'An MCP server named "{0}" is already configured for {1}.',
        conflict.name,
        this.formatAgentName(agentId),
      ),
      socketLabel: nls.localize(
        'rockit/agentLauncher/mcpSocketConflictSocketLabel',
        'Shared socket',
      ),
      socketPath: launchConfig.socketPath ?? '',
      questionTitle: nls.localize(
        'rockit/agentLauncher/mcpSocketConflictQuestionTitle',
        'Choose how RocKIT should handle this configuration',
      ),
      question: nls.localize(
        'rockit/agentLauncher/mcpSocketConflictQuestion',
        'Keep the current server, replace it with RocKIT, or add RocKIT alongside it as "{0}"?',
        alternateName,
      ),
      overwriteTitle: nls.localize(
        'rockit/agentLauncher/mcpSocketConflictOverwriteTitle',
        'RocKIT configuration — replace "rocrate"',
      ),
      alongsideTitle: nls.localize(
        'rockit/agentLauncher/mcpSocketConflictAlongsideTitle',
        'RocKIT configuration — add as "{0}"',
        alternateName,
      ),
      overwriteSnippet: rocrateSnippet,
      alongsideSnippet: alternateSnippet,
      keepLabel: nls.localize(
        'rockit/agentLauncher/mcpSocketConflictKeep',
        'Keep Current',
      ),
      alongsideLabel: nls.localize(
        'rockit/agentLauncher/mcpSocketConflictAlongside',
        'Add as "{0}"',
        alternateName,
      ),
      overwriteLabel: nls.localize(
        'rockit/agentLauncher/mcpSocketConflictOverwrite',
        'Replace "rocrate"',
      ),
    }).open()
    return decision
  }

  protected buildRocrateMcpSnippet(
    spec: AgentMcpConfigSpec,
    launchConfig: RocrateMcpLaunchConfig,
    serverName = 'rocrate',
  ): string {
    if (spec.kind === 'toml') {
      return [
        `[mcp_servers.${serverName}]`,
        `command = ${toTomlBasicString(launchConfig.command)}`,
        `args = [${launchConfig.args.map((arg) => toTomlBasicString(arg)).join(', ')}]`,
        'startup_timeout_sec = 30',
        `env = ${toTomlInlineTable(launchConfig.env)}`,
      ].join('\n')
    }
    if (spec.agentId === 'opencode') {
      return JSON.stringify(
        {
          mcp: {
            [serverName]: {
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
      {
        mcpServers: {
          [serverName]: toSerializableLaunchConfig(launchConfig),
        },
      },
      null,
      2,
    )
  }

  protected async resolveRocrateServerPath(): Promise<string> {
    const processEnv = (globalThis as any).process?.env
    const configuredAppProjectPath =
      processEnv?.THEIA_APP_PROJECT_PATH ??
      (await this.envVariablesServer.getValue('THEIA_APP_PROJECT_PATH'))?.value
    const configuredServerPath =
      processEnv?.ROCKIT_ROCRATE_MCP_SERVER_PATH ??
      (await this.envVariablesServer.getValue('ROCKIT_ROCRATE_MCP_SERVER_PATH'))?.value
    const runtime = this.getElectronRuntimePaths()
    const locationPath =
      typeof window === 'undefined' ? undefined : window.location.pathname
    const processPlatform = this.getProcessPlatform(
      configuredAppProjectPath,
      configuredServerPath,
      runtime.resourcesPath,
      locationPath,
      this.homeDirPath,
    )
    const appProjectPath =
      this.normalizePlatformPath(configuredAppProjectPath, processPlatform) ??
      resolveAppProjectPathFromLocation(
        locationPath,
        processPlatform,
      )
    const unique = getRocrateMcpServerPathCandidates({
      platform: processPlatform,
      appProjectPath,
      resourcesPath: runtime.resourcesPath,
      serverPathOverride: this.normalizePlatformPath(configuredServerPath, processPlatform),
    })
    for (const candidate of unique) {
      if (await this.fileService.exists(FileUri.create(candidate))) return candidate
    }
    throw new Error(nls.localize(
      'rockit/agentLauncher/serverNotFound',
      'Server not found. Tried: {0}',
      unique.join(' | '),
    ))
  }

  protected async resolveRocrateMcpLaunchConfig(): Promise<RocrateMcpLaunchConfig> {
    const runtime = await this.runMcpResolutionStep(nls.localize(
      'rockit/agentLauncher/runtime',
      'runtime',
    ), () =>
      this.resolveRocrateMcpRuntime(),
    )
    const serverPath = await this.runMcpResolutionStep(nls.localize(
      'rockit/agentLauncher/serverPath',
      'server path',
    ), () =>
      this.resolveRocrateServerPath(),
    )
    const socketPath = await this.runMcpResolutionStep(nls.localize(
      'rockit/agentLauncher/socketPath',
      'socket path',
    ), () =>
      this.resolveRocrateMcpSocketPath(),
    )
    const selectedLocale =
      nls.localization?.languageId ?? nls.locale ?? nls.defaultLocale ?? 'en'
    return {
      command: runtime.command,
      args: [serverPath, '--connect', socketPath],
      env: {
        ...runtime.env,
        ROCRATE_MCP_DEFAULT_MODE: 'local',
        ROCRATE_DASHBOARD_LOCALE: selectedLocale.toLowerCase().startsWith('hu')
          ? 'hu'
          : 'en',
      },
      socketPath,
    }
  }

  protected async runMcpResolutionStep<T>(
    label: string,
    resolve: () => Promise<T>,
  ): Promise<T> {
    try {
      return await resolve()
    } catch (error) {
      console.error(`[agent-launcher] MCP ${label} resolution failed`, error)
      const detail =
        error instanceof Error ? error.stack ?? error.message : String(error)
      throw new Error(nls.localize(
        'rockit/agentLauncher/resolutionFailed',
        'MCP {0} resolution failed:\n{1}',
        label,
        detail,
      ))
    }
  }

  protected async resolveRocrateMcpRuntime(): Promise<RocrateMcpRuntime> {
    const processValue = (globalThis as any).process
    const processEnv = processValue?.env ?? {}
    const nodeOverride =
      processEnv.ROCKIT_ROCRATE_MCP_NODE_PATH ??
      (await this.envVariablesServer.getValue('ROCKIT_ROCRATE_MCP_NODE_PATH'))?.value
    const electronRunAsNodeOverride =
      processEnv.ROCKIT_ROCRATE_MCP_ELECTRON_RUN_AS_NODE ??
      (await this.envVariablesServer.getValue('ROCKIT_ROCRATE_MCP_ELECTRON_RUN_AS_NODE'))?.value

    const runtime = this.getElectronRuntimePaths()
    // The renderer's process.execPath can be unavailable under context isolation;
    // the backend always reports the live Electron binary via getExecPath().
    const execPath = runtime.execPath ?? (await this.envVariablesServer.getExecPath())

    // NOTE: this marker confirms whether the runtime-resolution code that uses
    // the app.asar-based packaged check is actually present in this build.
    console.info('[agent-launcher] MCP runtime resolution START (code=v2/app.asar)', {
      platform: processValue?.platform,
      arch: processValue?.arch,
      electronVersion: processValue?.versions?.electron,
      chromeVersion: processValue?.versions?.chrome,
      nodeVersion: processValue?.versions?.node,
      resourcesPath: runtime.resourcesPath,
      rendererExecPath: runtime.execPath,
      resolvedExecPath: execPath,
      nodeOverride,
      hasWindowLocation: typeof window !== 'undefined',
      windowLocationPathname: typeof window === 'undefined' ? undefined : window.location.pathname,
    })

    if (nodeOverride) {
      const env: Record<string, string> = {}
      if (
        electronRunAsNodeOverride === '1' ||
        isElectronRuntimePath(nodeOverride)
      ) {
        env.ELECTRON_RUN_AS_NODE = '1'
      }
      console.info('[agent-launcher] MCP runtime resolution => override-node', {
        command: nodeOverride,
        electronRunAsNode: env.ELECTRON_RUN_AS_NODE === '1',
      })
      return { command: nodeOverride, env }
    }

    let packaged = false
    if (execPath) {
      // process.resourcesPath is not always exposed to the renderer, so the
      // app.asar existence check is optional; the execPath heuristic below still
      // distinguishes packaged from dev when resourcesPath is unavailable.
      packaged = await this.isPackagedElectronRuntime(runtime.resourcesPath, execPath)
    }
    console.info('[agent-launcher] MCP runtime resolution packaged check', {
      resourcesPathPresent: !!runtime.resourcesPath,
      execPathPresent: !!execPath,
      packaged,
    })

    // Packaged build: launch the bundled Electron executable as a plain Node
    // runtime (ELECTRON_RUN_AS_NODE=1), independent of the user's Node install.
    if (packaged && execPath) {
      console.info('[agent-launcher] MCP runtime resolution => packaged-electron-as-node', { command: execPath })
      return {
        command: execPath,
        env: { ELECTRON_RUN_AS_NODE: '1' },
      }
    }

    // Development build: prefer the Node the user has installed on their system.
    const nodeCommand = await this.findExecutableAbsolutePath(['node'])
    if (nodeCommand) {
      console.info('[agent-launcher] MCP runtime resolution => user-node', { command: nodeCommand })
      return { command: nodeCommand, env: {} }
    }

    // Last-resort fallback when no user Node is on PATH: run the Electron binary
    // as Node so the server can still start.
    if (execPath) {
      const env: Record<string, string> = {}
      if (processValue?.versions?.electron) {
        env.ELECTRON_RUN_AS_NODE = '1'
      }
      console.info('[agent-launcher] MCP runtime resolution => fallback-electron-as-node', { command: execPath })
      return { command: execPath, env }
    }

    throw new Error(nls.localize(
      'rockit/agentLauncher/nodeRuntimeNotFound',
      'Could not resolve a Node runtime for the RO-Crate MCP server.',
    ))
  }

  /**
   * Detects a packaged (production) Electron build. Mirrors Electron's own
   * `app.isPackaged` check: a packaged app ships an `app.asar` archive inside
   * its Resources directory, whereas the development Electron binary (run from
   * `node_modules/electron`) only ships `default_app.asar`. This is reliable on
   * Windows, macOS and Linux alike because it depends neither on the frontend
   * URL nor on the user having Node installed.
   */
  protected async isPackagedElectronRuntime(
    resourcesPath: string | undefined,
    execPath: string,
  ): Promise<boolean> {
    let asarPath: string | undefined
    let asarExists = false
    let asarError: string | undefined
    if (resourcesPath) {
      asarPath = joinPlatformPath(resourcesPath, 'app.asar')
      try {
        asarExists = await this.fileService.exists(FileUri.create(asarPath))
      } catch (error) {
        asarError = error instanceof Error ? error.message : String(error)
      }
    }

    const heuristic = !(
      /[\\/]node_modules[\\/]/i.test(execPath) ||
      /[\\/]electron[\\/]dist[\\/]/i.test(execPath) ||
      /[\\/]default_app\.asar(?:[\\/]|$)/i.test(execPath)
    )
    const result = asarExists || heuristic

    console.info('[agent-launcher] isPackagedElectronRuntime', {
      resourcesPath,
      asarPath,
      asarExists,
      asarError,
      execPath,
      heuristic,
      result,
    })
    return result
  }

  protected async resolveRocrateMcpSocketPath(): Promise<string> {
    const env = (globalThis as any).process?.env
    const socketPathOverride =
      env?.ROCKIT_ROCRATE_MCP_SOCKET_PATH ??
      (await this.envVariablesServer.getValue('ROCKIT_ROCRATE_MCP_SOCKET_PATH'))?.value
    const username =
      env?.USERNAME ?? (await this.envVariablesServer.getValue('USERNAME'))?.value
    const homeDirs = this.getHomeDirs()
    const processPlatform = this.getProcessPlatform(
      socketPathOverride,
      ...homeDirs,
      this.homeDirPath,
    )
    return resolveRocrateMcpSocketPath({
      homeDir: homeDirs.length > 0 ? homeDirs[0] : this.homeDirPath,
      platform: processPlatform,
      socketPathOverride,
      username,
    })
  }

  protected async writeRocrateMcpConfig(
    spec: AgentMcpConfigSpec,
    launchConfig: RocrateMcpLaunchConfig,
    serverName = 'rocrate',
  ): Promise<void> {
    const configUri = FileUri.create(spec.configPath)
    await this.fileService.createFolder(configUri.parent)
    const exists = await this.fileService.exists(configUri)

    if (spec.kind === 'toml') {
      const snippet = this.buildRocrateMcpSnippet(spec, launchConfig, serverName)
      const content = exists ? await this.readTextFile(configUri) : ''
      const sectionPattern = new RegExp(
        `\\[mcp_servers\\.${escapeRegExp(serverName)}\\][\\s\\S]*?(?=\\n\\[|$)`,
      )
      const updated = sectionPattern.test(content)
        ? content.replace(sectionPattern, snippet)
        : `${content}\n${snippet}`
      await this.fileService.write(configUri, updated)
      return
    }

    const content = exists ? await this.readTextFile(configUri) : '{}'
    const json = JSON.parse(content)
    if (spec.agentId === 'opencode') {
      json.mcp = {
        ...(json.mcp || {}),
        [serverName]: {
          type: 'local',
          enabled: true,
          command: [launchConfig.command, ...launchConfig.args],
          environment: launchConfig.env,
        },
      }
    } else {
      json.mcpServers = {
        ...(json.mcpServers || {}),
        [serverName]: toSerializableLaunchConfig(launchConfig),
      }
    }
    await this.fileService.write(configUri, JSON.stringify(json, null, 2))
  }

  protected async ensureClaudeMcpConfigured(
    directoryUri: URI,
    launchConfig: RocrateMcpLaunchConfig,
    cwd: string,
    spec: AgentMcpConfigSpec,
  ): Promise<boolean> {
    const home = this.resolveHomeDir(directoryUri)
    if (!home) {
      return false
    }
    const entries = await this.readClaudeMcpConfigEntries(home)
    if (entries.some((entry) =>
      mcpServerMatches(entry, launchConfig.command, launchConfig.args),
    )) {
      return true
    }

    let serverName = 'rocrate'
    const sameSocketConflict = this.findSameSocketConflict(entries, launchConfig)
    if (sameSocketConflict) {
      if (await this.hasRememberedMcpKeep(spec, sameSocketConflict)) {
        return true
      }
      const alternateName = chooseMcpServerName(entries.map((entry) => entry.name))
      const decision = await this.promptMcpSocketConflict(
        'claude',
        spec,
        launchConfig,
        sameSocketConflict,
        alternateName,
      )
      if (!decision) {
        return false
      }
      if (decision === 'keep') {
        await this.rememberMcpKeep(spec, sameSocketConflict)
        return true
      }
      await this.forgetMcpKeep(spec, sameSocketConflict)
      if (decision === 'alongside') {
        serverName = alternateName
      }
    }

    const claudeExecutable =
      (await this.findExecutableAbsolutePath(['claude'])) ?? 'claude'
    const payload = this.buildClaudeAddMcpPayload(launchConfig)
    const accepted = await new ConfirmDialog({
      title: nls.localize(
        'rockit/agentLauncher/mcpNotConfiguredTitle',
        'RocKIT MCP Not Configured',
      ),
      msg: [
        nls.localize(
          'rockit/agentLauncher/mcpNotConfiguredFor',
          'RocKIT MCP has not yet been configured for {0}.',
          'Claude',
        ),
        '',
        nls.localize('rockit/agentLauncher/rockitWillRun', 'RocKIT will run:'),
        `claude mcp add-json --scope user ${serverName} <payload>`,
        '',
        `claude: ${claudeExecutable}`,
        `node: ${launchConfig.command}`,
        `server: ${launchConfig.args.join(' ')}`,
        '',
        nls.localize(
          'rockit/agentLauncher/addConfigurationQuestion',
          'Add this configuration now?',
        ),
      ].join('\n'),
      ok: nls.localize('rockit/agentLauncher/addConfiguration', 'Add Configuration'),
      cancel: nls.localize('rockit/common/cancel', 'Cancel'),
    }).open()
    if (!accepted) {
      return false
    }
    try {
      if (!isWindows && serverName === 'rocrate') {
        await this.executeCommandArgs(
          cwd,
          [claudeExecutable, 'mcp', 'remove', '--scope', 'user', 'rocrate'],
          'claude.mcp.remove',
          true,
        )
      }
      await this.executeCommandArgs(
        cwd,
        [claudeExecutable, 'mcp', 'add-json', '--scope', 'user', serverName, payload],
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
    const entries = await this.readClaudeMcpConfigEntries(homeDir)
    return entries.some((entry) =>
      mcpServerMatches(entry, launchConfig.command, launchConfig.args),
    )
  }

  protected async readClaudeMcpConfigEntries(
    homeDir: string,
  ): Promise<ParsedMcpServer[]> {
    const candidates = [
      joinPlatformPath(homeDir, '.claude.json'),
      joinPlatformPath(homeDir, '.claude', '.mcp.json'),
    ]
    const entries: ParsedMcpServer[] = []
    for (const candidate of candidates) {
      const uri = FileUri.create(candidate)
      if (!(await this.fileService.exists(uri))) {
        continue
      }
      try {
        entries.push(
          ...parseMcpServerEntries(
            await this.readTextFile(uri),
            'json',
            'claude',
          ).map((entry) => ({ ...entry, configPath: candidate })),
        )
      } catch {}
    }
    return entries
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
      let executable = await this.findExecutableInPath(
        spec.executables,
        spec.id === 'opencode' ? await this.getOpenCodeBinDirs() : [],
        spec.id === 'opencode',
      )
      if (!executable && (await this.hasAgentMarker(spec))) {
        executable = spec.executables[0]
      }
      if (executable) {
        sharedAvailableAgents.set(spec.id, executable)
      }
    }
  }

  protected async findExecutableInPath(
    candidates: string[],
    additionalDirs: string[] = [],
    preserveAbsolutePath = false,
  ): Promise<string | undefined> {
    const abs = await this.findExecutableAbsolutePath(candidates, additionalDirs)
    if (preserveAbsolutePath) {
      return abs
    }
    return abs
      ? basenamePlatformPath(abs).replace(/\.(exe|cmd|bat)$/i, '')
      : undefined
  }

  protected async findExecutableAbsolutePath(
    candidates: string[],
    additionalDirs: string[] = [],
  ): Promise<string | undefined> {
    const processEnv = (globalThis as any).process?.env
    const pathValue = processEnv?.PATH ?? ''
    const dirs = [
      ...new Set([
        ...pathValue.split(isWindows ? ';' : ':'),
        ...additionalDirs,
        ...this.getCommonBinDirs(),
      ]),
    ].filter((dir) =>
      isWindows
        ? /^[a-zA-Z]:[\\/]/.test(dir) || /^\\\\/.test(dir)
        : dir.startsWith('/'),
    )
    const exts = isWindows ? ['.exe', '.cmd', '.bat', ''] : ['']

    for (const dir of dirs) {
      for (const candidate of candidates) {
        for (const ext of exts) {
          const full = joinPlatformPath(dir, candidate + ext)
          if (await this.fileService.exists(FileUri.create(full))) return full
        }
      }
    }
    return undefined
  }

  /**
   * Returns every documented OpenCode install directory plus the Windows npm global bin.
   * The executable itself is checked before OpenCode is exposed in the menu.
   */
  protected async getOpenCodeBinDirs(): Promise<string[]> {
    const homes = this.getHomeDirs()
    const [installDir, xdgBinDir, appData, npmPrefix] = await Promise.all([
      this.getEnvironmentValue('OPENCODE_INSTALL_DIR'),
      this.getEnvironmentValue('XDG_BIN_DIR'),
      this.getEnvironmentValue('APPDATA'),
      this.getEnvironmentValue('npm_config_prefix'),
    ])
    return [
      installDir,
      xdgBinDir,
      ...homes.map((home) => joinPlatformPath(home, 'bin')),
      ...homes.map((home) => joinPlatformPath(home, '.opencode', 'bin')),
      isWindows && appData ? joinPlatformPath(appData, 'npm') : undefined,
      ...(isWindows
        ? homes.map((home) => joinPlatformPath(home, 'AppData', 'Roaming', 'npm'))
        : []),
      npmPrefix
        ? isWindows
          ? npmPrefix
          : joinPlatformPath(npmPrefix, 'bin')
        : undefined,
    ].filter((directory): directory is string => !!directory)
  }

  protected async getEnvironmentValue(name: string): Promise<string | undefined> {
    const processValue = (globalThis as any).process?.env?.[name]
    if (processValue) {
      return processValue
    }
    try {
      return (await this.envVariablesServer.getValue(name))?.value
    } catch {
      return undefined
    }
  }

  protected async hasAgentMarker(spec: AgentSpec): Promise<boolean> {
    if (!spec.markerPaths) return false
    const homes = this.getHomeDirs()
    for (const home of homes) {
      for (const marker of spec.markerPaths) {
        if (
          await this.fileService.exists(FileUri.create(joinPlatformPath(home, marker)))
        ) {
          return true
        }
      }
    }
    return false
  }

  protected getHomeDirs(): string[] {
    const env = (globalThis as any).process?.env
    return [this.homeDirPath, env?.HOME, env?.USERPROFILE].filter(
      (value): value is string => !!value,
    )
  }

  protected getElectronRuntimePaths(): { resourcesPath?: string; execPath?: string } {
    const processValue = (globalThis as any).process
    return {
      resourcesPath: processValue?.resourcesPath,
      execPath: processValue?.execPath,
    }
  }

  protected getProcessPlatform(...pathHints: Array<string | undefined>): NodeJS.Platform {
    const platform = (globalThis as any).process?.platform as NodeJS.Platform | undefined
    const hasWindowsPath = pathHints.some(
      (value) =>
        !!value &&
        (/^\/?[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value)),
    )
    if (isWindows || hasWindowsPath) {
      return 'win32'
    }
    if (platform === 'darwin' || platform === 'linux') {
      return platform
    }
    return 'darwin'
  }

  protected normalizePlatformPath(
    value: string | undefined,
    platform: NodeJS.Platform,
  ): string | undefined {
    if (platform === 'win32' && value && /^\/[a-zA-Z]:[\\/]/.test(value)) {
      return value.slice(1)
    }
    return value
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
    return [home ? `${home}\\.local\\bin` : '', 'C:\\Program Files\\nodejs'].filter(
      Boolean,
    )
  }

  protected async readTextFile(uri: URI): Promise<string> {
    return (await this.fileService.read(uri)).value.toString()
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

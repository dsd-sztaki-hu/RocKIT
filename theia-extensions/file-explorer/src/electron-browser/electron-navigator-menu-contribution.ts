// *****************************************************************************
// Copyright (C) 2021 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
  Command,
  CommandContribution,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
  SelectionService,
  URI,
} from '@theia/core'
import {
  CommonCommands,
  KeybindingContribution,
  KeybindingRegistry,
  OpenWithService,
} from '@theia/core/lib/browser'
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs'
import { WidgetManager } from '@theia/core/lib/browser/widget-manager'
import { nls } from '@theia/core/lib/common'
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables'
import { FileUri } from '@theia/core/lib/common/file-uri'
import { isOSX, isWindows } from '@theia/core/lib/common/os'
import { UriAwareCommandHandler } from '@theia/core/lib/common/uri-command-handler'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service'
import { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import * as path from 'path'
import { FILE_NAVIGATOR_ID, FileNavigatorWidget } from '../browser'
import {
  NavigatorContextMenu,
  SHELL_TABBAR_CONTEXT_REVEAL,
} from '../browser/navigator-contribution'
import { AGENTS_TEMPLATE } from './agents-template'

// Side-effect import to attach types to window for Electron
import '@theia/core/lib/electron-common/electron-api'

export const OPEN_CONTAINING_FOLDER = Command.toDefaultLocalizedCommand({
  id: 'revealFileInOS',
  category: CommonCommands.FILE_CATEGORY,
  label: isWindows
    ? 'Reveal in File Explorer'
    : isOSX
      ? 'Reveal in Finder'
      : /* linux */ 'Open Containing Folder',
})

export const OPEN_WITH_SYSTEM_APP = Command.toDefaultLocalizedCommand({
  id: 'openWithSystemApp',
  category: CommonCommands.FILE_CATEGORY,
  label: 'Open With System Editor',
})

type AgentSpec = {
  id: string
  menuLabel: string
  executables: string[]
  markerPaths?: string[]
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
]

function agentCommandId(agentId: string): string {
  return `openAgent.${agentId}`
}

const sharedAvailableAgents = new Map<string, string>()

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
}

@injectable()
export class ElectronNavigatorMenuContribution
  implements MenuContribution, CommandContribution, KeybindingContribution
{
  @inject(SelectionService) protected readonly selectionService: SelectionService
  @inject(WidgetManager) protected readonly widgetManager: WidgetManager
  @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService
  @inject(OpenWithService) protected readonly openWithService: OpenWithService
  @inject(FileService) protected readonly fileService: FileService
  @inject(TerminalService) protected readonly terminalService: TerminalService
  @inject(EnvVariablesServer) protected readonly envVariablesServer: EnvVariablesServer

  protected homeDirPath: string | undefined

  @postConstruct()
  protected init(): void {
    console.info('[agents-menu] init ElectronNavigatorMenuContribution')
    void this.loadHomeDirPath()
    void this.detectAvailableAgents()
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(
      OPEN_CONTAINING_FOLDER,
      UriAwareCommandHandler.MonoSelect(this.selectionService, {
        execute: async (uri) => {
          ;(window as any).electronTheiaCore.showItemInFolder(FileUri.fsPath(uri))
        },
        isEnabled: (uri) => !!this.workspaceService.getWorkspaceRootUri(uri),
        isVisible: (uri) => !!this.workspaceService.getWorkspaceRootUri(uri),
      }),
    )
    commands.registerCommand(
      OPEN_WITH_SYSTEM_APP,
      UriAwareCommandHandler.MonoSelect(this.selectionService, {
        execute: async (uri) => {
          this.openWithSystemApplication(uri)
        },
      }),
    )
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
            sharedAvailableAgents.has(spec.id),
          isVisible: (uri) =>
            !!this.workspaceService.getWorkspaceRootUri(uri) &&
            sharedAvailableAgents.has(spec.id),
        }),
      )
    }
    this.openWithService.registerHandler({
      id: 'system-editor',
      label: nls.localize('theia/navigator/systemEditor', 'System Editor'),
      providerName: nls.localizeByDefault('Built-in'),
      canHandle: (uri) => (uri.scheme === 'file' ? 10 : 0),
      open: (uri) => {
        this.openWithSystemApplication(uri)
        return {}
      },
    })
  }

  protected openWithSystemApplication(uri: URI): void {
    ;(window as any).electronTheiaCore.openWithSystemApp(FileUri.fsPath(uri))
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(NavigatorContextMenu.NAVIGATION, {
      commandId: OPEN_CONTAINING_FOLDER.id,
      label: OPEN_CONTAINING_FOLDER.label,
    })
    for (const spec of AGENT_SPECS) {
      menus.registerMenuAction(NavigatorContextMenu.AGENTS, {
        commandId: agentCommandId(spec.id),
        label: spec.menuLabel,
      })
    }
    menus.registerMenuAction(SHELL_TABBAR_CONTEXT_REVEAL, {
      commandId: OPEN_CONTAINING_FOLDER.id,
      label: OPEN_CONTAINING_FOLDER.label,
      order: '4',
    })
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    keybindings.registerKeybinding({
      command: OPEN_CONTAINING_FOLDER.id,
      keybinding: 'ctrlcmd+alt+p',
      when: 'filesExplorerFocus',
    })
  }

  protected async openAgentForUri(uri: URI, agentId: string): Promise<void> {
    const directoryUri = await this.resolveDirectoryUri(uri)
    const executable = sharedAvailableAgents.get(agentId)
    if (!executable) return

    const mcpReady = await this.ensureAgentMcpConfigured(agentId, directoryUri)
    if (!mcpReady) return

    await this.ensureAgentInstructionsFile(directoryUri, agentId)
    const cwd = FileUri.fsPath(directoryUri)
    const terminal = await this.terminalService.newTerminal({ cwd })
    this.terminalService.open(terminal, { mode: 'activate' })
    await terminal.start()
    await this.waitForTerminalOpen(terminal, 1000)
    try {
      await terminal.executeCommand({ cwd, args: [executable] })
    } catch {
      terminal.sendText(`${executable}\n`)
    }
  }

  protected async resolveDirectoryUri(uri: URI): Promise<URI> {
    const stat = await this.fileService.resolve(uri)
    return stat.isDirectory ? uri : uri.parent
  }

  protected async ensureAgentInstructionsFile(
    directoryUri: URI,
    agentId: string,
  ): Promise<void> {
    const fileName = agentId === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'
    const instructionsUri = directoryUri.resolve(fileName)
    if (!(await this.fileService.exists(instructionsUri))) {
      await this.fileService.create(instructionsUri, AGENTS_TEMPLATE)
    }
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
    } catch (e) {
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
        content.includes(`command = "${launchConfig.command.replace(/\\/g, '\\\\')}"`) &&
        content.includes(launchConfig.args[0].replace(/\\/g, '\\\\'))
      )
    }
    try {
      const parsed = JSON.parse(content)
      if (spec.agentId === 'opencode') {
        const rocrate = parsed.mcp?.rocrate
        return (
          Array.isArray(rocrate?.command) &&
          rocrate.command[0] === launchConfig.command &&
          rocrate.command[1] === launchConfig.args[0]
        )
      }
      const rocrate = parsed.mcpServers?.rocrate
      return (
        rocrate?.command === launchConfig.command &&
        rocrate?.args?.[0] === launchConfig.args[0]
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
        `command = "${launchConfig.command}"`,
        `args = ["${launchConfig.args[0]}"]`,
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
              command: [launchConfig.command, launchConfig.args[0]],
              environment: launchConfig.env,
            },
          },
        },
        null,
        2,
      )
    }
    return JSON.stringify({ mcpServers: { rocrate: launchConfig } }, null, 2)
  }

  protected async resolveRocrateServerPath(): Promise<string> {
    const candidates: string[] = []

    const processEnv = (globalThis as any).process?.env
    if (processEnv?.AROMA_ROCRATE_MCP_SERVER_PATH)
      candidates.push(processEnv.AROMA_ROCRATE_MCP_SERVER_PATH)

    const crawledRoot = this.findAppRootByCrawling()
    if (crawledRoot) {
      // Fix: Specifically look in theia-extensions subdirectory
      if (crawledRoot.endsWith('electron-app')) {
        candidates.push(
          path.resolve(
            crawledRoot,
            '..',
            'theia-extensions',
            'rocrate-mcp-server',
            'lib',
            'server.js',
          ),
        )
      } else {
        candidates.push(
          path.resolve(
            crawledRoot,
            'theia-extensions',
            'rocrate-mcp-server',
            'lib',
            'server.js',
          ),
        )
      }
    }

    const runtime = this.getElectronRuntimePaths()
    if (runtime.resourcesPath) {
      candidates.push(
        path.resolve(
          runtime.resourcesPath,
          'app',
          'theia-extensions',
          'rocrate-mcp-server',
          'lib',
          'server.js',
        ),
      )
      candidates.push(
        path.resolve(
          runtime.resourcesPath,
          'theia-extensions',
          'rocrate-mcp-server',
          'lib',
          'server.js',
        ),
      )
    }

    const unique = [...new Set(candidates.filter((c) => !!c && path.isAbsolute(c)))]
    for (const c of unique) {
      if (await this.fileService.exists(FileUri.create(c))) return c
    }
    throw new Error(`Server not found. Tried: ${unique.join(' | ')}`)
  }

  protected findAppRootByCrawling(): string | undefined {
    if (typeof window === 'undefined' || !window.location.pathname) return undefined
    let current = decodeURIComponent(window.location.pathname)
    if (isWindows && /^\/[a-zA-Z]:/.test(current)) current = current.slice(1)

    const parts = current.split(/[\\/]/)
    while (parts.length > 0) {
      const checkPath = parts.join(isWindows ? '\\' : '/')
      if (checkPath.endsWith('electron-app') || checkPath.endsWith('aroma-2'))
        return checkPath
      parts.pop()
    }
    return undefined
  }

  protected async resolveRocrateMcpLaunchConfig(): Promise<RocrateMcpLaunchConfig> {
    const nodeCommand = await this.findExecutableAbsolutePath(['node'])
    if (!nodeCommand) throw new Error('Node not found in PATH.')
    const serverPath = await this.resolveRocrateServerPath()
    return {
      command: nodeCommand,
      args: [serverPath],
      env: { ROCRATE_MCP_DEFAULT_MODE: 'local' },
    }
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
    } else {
      const content = exists ? await this.readTextFile(configUri) : '{}'
      const json = JSON.parse(content)
      if (spec.agentId === 'opencode') {
        json.mcp = {
          ...(json.mcp || {}),
          rocrate: {
            type: 'local',
            enabled: true,
            command: [launchConfig.command, launchConfig.args[0]],
            environment: launchConfig.env,
          },
        }
      } else {
        json.mcpServers = { ...(json.mcpServers || {}), rocrate: launchConfig }
      }
      await this.fileService.write(configUri, JSON.stringify(json, null, 2))
    }
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
        `server: ${launchConfig.args[0]}`,
        '',
        'Add this configuration now?',
      ].join('\n'),
    }).open()
    if (!accepted) {
      return false
    }
    try {
      console.info('[agents-menu] claude.mcp.configure.start', {
        cwd,
        claudeExecutable,
        nodeCommand: launchConfig.command,
        serverPath: launchConfig.args[0],
        payloadSize: payload.length,
      })
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
      const configured = await this.waitForClaudeMcpConfigured(home, launchConfig)
      console.info('[agents-menu] claude.mcp.configure.verified', { configured })
      return configured
    } catch (error) {
      console.warn('[agents-menu] claude.mcp.configure.failed', {
        error: error instanceof Error ? error.message : String(error),
      })
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
      if (!(await this.fileService.exists(uri))) {
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
          rocrate.args[0] === launchConfig.args[0]
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
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const configured = await this.isClaudeMcpConfigured(homeDir, launchConfig)
      if (configured) {
        console.info('[agents-menu] claude.mcp.configure.detected', { attempt })
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
    console.info('[agents-menu] command.execute.start', { label, cwd, args })
    const terminal = await this.terminalService.newTerminal({ cwd })
    await terminal.start()
    await this.waitForTerminalOpen(terminal, 2000)
    try {
      await terminal.executeCommand({ cwd, args })
      console.info('[agents-menu] command.execute.dispatched', { label })
    } catch (error) {
      if (!ignoreFailures) {
        console.warn('[agents-menu] command.execute.error', {
          label,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
      console.info('[agents-menu] command.execute.ignoredError', {
        label,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setTimeout(() => terminal.dispose(), 3000)
    }
  }

  protected async detectAvailableAgents(): Promise<void> {
    for (const spec of AGENT_SPECS) {
      let exec = await this.findExecutableInPath(spec.executables)
      if (!exec && (await this.hasAgentMarker(spec))) exec = spec.executables[0]
      if (exec) sharedAvailableAgents.set(spec.id, exec)
    }
  }

  protected async findExecutableInPath(
    candidates: string[],
  ): Promise<string | undefined> {
    const abs = await this.findExecutableAbsolutePath(candidates)
    return abs ? path.basename(abs).replace(/\.(exe|cmd|bat)$/i, '') : undefined
  }

  protected async findExecutableAbsolutePath(
    candidates: string[],
  ): Promise<string | undefined> {
    const processEnv = (globalThis as any).process?.env
    const pathValue = processEnv?.PATH ?? ''
    const dirs = [
      ...new Set([...pathValue.split(isWindows ? ';' : ':'), ...this.getCommonBinDirs()]),
    ]
    const exts = isWindows ? ['.exe', '.cmd', '.bat', ''] : ['']

    for (const dir of dirs) {
      for (const cand of candidates) {
        for (const ext of exts) {
          const full = path.join(dir, cand + ext)
          if (await this.fileService.exists(FileUri.create(full))) return full
        }
      }
    }
    return undefined
  }

  protected async hasAgentMarker(spec: AgentSpec): Promise<boolean> {
    if (!spec.markerPaths) return false
    const homes = this.getHomeDirs()
    for (const home of homes) {
      for (const marker of spec.markerPaths) {
        if (await this.fileService.exists(FileUri.create(path.join(home, marker))))
          return true
      }
    }
    return false
  }

  protected getHomeDirs(): string[] {
    const env = (globalThis as any).process?.env
    return [this.homeDirPath, env?.HOME, env?.USERPROFILE].filter((v): v is string => !!v)
  }

  protected getElectronRuntimePaths(): { resourcesPath?: string; execPath?: string } {
    const p = (globalThis as any).process
    return { resourcesPath: p?.resourcesPath, execPath: p?.execPath }
  }

  protected async loadHomeDirPath(): Promise<void> {
    try {
      const uri = await this.envVariablesServer.getHomeDirUri()
      if (uri) this.homeDirPath = new URI(uri).path.fsPath()
    } catch {}
  }

  protected getCommonBinDirs(): string[] {
    const home = this.getHomeDirs()[0]
    if (!isWindows)
      return [
        home ? `${home}/.volta/bin` : '',
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
      ].filter(Boolean)
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
    return new Promise((res) => {
      const t = setTimeout(res, timeout)
      terminal.onDidOpen(() => {
        clearTimeout(t)
        res()
      })
    })
  }

  tryGetNavigatorWidget(): FileNavigatorWidget | undefined {
    return this.widgetManager.tryGetWidget(FILE_NAVIGATOR_ID)
  }
}

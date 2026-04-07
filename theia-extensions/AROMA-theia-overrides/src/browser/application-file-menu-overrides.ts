import {
  CommonCommands,
  CommonMenus,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser'
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding'
import { SaveReason } from '@theia/core/lib/browser/saveable'
import { SaveableService } from '@theia/core/lib/browser/saveable-service'
import {
  CommandRegistry,
  CommandService,
  MenuModelRegistry,
} from '@theia/core/lib/common'
import { URI } from '@theia/core/lib/common/uri'
import { inject, injectable } from '@theia/core/shared/inversify'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceCommands, WorkspaceService } from '@theia/workspace/lib/browser'
import { FILE_WORKSPACE } from '@theia/workspace/lib/browser/workspace-frontend-contribution'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateLoaderContribution } from 'app-state/lib/browser/state/ro-crate-loader'
import { RoCrateHtmlGenerator } from 'aroma2-common/lib/browser';

const AROMA_IGNORE_DIR = '.aroma'
const AROMA_IGNORE_FILE = 'ignored.txt'
const DEFAULT_IGNORED_ENTRIES = [
  'ro-crate-preview.html',
  'ro-crate-metadata.json',
  'AGENTS.md',
  'CLAUDE.md',
  '.aroma/',
] as const

@injectable()
export class ApplicationFileMenuOverrides implements FrontendApplicationContribution {
  @inject(MenuModelRegistry)
  protected readonly menuRegistry: MenuModelRegistry

  @inject(CommandRegistry)
  protected readonly commandRegistry: CommandRegistry

  @inject(KeybindingRegistry)
  protected readonly keybindingRegistry: KeybindingRegistry

  @inject(CommandService)
  protected readonly commandService: CommandService

  @inject(AppStateService)
  protected readonly appStateService: AppStateService

  @inject(FileService)
  protected readonly fileService: FileService

  @inject(WorkspaceService)
  protected readonly workspaceService: WorkspaceService

  @inject(RoCrateLoaderContribution)
  protected readonly roCrateLoader: RoCrateLoaderContribution

  @inject(RoCrateHtmlGenerator)
  protected readonly roCrateHtmlGenerator: RoCrateHtmlGenerator

  @inject(SaveableService)
  protected readonly saveableService: SaveableService

  protected persistPromise?: Promise<void>

  onStart(): void {
    this.updateWorkspaceLabels()
    this.removeWorkspaceMenuItems()
    this.removeWorkspaceCommands()
    this.removeWorkspaceKeybindings()

    this.commandService.onDidExecuteCommand((event) => {
      if (event.commandId === CommonCommands.SAVE_ALL.id) {
        void this.persistRoCrateToDisk()
      }
      if (
        event.commandId === WorkspaceCommands.OPEN_FOLDER.id ||
        event.commandId === WorkspaceCommands.OPEN_RECENT_WORKSPACE.id
      ) {
        setTimeout(() => {
          void this.roCrateLoader.refresh()
        }, 0)
      }
    })

    function hasSaveReason(o: unknown): o is { saveReason?: SaveReason } {
      return typeof o === 'object' && o !== null && 'saveReason' in o
    }

    const originalSave = this.saveableService.save.bind(this.saveableService)

    this.saveableService.save = (async (...args: Parameters<typeof originalSave>) => {
      const result = await originalSave(...args)

      const [, options] = args
      if (hasSaveReason(options)) {
        const reason = options.saveReason
        if (reason === SaveReason.AfterDelay || reason === SaveReason.FocusChange) {
          void this.persistRoCrateToDisk()
        }
      }

      return result
    }) as typeof originalSave
  }

  protected updateWorkspaceLabels(): void {
    const openFolderLabel = 'Open Folder as RO-Crate'
    WorkspaceCommands.OPEN_FOLDER.label = openFolderLabel
    WorkspaceCommands.OPEN_FOLDER.dialogLabel = openFolderLabel
    this.updateCommandLabel(WorkspaceCommands.OPEN_FOLDER.id, openFolderLabel)

    const openRecentLabel = 'Open Recent RO-Crate'
    WorkspaceCommands.OPEN_RECENT_WORKSPACE.label = openRecentLabel
    this.updateCommandLabel(WorkspaceCommands.OPEN_RECENT_WORKSPACE.id, openRecentLabel)

    const closeLabel = 'Close RO-Crate'
    WorkspaceCommands.CLOSE.label = closeLabel
    this.updateCommandLabel(WorkspaceCommands.CLOSE.id, closeLabel)
  }

  protected updateCommandLabel(commandId: string, label: string): void {
    const command = this.commandRegistry.getCommand(commandId)
    if (!command) {
      return
    }
    command.label = label
    command.originalLabel = label
  }

  protected removeWorkspaceMenuItems(): void {
    this.menuRegistry.unregisterMenuAction(
      WorkspaceCommands.OPEN_WORKSPACE.id,
      CommonMenus.FILE_OPEN,
    )
    this.menuRegistry.unregisterMenuAction(
      WorkspaceCommands.ADD_FOLDER.id,
      FILE_WORKSPACE,
    )
    this.menuRegistry.unregisterMenuAction(
      WorkspaceCommands.SAVE_WORKSPACE_AS.id,
      FILE_WORKSPACE,
    )

    this.menuRegistry.unregisterMenuAction(
      WorkspaceCommands.OPEN_FOLDER.id,
      CommonMenus.FILE_OPEN,
    )
    this.menuRegistry.registerMenuAction(CommonMenus.FILE_OPEN, {
      commandId: WorkspaceCommands.OPEN_FOLDER.id,
      label: 'Open Folder as RO-Crate',
      order: 'a02',
    })
  }

  protected removeWorkspaceCommands(): void {
    this.commandRegistry.unregisterCommand(WorkspaceCommands.OPEN_WORKSPACE.id)
    this.commandRegistry.unregisterCommand(WorkspaceCommands.ADD_FOLDER.id)
    this.commandRegistry.unregisterCommand(WorkspaceCommands.SAVE_WORKSPACE_AS.id)
  }

  protected removeWorkspaceKeybindings(): void {
    this.keybindingRegistry.unregisterKeybinding(WorkspaceCommands.OPEN_WORKSPACE.id)
    this.keybindingRegistry.unregisterKeybinding(WorkspaceCommands.ADD_FOLDER.id)
    this.keybindingRegistry.unregisterKeybinding(WorkspaceCommands.SAVE_WORKSPACE_AS.id)
  }

  protected async persistRoCrateToDisk(): Promise<void> {
    if (
      !this.appStateService.roCrate &&
      !Array.isArray(this.appStateService.ignoreList)
    ) {
      return
    }
    if (this.persistPromise) {
      return this.persistPromise
    }
    this.persistPromise = this.writeRoCrateFiles()
    try {
      await this.persistPromise
    } finally {
      this.persistPromise = undefined
    }
  }

  protected async writeRoCrateFiles(): Promise<void> {
    const crateData = this.appStateService.roCrate
    const roots = this.workspaceService.tryGetRoots()
    const rootUri = roots?.[0]?.resource
    if (!rootUri) {
      return
    }

    if (crateData) {
      const metadataUri = rootUri.resolve('ro-crate-metadata.json')
      const previewUri = rootUri.resolve('ro-crate-preview.html')
      try {
        await this.fileService.create(metadataUri, JSON.stringify(crateData, null, 2), {
          overwrite: true,
        })
        const htmlContent = this.roCrateHtmlGenerator.generate(crateData)
        await this.fileService.create(previewUri, htmlContent, { overwrite: true })
        this.appStateService.setRoCrateSnapshot(crateData)
        this.appStateService.dirty = false
      } catch (error) {
        console.error('Failed to persist RO-Crate metadata:', error)
      }
    }

    try {
      await this.persistIgnoredEntries(rootUri)
    } catch (error) {
      console.error('Failed to persist ignored entries:', error)
    }
  }

  protected async persistIgnoredEntries(rootUri: URI): Promise<void> {
    const entries = this.appStateService.ignoreList
    if (!Array.isArray(entries)) {
      return
    }

    const normalized = this.withDefaultIgnoredEntries(entries)
    const aromaUri = rootUri.resolve(AROMA_IGNORE_DIR)
    if (!(await this.fileService.exists(aromaUri))) {
      await this.fileService.createFolder(aromaUri)
    }

    const ignoredUri = aromaUri.resolve(AROMA_IGNORE_FILE)
    const payload = normalized.length ? `${normalized.join('\n')}\n` : ''
    await this.fileService.create(ignoredUri, payload, { overwrite: true })
    this.appStateService.ignoreList = normalized
  }

  protected withDefaultIgnoredEntries(entries: readonly string[]): string[] {
    const normalizedEntries = entries
      .map((entry) => this.normalizeIgnoredEntry(entry))
      .filter((entry): entry is string => Boolean(entry))

    const defaults = DEFAULT_IGNORED_ENTRIES.map((entry) =>
      this.normalizeIgnoredEntry(entry),
    ).filter((entry): entry is string => Boolean(entry))

    const existingPositive = new Set(
      normalizedEntries.filter((entry) => !entry.startsWith('!')),
    )
    const missingDefaults = defaults.filter((entry) => !existingPositive.has(entry))
    if (!missingDefaults.length) {
      return normalizedEntries
    }
    return [...missingDefaults, ...normalizedEntries]
  }

  protected normalizeIgnoredEntry(value: string): string | undefined {
    const trimmed = (value || '').trim()
    if (!trimmed || trimmed.startsWith('#')) {
      return undefined
    }

    const negated = trimmed.startsWith('!')
    let normalized = negated ? trimmed.slice(1) : trimmed
    normalized = normalized.replace(/\\/g, '/')
    normalized = normalized.replace(/^\.\//, '')
    normalized = normalized.replace(/^\/+/, '')
    normalized = normalized.replace(/\/{2,}/g, '/')
    const isDirectory = normalized.endsWith('/')
    if (isDirectory) {
      normalized = normalized.replace(/\/+$/, '')
    }
    if (!normalized) {
      return undefined
    }
    return `${negated ? '!' : ''}${normalized}${isDirectory ? '/' : ''}`.toLowerCase()
  }
}

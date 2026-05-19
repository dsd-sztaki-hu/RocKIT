import {
  CommonCommands,
  CommonMenus,
  ConfirmDialog,
  ConfirmSaveDialog,
  Dialog,
  FrontendApplication,
  FrontendApplicationContribution,
  OnWillStopAction,
} from '@theia/core/lib/browser'
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding'
import { SaveReason } from '@theia/core/lib/browser/saveable'
import { SaveableService } from '@theia/core/lib/browser/saveable-service'
import { WindowService } from '@theia/core/lib/browser/window/window-service'
import {
  Command,
  CommandContribution,
  CommandRegistry,
  CommandService,
  MenuContribution,
  MenuModelRegistry,
  MessageService,
} from '@theia/core/lib/common'
import { URI } from '@theia/core/lib/common/uri'
import { inject, injectable } from '@theia/core/shared/inversify'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceCommands, WorkspaceService } from '@theia/workspace/lib/browser'
import { FILE_WORKSPACE } from '@theia/workspace/lib/browser/workspace-frontend-contribution'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateLoaderContribution } from 'app-state/lib/browser/state/ro-crate-loader'
import { ApplicationResetService, RoCrateHtmlGenerator } from 'aroma2-common/lib/browser'
import {
  AROMA_IGNORE_DIR,
  AROMA_IGNORE_FILE,
  DEFAULT_IGNORED_ENTRIES as SHARED_DEFAULT_IGNORED_ENTRIES,
} from 'aroma2-common/lib/common/ro-crate-technical-files'

const DEFAULT_IGNORED_ENTRIES = [
  ...SHARED_DEFAULT_IGNORED_ENTRIES,
  '.claude/',
] as const

type UnsavedCloseState = {
  hasUnsaved: boolean
  roCrateUnsaved: boolean
  ignoreListUnsaved: boolean
}

const ResetApplicationCommand: Command = {
  id: 'aroma.application.reset',
  label: 'Reset the application',
}

const RevertToSavedRoCrateCommand: Command = {
  id: 'aroma.ro-crate.revert-to-saved',
  label: 'Revert to saved RO-Crate',
}

@injectable()
export class ApplicationFileMenuOverrides implements FrontendApplicationContribution, CommandContribution, MenuContribution {
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

  @inject(ApplicationResetService)
  protected readonly applicationResetService: ApplicationResetService

  @inject(MessageService)
  protected readonly messageService: MessageService

  @inject(WindowService)
  protected readonly windowService: WindowService

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

  onWillStop(_app: FrontendApplication): OnWillStopAction<UnsavedCloseState> | undefined {
    if (!this.hasPotentialUnsavedChanges()) {
      return undefined
    }

    return {
      reason: 'Unsaved RO-Crate metadata or ignore list changes',
      priority: 90,
      prepare: () => this.detectUnsavedStateFromDisk(),
      action: (prepared) => this.handleUnsavedCloseAction(prepared),
    }
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(RevertToSavedRoCrateCommand, {
      execute: () => this.revertToSavedRoCrate(),
      isEnabled: () => Boolean(this.workspaceService.tryGetRoots()?.[0]?.resource),
    })

    commands.registerCommand(ResetApplicationCommand, {
      execute: () => this.resetApplication(),
    })
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.FILE, {
      commandId: RevertToSavedRoCrateCommand.id,
      label: RevertToSavedRoCrateCommand.label,
      order: 'z90',
    })

    menus.registerMenuAction(CommonMenus.FILE, {
      commandId: ResetApplicationCommand.id,
      label: ResetApplicationCommand.label,
      order: 'z99',
    })
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

  protected async revertToSavedRoCrate(): Promise<void> {
    if (this.hasPotentialUnsavedRoCrateChanges()) {
      const confirmed = await new ConfirmDialog({
        title: 'Revert to saved RO-Crate',
        msg:
          'This will discard unsaved RO-Crate metadata changes and reload ro-crate-metadata.json from disk. Continue?',
        ok: 'Revert',
        cancel: Dialog.CANCEL,
      }).open()

      if (!confirmed) {
        return
      }
    }

    try {
      await this.roCrateLoader.revertToSavedRoCrate()
      await this.messageService.info('Reloaded saved RO-Crate metadata.', {
        timeout: 3000,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.messageService.error(`Failed to reload saved RO-Crate: ${message}`)
    }
  }

  protected hasPotentialUnsavedRoCrateChanges(): boolean {
    const roCrate = this.appStateService.roCrate
    return Boolean(roCrate) && this.appStateService.isRoCrateDirty(roCrate)
  }

  protected async resetApplication(): Promise<void> {
    const confirmed = await new ConfirmDialog({
      title: 'Reset the application',
      msg:
        'This will delete the application configuration directory in your user folder and restart AROMA. Unsaved changes will be lost. Continue?',
      ok: 'Reset and restart',
      cancel: Dialog.CANCEL,
    }).open()

    if (!confirmed) {
      return
    }

    try {
      await this.applicationResetService.resetApplication()
      if (this.workspaceService.opened) {
        await this.commandService.executeCommand(WorkspaceCommands.CLOSE.id)
      } else {
        this.windowService.reload()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.messageService.error(`Failed to reset the application: ${message}`)
    }
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

  protected hasPotentialUnsavedChanges(): boolean {
    const roCrate = this.appStateService.roCrate
    const roCrateDirty = Boolean(roCrate) && this.appStateService.isRoCrateDirty(roCrate)
    const ignoreListDirty = this.appStateService.isIgnoreListDirty(
      this.appStateService.ignoreList,
    )
    return roCrateDirty || ignoreListDirty
  }

  protected async detectUnsavedStateFromDisk(): Promise<UnsavedCloseState> {
    const rootUri = this.workspaceService.tryGetRoots()?.[0]?.resource
    if (!rootUri) {
      return { hasUnsaved: false, roCrateUnsaved: false, ignoreListUnsaved: false }
    }

    const roCrateUnsaved = await this.isRoCrateUnsaved(rootUri)
    const ignoreListUnsaved = await this.isIgnoreListUnsaved(rootUri)
    return {
      hasUnsaved: roCrateUnsaved || ignoreListUnsaved,
      roCrateUnsaved,
      ignoreListUnsaved,
    }
  }

  protected async handleUnsavedCloseAction(
    prepared: UnsavedCloseState,
  ): Promise<boolean> {
    if (!prepared.hasUnsaved) {
      return true
    }

    const changedFiles: string[] = []
    if (prepared.roCrateUnsaved) {
      changedFiles.push('ro-crate-metadata.json')
    }
    if (prepared.ignoreListUnsaved) {
      changedFiles.push('.aroma/ignored.txt')
    }

    const messageNode = document.createElement('div')
    const intro = document.createElement('div')
    intro.textContent = 'You have unsaved changes in:'
    messageNode.appendChild(intro)

    const list = document.createElement('ul')
    list.style.margin = '8px 0 0 18px'
    for (const fileName of changedFiles) {
      const li = document.createElement('li')
      li.textContent = fileName
      list.appendChild(li)
    }
    messageNode.appendChild(list)

    const result = await new ConfirmSaveDialog({
      title: 'Save Changes Before Closing?',
      msg: messageNode,
      dontSave: "Don't Save",
      save: 'Save',
      cancel: Dialog.CANCEL,
    }).open()

    if (result === true) {
      await this.persistRoCrateToDisk()
      const recheck = await this.detectUnsavedStateFromDisk()
      return !recheck.hasUnsaved
    }

    if (result === false) {
      return true
    }

    return false
  }

  protected async isRoCrateUnsaved(rootUri: URI): Promise<boolean> {
    const appCrate = this.appStateService.roCrate
    const metadataUri = rootUri.resolve('ro-crate-metadata.json')
    let diskCrate: Record<string, any> | undefined

    if (await this.fileService.exists(metadataUri)) {
      try {
        const content = await this.fileService.read(metadataUri)
        diskCrate = JSON.parse(content.value)
      } catch {
        return Boolean(appCrate)
      }
    }

    return this.normalizeRoCrate(appCrate) !== this.normalizeRoCrate(diskCrate)
  }

  protected async isIgnoreListUnsaved(rootUri: URI): Promise<boolean> {
    const ignoredUri = rootUri.resolve(AROMA_IGNORE_DIR).resolve(AROMA_IGNORE_FILE)
    const diskEntries = this.withDefaultIgnoredEntries(
      await this.readIgnoredEntries(ignoredUri),
    )
    const stateEntries = this.withDefaultIgnoredEntries(
      this.appStateService.ignoreList ?? [],
    )
    return !this.sameEntries(stateEntries, diskEntries)
  }

  protected normalizeRoCrate(value: Record<string, any> | undefined): string | undefined {
    if (!value) {
      return undefined
    }
    try {
      return JSON.stringify(value)
    } catch {
      return undefined
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
    this.appStateService.setIgnoreListSnapshot(normalized)
  }

  protected async readIgnoredEntries(ignoreFileUri: URI): Promise<string[]> {
    try {
      const content = await this.fileService.read(ignoreFileUri)
      const text = `${content.value ?? ''}`
      return text
        .split(/\r?\n/g)
        .map((line) => this.normalizeIgnoredEntry(line))
        .filter((line): line is string => Boolean(line))
    } catch {
      return []
    }
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

  protected sameEntries(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) {
      return false
    }
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) {
        return false
      }
    }
    return true
  }
}

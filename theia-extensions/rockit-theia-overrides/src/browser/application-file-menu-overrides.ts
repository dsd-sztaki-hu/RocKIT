// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import {
  ApplicationShell,
  CommonCommands,
  CommonMenus,
  ConfirmDialog,
  ConfirmSaveDialog,
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
  nls,
} from '@theia/core/lib/common'
import { URI } from '@theia/core/lib/common/uri'
import { inject, injectable } from '@theia/core/shared/inversify'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceCommands, WorkspaceService } from '@theia/workspace/lib/browser'
import { FILE_WORKSPACE } from '@theia/workspace/lib/browser/workspace-frontend-contribution'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateLoaderContribution } from 'app-state/lib/browser/state/ro-crate-loader'
import { ApplicationResetService, readUtf8TextFile, writeUtf8TextFile } from 'rockit-common/lib/browser'
import {
  ROCKIT_IGNORE_DIR,
  ROCKIT_IGNORE_FILE,
  DEFAULT_IGNORED_ENTRIES as SHARED_DEFAULT_IGNORED_ENTRIES,
} from 'rockit-common/lib/common/ro-crate-technical-files'
import { RoCrateEditorWidget } from 'ro-crate-editor/lib/browser/ro-crate-editor-widget'
import { RoCratePersistenceService } from 'save-ro-crate/lib/browser/ro-crate-persistence-service'

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
  id: 'rockit.application.reset',
  label: nls.localize('rockit/file/resetApplication', 'Reset the Application'),
}

const RevertToSavedRoCrateCommand: Command = {
  id: 'rockit.ro-crate.revert-to-saved',
  label: nls.localize('rockit/file/revertToSaved', 'Revert to Saved RO-Crate'),
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

  @inject(RoCratePersistenceService)
  protected readonly persistenceService: RoCratePersistenceService

  @inject(SaveableService)
  protected readonly saveableService: SaveableService

  @inject(ApplicationResetService)
  protected readonly applicationResetService: ApplicationResetService

  @inject(MessageService)
  protected readonly messageService: MessageService

  @inject(WindowService)
  protected readonly windowService: WindowService

  @inject(ApplicationShell)
  protected readonly shell: ApplicationShell

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
      reason: nls.localize(
        'rockit/file/unsavedReason',
        'Unsaved RO-Crate metadata or ignore list changes',
      ),
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
    const openFolderLabel = nls.localize(
      'rockit/file/openFolder',
      'Open Folder as RO-Crate',
    )
    WorkspaceCommands.OPEN_FOLDER.label = openFolderLabel
    WorkspaceCommands.OPEN_FOLDER.dialogLabel = openFolderLabel
    this.updateCommandLabel(WorkspaceCommands.OPEN_FOLDER.id, openFolderLabel)

    const openRecentLabel = nls.localize(
      'rockit/file/openRecent',
      'Open Recent RO-Crate',
    )
    WorkspaceCommands.OPEN_RECENT_WORKSPACE.label = openRecentLabel
    this.updateCommandLabel(WorkspaceCommands.OPEN_RECENT_WORKSPACE.id, openRecentLabel)

    const closeLabel = nls.localize('rockit/file/close', 'Close RO-Crate')
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
      label: nls.localize('rockit/file/openFolder', 'Open Folder as RO-Crate'),
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
        title: nls.localize(
          'rockit/file/revertTitle',
          'Revert to saved RO-Crate',
        ),
        msg: nls.localize(
          'rockit/file/revertMessage',
          'This will discard unsaved RO-Crate metadata changes and reload ro-crate-metadata.json from disk. Continue?',
        ),
        ok: nls.localize('rockit/file/revert', 'Revert'),
        cancel: nls.localize('rockit/common/cancel', 'Cancel'),
      }).open()

      if (!confirmed) {
        return
      }
    }

    try {
      await this.roCrateLoader.revertToSavedRoCrate()
      this.clearRoCrateEditorDirtyFlags()
      await this.messageService.info(nls.localize(
        'rockit/file/reloaded',
        'Reloaded saved RO-Crate metadata.',
      ), {
        timeout: 3000,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.messageService.error(nls.localize(
        'rockit/file/reloadFailed',
        'Failed to reload saved RO-Crate: {0}',
        message,
      ))
    }
  }

  protected hasPotentialUnsavedRoCrateChanges(): boolean {
    const roCrate = this.appStateService.roCrate
    return Boolean(roCrate) && this.appStateService.isRoCrateDirty(roCrate)
  }

  protected clearRoCrateEditorDirtyFlags(): void {
    const crate = this.appStateService.roCrate
    for (const widget of this.shell.widgets) {
      if (widget instanceof RoCrateEditorWidget) {
        widget.resetDirtyStateAfterRoCrateReload(crate)
      }
    }
  }

  protected async resetApplication(): Promise<void> {
    const confirmed = await new ConfirmDialog({
      title: nls.localize('rockit/file/resetTitle', 'Reset the application'),
      msg: nls.localize(
        'rockit/file/resetMessage',
        'This will delete the application configuration directory in your user folder and restart RocKIT. Unsaved changes will be lost. Continue?',
      ),
      ok: nls.localize('rockit/file/resetAndRestart', 'Reset and restart'),
      cancel: nls.localize('rockit/common/cancel', 'Cancel'),
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
      this.messageService.error(nls.localize(
        'rockit/file/resetFailed',
        'Failed to reset the application: {0}',
        message,
      ))
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
    if (!this.hasPotentialUnsavedChanges()) {
      return
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
      changedFiles.push('.rockit/ignored.txt')
    }

    const messageNode = document.createElement('div')
    const intro = document.createElement('div')
    intro.textContent = nls.localize(
      'rockit/file/unsavedChanges',
      'You have unsaved changes in:',
    )
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
      title: nls.localize(
        'rockit/file/saveBeforeClosing',
        'Save Changes Before Closing?',
      ),
      msg: messageNode,
      dontSave: nls.localize('rockit/file/dontSave', "Don't Save"),
      save: nls.localize('rockit/file/save', 'Save'),
      cancel: nls.localize('rockit/common/cancel', 'Cancel'),
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
        diskCrate = JSON.parse(await readUtf8TextFile(this.fileService, metadataUri))
      } catch {
        return Boolean(appCrate)
      }
    }

    return this.normalizeRoCrate(appCrate) !== this.normalizeRoCrate(diskCrate)
  }

  protected async isIgnoreListUnsaved(rootUri: URI): Promise<boolean> {
    const ignoredUri = rootUri.resolve(ROCKIT_IGNORE_DIR).resolve(ROCKIT_IGNORE_FILE)
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
      try {
        await this.persistenceService.write(rootUri, crateData)
        this.appStateService.setRoCrateSnapshot(crateData)
        this.appStateService.dirty = false
      } catch (error) {
        console.error('Failed to persist RO-Crate metadata:', error)
        const message = error instanceof Error ? error.message : String(error)
        this.messageService.error(nls.localize(
          'rockit/file/saveFailed',
          'Failed to save RO-Crate: {0}',
          message,
        ), {
          timeout: 10000,
        })
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
    const rockitUri = rootUri.resolve(ROCKIT_IGNORE_DIR)
    if (!(await this.fileService.exists(rockitUri))) {
      await this.fileService.createFolder(rockitUri)
    }

    const ignoredUri = rockitUri.resolve(ROCKIT_IGNORE_FILE)
    const payload = normalized.length ? `${normalized.join('\n')}\n` : ''
    await writeUtf8TextFile(this.fileService, ignoredUri, payload)
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

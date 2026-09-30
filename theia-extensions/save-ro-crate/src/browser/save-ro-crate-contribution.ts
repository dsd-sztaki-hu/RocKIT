// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { ApplicationShell, CommonCommands, CommonMenus } from '@theia/core/lib/browser'
import {
  Command,
  CommandContribution,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
  MessageService,
  nls,
} from '@theia/core/lib/common'
import URI from '@theia/core/lib/common/uri'
import { inject, injectable } from '@theia/core/shared/inversify'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { withDefaultIgnoredEntries, writeUtf8TextFile } from 'rockit-common/lib/browser'
import { RoCratePersistenceService } from './ro-crate-persistence-service'
import {
  ROCKIT_IGNORE_DIR,
  ROCKIT_IGNORE_FILE,
} from 'rockit-common/lib/common/ro-crate-technical-files'
import { EditorWidget } from '@theia/editor/lib/browser'
import { SaveableService } from '@theia/core/lib/browser/saveable-service'

// Make sure this string matches exactly what is defined in your EditorWidget
const RO_CRATE_EDITOR_ID = 'rocrate-editor-widget'

export const SaveRoCrateCommand: Command = {
  id: 'ro-crate.save',
  label: nls.localize('rockit/saveRoCrate/command', 'Save RO-Crate'),
}

@injectable()
export class SaveRoCrateContribution implements CommandContribution, MenuContribution {
  @inject(MessageService)
  protected readonly messageService!: MessageService

  @inject(AppStateService)
  protected readonly appStateService!: AppStateService

  @inject(FileService)
  protected readonly fileService!: FileService

  @inject(WorkspaceService)
  protected readonly workspaceService!: WorkspaceService

  @inject(ApplicationShell)
  protected readonly shell!: ApplicationShell

  @inject(RoCratePersistenceService)
  protected readonly persistenceService!: RoCratePersistenceService

  @inject(SaveableService)
  protected readonly saveableService!: SaveableService

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(SaveRoCrateCommand, {
      execute: () => this.doSave(),
    })

    registry.unregisterCommand(CommonCommands.SAVE.id)
    registry.registerCommand(CommonCommands.SAVE, {
      execute: () => this.handleSaveKeybinding(),
      isEnabled: () => this.isRoCrateEditorFocused() || this.isFileEditorFocused(),
    })
  }

  private async handleSaveKeybinding(): Promise<void> {
    if (this.isRoCrateEditorFocused()) {
      await this.saveCurrentEditor()
      return
    }
    await this.saveCurrentEditor()
  }

  /**
   * Checks if the active widget is one of your RO-Crate editors
   */
  private isRoCrateEditorFocused(): boolean {
    const activeWidget = this.shell.activeWidget || this.shell.currentWidget

    if (!activeWidget) {
      return false
    }

    return activeWidget.id.startsWith(RO_CRATE_EDITOR_ID)
  }

  private isFileEditorFocused(): boolean {
    const activeWidget = this.shell.activeWidget || this.shell.currentWidget

    if (!activeWidget) {
      return false
    }
    return activeWidget instanceof EditorWidget
  }

  private async saveCurrentEditor(): Promise<void> {
    const widget = this.shell.activeWidget || this.shell.currentWidget
    if (!widget) {
      return
    }
    await this.saveableService.save(widget)
  }

  private async doSave(): Promise<void> {
    if (this.isRoCrateEditorFocused()) {
      await this.saveCurrentEditor()
      return
    }

    const roots = this.workspaceService.tryGetRoots()
    if (!roots || roots.length === 0) return

    const rootUri = roots[0].resource
    const crateData = this.appStateService.roCrate
    const ignoredEntries = this.appStateService.ignoreList

    try {
      if (crateData) {
        await this.persistenceService.write(rootUri, crateData)
      }

      if (Array.isArray(ignoredEntries)) {
        await this.persistIgnoredEntries(rootUri, ignoredEntries)
      }

      if (crateData && Array.isArray(ignoredEntries)) {
        await this.messageService.info(
          nls.localize(
            'rockit/saveRoCrate/savedAll',
            'RO-Crate, HTML preview, and ignored rules saved!',
          ),
          {
            timeout: 3000,
          },
        )
      } else if (crateData) {
        await this.messageService.info(
          nls.localize(
            'rockit/saveRoCrate/savedCrate',
            'RO-Crate and HTML preview file saved!',
          ),
          { timeout: 3000 },
        )
      } else if (Array.isArray(ignoredEntries)) {
        await this.messageService.info(
          nls.localize('rockit/saveRoCrate/savedIgnored', 'Ignored rules saved!'),
          { timeout: 3000 },
        )
      }

      if (crateData) {
        this.appStateService.setRoCrateSnapshot(crateData)
        this.appStateService.dirty = false
      }
    } catch (error) {
      await this.messageService.error(
        nls.localize('rockit/saveRoCrate/failed', 'Save failed: {0}', String(error)),
      )
    }
  }

  protected async persistIgnoredEntries(
    rootUri: URI,
    entries: readonly string[],
  ): Promise<void> {
    const normalized = withDefaultIgnoredEntries(entries)
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

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.FILE_SAVE, {
      commandId: SaveRoCrateCommand.id,
      label: SaveRoCrateCommand.label,
      order: 'a11',
    })
  }
}

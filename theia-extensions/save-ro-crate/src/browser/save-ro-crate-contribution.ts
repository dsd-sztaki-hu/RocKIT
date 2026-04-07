import { ApplicationShell, CommonCommands, CommonMenus } from '@theia/core/lib/browser'
import {
  Command,
  CommandContribution,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
  MessageService,
} from '@theia/core/lib/common'
import URI from '@theia/core/lib/common/uri'
import { inject, injectable } from '@theia/core/shared/inversify'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateHtmlGenerator } from 'aroma2-common/lib/browser'
import { EditorWidget } from '@theia/editor/lib/browser'
import { SaveableService } from '@theia/core/lib/browser/saveable-service'

// Make sure this string matches exactly what is defined in your EditorWidget
const RO_CRATE_EDITOR_ID = 'rocrate-editor-widget'; 

const AROMA_IGNORE_DIR = '.aroma'
const AROMA_IGNORE_FILE = 'ignored.txt'
const DEFAULT_IGNORED_ENTRIES = [
  'ro-crate-preview.html',
  'ro-crate-metadata.json',
  'AGENTS.md',
  'CLAUDE.md',
  '.aroma/',
] as const

export const SaveRoCrateCommand: Command = {
  id: 'ro-crate.save',
  label: 'Save RO-Crate',
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

  @inject(RoCrateHtmlGenerator)
  protected readonly roCrateHtmlGenerator!: RoCrateHtmlGenerator

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

    return activeWidget.id.startsWith(RO_CRATE_EDITOR_ID);
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
    const metadataUri = rootUri.resolve('ro-crate-metadata.json')
    const previewUri = rootUri.resolve('ro-crate-preview.html')

    const crateData = this.appStateService.roCrate
    const ignoredEntries = this.appStateService.ignoreList

    try {
      if (crateData) {
        await this.fileService.create(metadataUri, JSON.stringify(crateData, null, 2), {
          overwrite: true,
        })

        const htmlContent = this.roCrateHtmlGenerator.generate(crateData)

        await this.fileService.create(previewUri, htmlContent, { overwrite: true })
      }

      if (Array.isArray(ignoredEntries)) {
        await this.persistIgnoredEntries(rootUri, ignoredEntries)
      }

      if (crateData && Array.isArray(ignoredEntries)) {
        await this.messageService.info('RO-Crate, HTML preview, and ignored rules saved!', {
          timeout: 3000,
        })
      } else if (crateData) {
        await this.messageService.info('RO-Crate and HTML preview file saved!', {
          timeout: 3000,
        })
      } else if (Array.isArray(ignoredEntries)) {
        await this.messageService.info('Ignored rules saved!', {
          timeout: 3000,
        })
      }

      if (crateData) {
        this.appStateService.setRoCrateSnapshot(crateData)
        this.appStateService.dirty = false
      }
    } catch (error) {
      await this.messageService.error(`Save failed: ${error}`)
    }
  }

  protected async persistIgnoredEntries(rootUri: URI, entries: readonly string[]): Promise<void> {
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

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.FILE_SAVE, {
      commandId: SaveRoCrateCommand.id,
      label: SaveRoCrateCommand.label,
      order: 'a11',
    })
  }
}

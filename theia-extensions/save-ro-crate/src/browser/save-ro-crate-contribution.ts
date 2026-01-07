import { ApplicationShell, CommonCommands, CommonMenus } from '@theia/core/lib/browser'
import {
  Command,
  CommandContribution,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
  MessageService,
} from '@theia/core/lib/common'
import { inject, injectable } from '@theia/core/shared/inversify'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateEditorWidget } from 'ro-crate-editor/lib/browser/ro-crate-editor-widget'

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
  protected readonly fileService: FileService

  @inject(WorkspaceService)
  protected readonly workspaceService: WorkspaceService

  @inject(ApplicationShell)
  protected readonly shell!: ApplicationShell

  registerCommands(registry: CommandRegistry): void {
    // Register the custom button command
    registry.registerCommand(SaveRoCrateCommand, {
      execute: () => this.doSave(),
    })

    // Register a handler for the global Save (Ctrl+S)
    registry.registerHandler(CommonCommands.SAVE.id, {
      execute: () => this.doSave(),
      // Enable this handler ONLY when your widget is the one in focus
      isEnabled: () => this.isRoCrateEditorFocused(),
    })
  }

  /**
   * Checks if the active widget is one of your RO-Crate editors
   */
  private isRoCrateEditorFocused(): boolean {
    const activeWidget = this.shell.activeWidget || this.shell.currentWidget

    if (!activeWidget) {
      return false
    }

    // Check by class instance or ID prefix
    return (
      activeWidget instanceof RoCrateEditorWidget ||
      activeWidget.id.startsWith(RoCrateEditorWidget.ID)
    )
  }

  /**
   * Shared saving logic
   */
  private async doSave(): Promise<void> {
    const roots = this.workspaceService.tryGetRoots()
    if (!roots || roots.length === 0) {
      this.messageService.error('No workspace root found.')
      return
    }

    const rootUri = roots[0].resource
    const metadataUri = rootUri.resolve('ro-crate-metadata.json')

    try {
      await this.fileService.create(
        metadataUri,
        JSON.stringify(this.appStateService.roCrate, null, 2),
        { overwrite: true },
      )
      this.messageService.info('RO-Crate saved successfully!')
    } catch (error) {
      this.messageService.error(`Failed to save: ${error}`)
    }
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.FILE_SAVE, {
      commandId: SaveRoCrateCommand.id,
      label: SaveRoCrateCommand.label,
      order: 'a11',
    })
  }
}

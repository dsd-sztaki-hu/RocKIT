import {
  CommonCommands,
  CommonMenus,
  KeybindingContribution,
  KeybindingRegistry,
} from '@theia/core/lib/browser'
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

export const SaveRoCrateCommand: Command = {
  id: 'ro-crate.save',
  label: 'Save RO-Crate',
}

@injectable()
export class SaveRoCrateContribution
  implements KeybindingContribution, CommandContribution, MenuContribution
{
  @inject(MessageService)
  protected readonly messageService!: MessageService

  @inject(AppStateService)
  protected readonly appStateService!: AppStateService

  @inject(FileService)
  protected readonly fileService: FileService

  @inject(WorkspaceService)
  protected readonly workspaceService: WorkspaceService

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(SaveRoCrateCommand, {
      execute: async () => {
        const roots = this.workspaceService.tryGetRoots()
        const rootUri = roots[0].resource
        const metadataUri = rootUri.resolve('ro-crate-metadata.json')
        await this.fileService.create(
          metadataUri,
          JSON.stringify(this.appStateService.roCrate, null, 2),
          {
            overwrite: true,
          },
        )
        this.messageService.info('RO-Crate saved successfully!')
      },
    })
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.FILE_SAVE, {
      commandId: SaveRoCrateCommand.id,
      label: SaveRoCrateCommand.label,
      order: 'a11',
    })
  }

  // Remove the default Ctrl+S keybinding and register our own
  registerKeybindings(keybindings: KeybindingRegistry): void {
    keybindings.unregisterKeybinding(CommonCommands.SAVE)
    keybindings.registerKeybinding({
      command: SaveRoCrateCommand.id,
      keybinding: 'ctrl+s',
    })
  }
}

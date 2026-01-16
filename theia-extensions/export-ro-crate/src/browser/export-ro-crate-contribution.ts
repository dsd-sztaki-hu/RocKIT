import { CommonMenus } from '@theia/core/lib/browser'
import {
  Command,
  CommandContribution,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
  MessageService,
} from '@theia/core/lib/common'
import { inject, injectable } from '@theia/core/shared/inversify'
import { ExportRoCrateDialog, ExportRoCrateMode } from './export-ro-crate-dialog'

export const ExportRoCrateCommand: Command = {
  id: 'ExportRoCrate.command',
  label: 'Export RO-Crate',
}

@injectable()
export class ExportRoCrateCommandContribution implements CommandContribution {
  @inject(MessageService)
  protected readonly messageService!: MessageService

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(ExportRoCrateCommand, {
      execute: async () => {
        const dialog = new ExportRoCrateDialog()
        const result = await dialog.open()
        if (!result) {
          return
        }
        const modeLabel =
          result === ExportRoCrateMode.Clean ? 'Clean export' : 'Normal export'
        this.messageService.info(`Export triggered (${modeLabel}).`)
      },
    })
  }
}

@injectable()
export class ExportRoCrateMenuContribution implements MenuContribution {
  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.FILE, {
      commandId: ExportRoCrateCommand.id,
      label: ExportRoCrateCommand.label,
    })
  }
}

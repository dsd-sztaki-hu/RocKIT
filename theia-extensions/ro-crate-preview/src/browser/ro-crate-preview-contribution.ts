import type {
  CommandContribution,
  MenuContribution,
  MenuModelRegistry,
} from '@theia/core'
import { CommonMenus } from '@theia/core/lib/browser'
import type { Command, CommandRegistry } from '@theia/core/lib/common/command'
import { inject, injectable } from '@theia/core/shared/inversify'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { ROCratePreviewDialog } from './ro-crate-preview-dialog'

export const RoCratePreviewCommand: Command = { id: 'RO-Crate Preview' }

@injectable()
export class RoCratePreviewContribution implements CommandContribution, MenuContribution {
  @inject(AppStateService)
  protected readonly appStateService!: AppStateService

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(RoCratePreviewCommand, {
      execute: async () => {
        const dialog = new ROCratePreviewDialog(this.appStateService)
        await dialog.open()
      },
    })
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.VIEW, {
      commandId: RoCratePreviewCommand.id,
      label: RoCratePreviewCommand.label,
    })
  }
}

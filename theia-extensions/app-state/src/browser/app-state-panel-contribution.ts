import {
  ApplicationShell,
  CommonMenus,
  type FrontendApplicationContribution,
  WidgetManager,
} from '@theia/core/lib/browser'
import type {
  Command,
  CommandContribution,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
} from '@theia/core/lib/common'
import { inject, injectable } from 'inversify'
import { AppStatePanelWidget } from './app-state-panel-widget'
import { AppStateService } from './state/app-state-service'

export const OpenAppStatePanelCommand: Command = {
  id: 'app-state-extension:open-app-state-panel',
  label: 'Show AppState Panel',
  category: 'View',
}

@injectable()
export class AppStatePanelContribution
  implements FrontendApplicationContribution, CommandContribution, MenuContribution
{
  @inject(AppStateService)
  protected readonly appState: AppStateService

  @inject(WidgetManager)
  protected readonly widgetManager: WidgetManager

  @inject(ApplicationShell)
  protected readonly shell: ApplicationShell

  onStart(): void {
    // Panel will be opened manually via command or menu
    console.log('[AppStatePanelContribution] started')
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(OpenAppStatePanelCommand, {
      execute: async () => {
        this.openPanel()
      },
    })
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.VIEW, {
      commandId: OpenAppStatePanelCommand.id,
      label: OpenAppStatePanelCommand.label,
    })
  }

  private async openPanel(): Promise<void> {
    const widget = await this.widgetManager.getOrCreateWidget<AppStatePanelWidget>(
      AppStatePanelWidget.ID,
    )
    if (!widget.isAttached) {
      this.shell.addWidget(widget, { area: 'bottom' })
    }
    this.shell.activateWidget(widget.id)
  }
}

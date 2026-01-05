import type { MenuModelRegistry } from '@theia/core'
import {
  AbstractViewContribution,
  ApplicationShell,
  CommonMenus,
  WidgetManager,
} from '@theia/core/lib/browser'
import type { Command, CommandRegistry } from '@theia/core/lib/common/command'
import { inject, injectable } from 'inversify'
import { DatasetPanelWidget } from './dataset-panel-widget'

export const DatasetPanelCommand: Command = {
  id: 'dataset-panel:command',
  label: 'Open New Dataset Panel',
}

@injectable()
export class DatasetPanelContribution extends AbstractViewContribution<DatasetPanelWidget> {
  constructor(
    @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
    @inject(ApplicationShell) protected readonly shell: ApplicationShell,
  ) {
    super({
      widgetId: DatasetPanelWidget.ID,
      widgetName: 'Dataset Panel',
      defaultWidgetOptions: { area: 'main' },
    })
  }

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(DatasetPanelCommand, {
      execute: async () => {
        const widget = await this.widgetManager.getOrCreateWidget(DatasetPanelWidget.ID, {
          instance: Math.random().toString(),
        })
        this.shell.addWidget(widget, { area: 'main' })
        this.shell.activateWidget(widget.id)
      },
    })
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.VIEW, {
      commandId: DatasetPanelCommand.id,
      label: DatasetPanelCommand.label,
    })
  }
}

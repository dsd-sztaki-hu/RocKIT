import type { MenuModelRegistry } from '@theia/core'
import {
  AbstractViewContribution,
  ApplicationShell,
  CommonMenus,
  WidgetManager,
} from '@theia/core/lib/browser'
import type { Command, CommandRegistry } from '@theia/core/lib/common/command'
import { inject, injectable } from 'inversify'
import { RoCrateStructurePanelWidget } from './ro-crate-structure-panel-widget'

export const DatasetPanelCommand: Command = {
  id: 'dataset-panel:command',
  label: 'Open New RO-Crate Structure Panel',
}

@injectable()
export class RoCrateStructurePanelContribution extends AbstractViewContribution<RoCrateStructurePanelWidget> {
  constructor(
    @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
    @inject(ApplicationShell) protected readonly shell: ApplicationShell,
  ) {
    super({
      widgetId: RoCrateStructurePanelWidget.ID,
      widgetName: 'RO-Crate Structure Panel',
      defaultWidgetOptions: { area: 'main' },
    })
  }

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(DatasetPanelCommand, {
      execute: async () => {
        const widget = await this.widgetManager.getOrCreateWidget(
          RoCrateStructurePanelWidget.ID,
          {
            instance: Math.random().toString(),
          },
        )
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

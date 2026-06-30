import type { MenuModelRegistry } from '@theia/core'
import {
  AbstractViewContribution,
  ApplicationShell,
  CommonMenus,
  WidgetManager,
} from '@theia/core/lib/browser'
import { RoCrateDeleteSelectedEntitiesCommand } from 'rockit-common/lib/browser'
import type { Command, CommandRegistry } from '@theia/core/lib/common/command'
import { inject, injectable } from 'inversify'
import {
  RO_CRATE_STRUCTURE_PANEL_CONTEXT_MENU,
  RoCrateStructurePanelWidget,
} from './ro-crate-structure-panel-widget'

export const DatasetPanelCommand: Command = {
  id: 'dataset-panel:command',
  label: 'Open New RO-Crate Structure Panel',
}

export const RoCrateStructurePanelEditCommand: Command = {
  id: 'ro-crate-structure-panel:edit',
  label: 'Edit',
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

    registry.registerCommand(RoCrateStructurePanelEditCommand, {
      execute: async () => {
        const widget = this.getActiveStructureWidget()
        if (!widget) {
          return
        }
        await widget.openEditFromContextMenu()
      },
      isEnabled: () => Boolean(this.getActiveStructureWidget()),
      isVisible: () => Boolean(this.getActiveStructureWidget()),
    })

  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.VIEW, {
      commandId: DatasetPanelCommand.id,
      label: DatasetPanelCommand.label,
    })

    menus.registerMenuAction(RO_CRATE_STRUCTURE_PANEL_CONTEXT_MENU, {
      commandId: RoCrateStructurePanelEditCommand.id,
      label: RoCrateStructurePanelEditCommand.label,
    })
    menus.registerMenuAction(RO_CRATE_STRUCTURE_PANEL_CONTEXT_MENU, {
      commandId: RoCrateDeleteSelectedEntitiesCommand.id,
      label: RoCrateDeleteSelectedEntitiesCommand.label,
    })
  }

  protected getActiveStructureWidget(): RoCrateStructurePanelWidget | undefined {
    const current = this.shell.currentWidget
    if (current instanceof RoCrateStructurePanelWidget) {
      return current
    }
    const mainWidgets = this.shell.getWidgets('main')
    return mainWidgets.find(
      (widget) => widget instanceof RoCrateStructurePanelWidget,
    ) as RoCrateStructurePanelWidget | undefined
  }
}

import type { MenuModelRegistry } from '@theia/core'
import {
  AbstractViewContribution,
  ApplicationShell,
  codicon,
  CommonMenus,
  OpenerService,
  WidgetManager,
} from '@theia/core/lib/browser'
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar'
import { ApplicationServer } from '@theia/core/lib/common/application-protocol'
import { nls } from '@theia/core/lib/common/nls'
import {
  openRockitDocumentationPage,
  ROCKIT_DOCUMENTATION_PAGES,
  RoCrateDeleteSelectedEntitiesCommand,
} from 'rockit-common/lib/browser'
import type { Command, CommandRegistry } from '@theia/core/lib/common/command'
import { inject, injectable } from 'inversify'
import {
  RO_CRATE_STRUCTURE_PANEL_CONTEXT_MENU,
  RoCrateStructurePanelWidget,
} from './ro-crate-structure-panel-widget'

export const DatasetPanelCommand: Command = {
  id: 'dataset-panel:command',
  label: nls.localize(
    'rockit/structurePanel/openNew',
    'Open New RO-Crate Structure Panel',
  ),
}

export const RoCrateStructurePanelEditCommand: Command = {
  id: 'ro-crate-structure-panel:edit',
  label: nls.localize('rockit/structurePanel/edit', 'Edit'),
}

export const RoCrateStructurePanelDeleteEntityCommand: Command = {
  id: 'ro-crate-structure-panel:delete-entity',
  label: 'Delete Entity',
}

export const RoCrateStructurePanelDocumentationCommand: Command = {
  id: 'ro-crate-structure-panel:open-documentation',
  label: nls.localize(
    'rockit/structurePanel/openDocumentation',
    'Open RO-Crate Structure Panel Documentation',
  ),
  iconClass: codicon('info'),
}

@injectable()
export class RoCrateStructurePanelContribution extends AbstractViewContribution<RoCrateStructurePanelWidget> implements TabBarToolbarContribution {
  constructor(
    @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
    @inject(ApplicationShell) protected readonly shell: ApplicationShell,
    @inject(ApplicationServer) protected readonly applicationServer: ApplicationServer,
    @inject(OpenerService) protected readonly openerService: OpenerService,
  ) {
    super({
      widgetId: RoCrateStructurePanelWidget.ID,
      widgetName: nls.localize(
        'rockit/structurePanel/title',
        'RO-Crate Structure Panel',
      ),
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

    registry.registerCommand(RoCrateStructurePanelDeleteEntityCommand, {
      execute: async () => {
        const widget = this.getActiveStructureWidget()
        if (widget) {
          await widget.deleteEntitiesFromContextMenu()
        }
      },
      isEnabled: () => Boolean(
        this.getActiveStructureWidget()?.canDeleteEntitiesFromContextMenu(),
      ),
      isVisible: () => Boolean(this.getActiveStructureWidget()),
    })

    registry.registerCommand(RoCrateStructurePanelDocumentationCommand, {
      execute: () =>
        openRockitDocumentationPage(
          this.applicationServer,
          this.openerService,
          ROCKIT_DOCUMENTATION_PAGES.RO_CRATE_STRUCTURE_PANEL,
        ),
      isEnabled: (widget) => widget instanceof RoCrateStructurePanelWidget,
      isVisible: (widget) => widget instanceof RoCrateStructurePanelWidget,
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
    menus.registerMenuAction(RO_CRATE_STRUCTURE_PANEL_CONTEXT_MENU, {
      commandId: RoCrateStructurePanelDeleteEntityCommand.id,
      label: 'Delete Entity (Shift+Delete)',
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

  async registerToolbarItems(toolbarRegistry: TabBarToolbarRegistry): Promise<void> {
    toolbarRegistry.registerItem({
      id: RoCrateStructurePanelDocumentationCommand.id,
      command: RoCrateStructurePanelDocumentationCommand.id,
      tooltip: RoCrateStructurePanelDocumentationCommand.label,
      priority: -100,
    })
  }
}

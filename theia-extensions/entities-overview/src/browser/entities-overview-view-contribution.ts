import { Command, CommandRegistry, MenuModelRegistry } from '@theia/core'
import { AbstractViewContribution, codicon, OpenerService } from '@theia/core/lib/browser'
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar'
import { ApplicationServer } from '@theia/core/lib/common/application-protocol'
import { nls } from '@theia/core/lib/common/nls'
import { inject, injectable } from '@theia/core/shared/inversify'
import {
  openRockitDocumentationPage,
  ROCKIT_DOCUMENTATION_PAGES,
  RoCrateDeleteSelectedEntitiesCommand,
} from 'rockit-common/lib/browser'
// import { ExampleTreeNode } from './entities-overview-model'
import {
  EntitiesOverviewWidget,
  TREEVIEW_EXAMPLE_CONTEXT_MENU,
} from './entities-overview-widget'

/** Definition of a command to show the Entities Overview View */
export const OpenEntitiesOverviewView: Command = {
  id: 'theia-examples:treeview-example-view-command-id',
}

export const ToggleEntitiesOverviewFilters: Command = {
  id: 'entities-overview:toggle-filters',
  iconClass: codicon('search'),
}

export const CollapseAllEntitiesOverviewNodes: Command = {
  id: 'entities-overview:collapse-all',
  iconClass: codicon('collapse-all'),
}

export const ExpandAllEntitiesOverviewNodes: Command = {
  id: 'entities-overview:expand-all',
  iconClass: codicon('expand-all'),
}

export const OpenEntitiesOverviewDocumentation: Command = {
  id: 'entities-overview:open-documentation',
  label: nls.localize('rockit/entitiesOverview/openDocumentation', 'Open Entities Documentation'),
  iconClass: codicon('info'),
}

export const EntitiesOverviewContextEditCommand: Command = {
  id: 'entities-overview:context-edit',
  label: nls.localize('rockit/entitiesOverview/edit', 'Edit'),
}

/** Definition of a command to add a new child (to demonstrate context menus) */
/*export const EntitiesOverviewTreeAddItem: Command = {
  id: 'theia-examples:treeview-example-tree-add-item-command-id',
  label: 'Entities Overview View: Add New Child',
}*/

/**
 * Contribution of the `EntitiesOverviewViewContribution`
 */
@injectable()
export class EntitiesOverviewViewContribution extends AbstractViewContribution<EntitiesOverviewWidget> implements TabBarToolbarContribution {
  constructor(
    @inject(ApplicationServer) protected readonly applicationServer: ApplicationServer,
    @inject(OpenerService) protected readonly openerService: OpenerService,
  ) {
    super({
      widgetId: EntitiesOverviewWidget.ID,
      widgetName: EntitiesOverviewWidget.LABEL,
      defaultWidgetOptions: { area: 'right' },
      toggleCommandId: OpenEntitiesOverviewView.id,
    })
  }

  /*override registerCommands(commands: CommandRegistry): void {
      super.registerCommands(commands)

      // register the "Add child item" command
      commands.registerCommand(EntitiesOverviewTreeAddItem, {
        execute: () => {
          // get the TreeViewExampleWidget
          const widget = this.tryGetWidget()
          if (widget) {
            // get the selected item
            const parent = widget.model.selectedNodes[0]
            if (parent) {
              // call the addItem logic
              widget.model.addItem(parent)
            }
          }
        },
        isVisible: () => {
          // access the TreeViewExampleWidget
          const widget = this.tryGetWidget()
          // only show the command if an ExampleTreeNode is selected
          return !!(
            widget &&
            widget.model.selectedNodes.length > 0 &&
            ExampleTreeNode.is(widget.model.selectedNodes[0])
          )
        },
      })
  }*/

  override registerMenus(menus: MenuModelRegistry): void {
    super.registerMenus(menus)

    menus.registerMenuAction(TREEVIEW_EXAMPLE_CONTEXT_MENU, {
      commandId: EntitiesOverviewContextEditCommand.id,
      label: EntitiesOverviewContextEditCommand.label,
    })
    menus.registerMenuAction(TREEVIEW_EXAMPLE_CONTEXT_MENU, {
      commandId: RoCrateDeleteSelectedEntitiesCommand.id,
      label: RoCrateDeleteSelectedEntitiesCommand.label,
    })
  }

  override registerCommands(commands: CommandRegistry): void {
    super.registerCommands(commands)

    commands.registerCommand(ToggleEntitiesOverviewFilters, {
      execute: (widget) =>
        this.withWidget(widget, (view) => view.toggleFiltersVisibility()),
      isEnabled: (widget) => this.withWidget(widget, () => true) || false,
      isVisible: (widget) => this.withWidget(widget, () => true) || false,
      isToggled: (widget) =>
        this.withWidget(widget, (view) => view.isFiltersVisible()) || false,
    })

    commands.registerCommand(CollapseAllEntitiesOverviewNodes, {
      execute: (widget) =>
        this.withWidget(widget, async (view) => view.collapseAllEntityNodes()),
      isEnabled: (widget) =>
        this.withWidget(widget, (view) => view.hasExpandedEntityNodes()) || false,
      isVisible: (widget) =>
        this.withWidget(widget, (view) => view.hasExpandedEntityNodes()) || false,
    })

    commands.registerCommand(ExpandAllEntitiesOverviewNodes, {
      execute: (widget) =>
        this.withWidget(widget, async (view) => view.expandAllEntityNodes()),
      isEnabled: (widget) =>
        this.withWidget(widget, (view) => !view.hasExpandedEntityNodes()) || false,
      isVisible: (widget) =>
        this.withWidget(widget, (view) => !view.hasExpandedEntityNodes()) || false,
    })

    commands.registerCommand(EntitiesOverviewContextEditCommand, {
      execute: (widget) =>
        this.withWidget(widget, async (view) => view.openEditFromContextMenu()),
      isEnabled: (widget) =>
        this.withWidget(widget, (view) => view.canOpenEditFromContextMenu()) || false,
      isVisible: (widget) => this.withWidget(widget, () => true) || false,
    })

    commands.registerCommand(OpenEntitiesOverviewDocumentation, {
      execute: () =>
        openRockitDocumentationPage(
          this.applicationServer,
          this.openerService,
          ROCKIT_DOCUMENTATION_PAGES.ENTITIES_PANEL,
        ),
      isEnabled: (widget) => this.withWidget(widget, () => true) || false,
      isVisible: (widget) => this.withWidget(widget, () => true) || false,
    })
  }

  async registerToolbarItems(toolbarRegistry: TabBarToolbarRegistry): Promise<void> {
    const widget = await this.widget
    const onDidChange = widget.model.onChanged

    toolbarRegistry.registerItem({
      id: ToggleEntitiesOverviewFilters.id,
      command: ToggleEntitiesOverviewFilters.id,
      tooltip: nls.localize('rockit/entitiesOverview/toggleFilters', 'Show/Hide Filters'),
      priority: 0,
    })

    toolbarRegistry.registerItem({
      id: OpenEntitiesOverviewDocumentation.id,
      command: OpenEntitiesOverviewDocumentation.id,
      tooltip: OpenEntitiesOverviewDocumentation.label,
      priority: -100,
    })

    toolbarRegistry.registerItem({
      id: CollapseAllEntitiesOverviewNodes.id,
      command: CollapseAllEntitiesOverviewNodes.id,
      tooltip: nls.localize('rockit/entitiesOverview/collapseAll', 'Collapse All'),
      priority: 1,
      onDidChange,
    })

    toolbarRegistry.registerItem({
      id: ExpandAllEntitiesOverviewNodes.id,
      command: ExpandAllEntitiesOverviewNodes.id,
      tooltip: nls.localize('rockit/entitiesOverview/expandAll', 'Expand All'),
      priority: 1,
      onDidChange,
    })
  }

  protected withWidget<T>(
    widget: unknown,
    cb: (view: EntitiesOverviewWidget) => T,
  ): T | false {
    const candidate = widget ?? this.tryGetWidget()
    if (candidate instanceof EntitiesOverviewWidget) {
      return cb(candidate)
    }
    return false
  }
}

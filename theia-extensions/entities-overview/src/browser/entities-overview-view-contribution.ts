import { Command, CommandRegistry, MenuModelRegistry } from '@theia/core'
import { AbstractViewContribution, codicon } from '@theia/core/lib/browser'
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar'
import { injectable } from '@theia/core/shared/inversify'
// import { ExampleTreeNode } from './entities-overview-model'
import {
  EntitiesOverviewWidget,
  // TREEVIEW_EXAMPLE_CONTEXT_MENU,
} from './entities-overview-widget'

/** Definition of a command to show the Entities Overview View */
export const OpenEntitiesOverviewView: Command = {
  id: 'theia-examples:treeview-example-view-command-id',
}

export const ToggleEntitiesOverviewFilters: Command = {
  id: 'entities-overview:toggle-filters',
  iconClass: codicon('search'),
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
  constructor() {
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

    // add the "Add Child" menu item to the context menu
    /*menus.registerMenuAction([...TREEVIEW_EXAMPLE_CONTEXT_MENU, '_1'],
            {
                commandId: EntitiesOverviewTreeAddItem.id,
                label: 'Add Child'
            });*/
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
  }

  async registerToolbarItems(toolbarRegistry: TabBarToolbarRegistry): Promise<void> {
    toolbarRegistry.registerItem({
      id: ToggleEntitiesOverviewFilters.id,
      command: ToggleEntitiesOverviewFilters.id,
      tooltip: 'Show/Hide Filters',
      priority: 0,
    })
  }

  protected withWidget<T>(
    widget: unknown = this.tryGetWidget(),
    cb: (view: EntitiesOverviewWidget) => T,
  ): T | false {
    if (widget instanceof EntitiesOverviewWidget) {
      return cb(widget)
    }
    return false
  }
}

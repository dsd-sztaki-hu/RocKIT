import { Command, CommandRegistry, MenuModelRegistry } from '@theia/core';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import { injectable } from '@theia/core/shared/inversify';
import { ExampleTreeNode } from './entities-overview-model';
import { TREEVIEW_EXAMPLE_CONTEXT_MENU, EntitiesOverviewWidget } from './entities-overview-widget';

/** Definition of a command to show the Entities Overview View */
export const OpenEntitiesOverviewView: Command = {
    id: 'theia-examples:treeview-example-view-command-id'
};

/** Definition of a command to add a new child (to demonstrate context menus) */
export const EntitiesOverviewTreeAddItem: Command = {
    id: 'theia-examples:treeview-example-tree-add-item-command-id',
    label: 'Entities Overview View: Add New Child'
};

/**
 * Contribution of the `EntitiesOverviewViewContribution`
 */
@injectable()
export class EntitiesOverviewViewContribution extends AbstractViewContribution<EntitiesOverviewWidget> {
    constructor() {
        super({
            widgetId: EntitiesOverviewWidget.ID,
            widgetName: EntitiesOverviewWidget.LABEL,
            defaultWidgetOptions: { area: 'right' },
            toggleCommandId: OpenEntitiesOverviewView.id
        });
    }

    override registerCommands(commands: CommandRegistry): void {
        super.registerCommands(commands);

        // register the "Add child item" command
        commands.registerCommand(EntitiesOverviewTreeAddItem, {
            execute: () => {
                // get the TreeViewExampleWidget
                const widget = this.tryGetWidget();
                if (widget) {
                    // get the selected item
                    const parent = widget.model.selectedNodes[0];
                    if (parent) {
                        // call the addItem logic
                        widget.model.addItem(parent);
                    }
                }
            },
            isVisible: () => {
                // access the TreeViewExampleWidget
                const widget = this.tryGetWidget();
                // only show the command if an ExampleTreeNode is selected
                return !!(widget && widget.model.selectedNodes.length > 0 && ExampleTreeNode.is(widget.model.selectedNodes[0]));
            }
        });
    }

    override registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);

        // add the "Add Child" menu item to the context menu
        menus.registerMenuAction([...TREEVIEW_EXAMPLE_CONTEXT_MENU, '_1'],
            {
                commandId: EntitiesOverviewTreeAddItem.id,
                label: 'Add Child'
            });
    }
}

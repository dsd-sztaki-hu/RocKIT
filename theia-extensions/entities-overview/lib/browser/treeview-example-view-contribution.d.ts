import { Command, CommandRegistry, MenuModelRegistry } from '@theia/core';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import { TreeViewExampleWidget } from './treeview-example-widget';
/** Definition of a command to show the TreeView Example View */
export declare const OpenTreeviewExampleView: Command;
/** Definition of a command to add a new child (to demonstrate context menus) */
export declare const TreeviewExampleTreeAddItem: Command;
/**
 * Contribution of the `TreeViewExampleWidget`
 */
export declare class TreeviewExampleViewContribution extends AbstractViewContribution<TreeViewExampleWidget> {
    constructor();
    registerCommands(commands: CommandRegistry): void;
    registerMenus(menus: MenuModelRegistry): void;
}
//# sourceMappingURL=treeview-example-view-contribution.d.ts.map
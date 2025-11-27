"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TreeviewExampleViewContribution = exports.TreeviewExampleTreeAddItem = exports.OpenTreeviewExampleView = void 0;
const browser_1 = require("@theia/core/lib/browser");
const inversify_1 = require("@theia/core/shared/inversify");
const treeview_example_model_1 = require("./treeview-example-model");
const treeview_example_widget_1 = require("./treeview-example-widget");
/** Definition of a command to show the TreeView Example View */
exports.OpenTreeviewExampleView = {
    id: 'theia-examples:treeview-example-view-command-id'
};
/** Definition of a command to add a new child (to demonstrate context menus) */
exports.TreeviewExampleTreeAddItem = {
    id: 'theia-examples:treeview-example-tree-add-item-command-id',
    label: 'Example Tree View: Add New Child'
};
/**
 * Contribution of the `TreeViewExampleWidget`
 */
let TreeviewExampleViewContribution = class TreeviewExampleViewContribution extends browser_1.AbstractViewContribution {
    constructor() {
        super({
            widgetId: treeview_example_widget_1.TreeViewExampleWidget.ID,
            widgetName: treeview_example_widget_1.TreeViewExampleWidget.LABEL,
            defaultWidgetOptions: { area: 'right' },
            toggleCommandId: exports.OpenTreeviewExampleView.id
        });
    }
    registerCommands(commands) {
        super.registerCommands(commands);
        // register the "Add child item" command
        commands.registerCommand(exports.TreeviewExampleTreeAddItem, {
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
                return !!(widget && widget.model.selectedNodes.length > 0 && treeview_example_model_1.ExampleTreeNode.is(widget.model.selectedNodes[0]));
            }
        });
    }
    registerMenus(menus) {
        super.registerMenus(menus);
        // add the "Add Child" menu item to the context menu
        menus.registerMenuAction([...treeview_example_widget_1.TREEVIEW_EXAMPLE_CONTEXT_MENU, '_1'], {
            commandId: exports.TreeviewExampleTreeAddItem.id,
            label: 'Add Child'
        });
    }
};
exports.TreeviewExampleViewContribution = TreeviewExampleViewContribution;
exports.TreeviewExampleViewContribution = TreeviewExampleViewContribution = __decorate([
    (0, inversify_1.injectable)(),
    __metadata("design:paramtypes", [])
], TreeviewExampleViewContribution);
//# sourceMappingURL=treeview-example-view-contribution.js.map
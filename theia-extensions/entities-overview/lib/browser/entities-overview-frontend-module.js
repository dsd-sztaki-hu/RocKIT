"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@theia/core");
const browser_1 = require("@theia/core/lib/browser");
const inversify_1 = require("@theia/core/shared/inversify");
const treeview_example_decoration_service_1 = require("./decorator/treeview-example-decoration-service");
const treeview_example_demo_decorator_1 = require("./decorator/treeview-example-demo-decorator");
const treeview_example_label_provider_1 = require("./treeview-example-label-provider");
const treeview_example_model_1 = require("./treeview-example-model");
const treeview_example_tree_1 = require("./treeview-example-tree");
const treeview_example_view_contribution_1 = require("./treeview-example-view-contribution");
const treeview_example_widget_1 = require("./treeview-example-widget");
const treeview_example_tree_item_factory_1 = require("./treeview-example-tree-item-factory");
/**
 * Frontend contribution bindings.
 */
exports.default = new inversify_1.ContainerModule(bind => {
    (0, browser_1.bindViewContribution)(bind, treeview_example_view_contribution_1.TreeviewExampleViewContribution);
    bind(browser_1.WidgetFactory).toDynamicValue(ctx => ({
        id: treeview_example_widget_1.TreeViewExampleWidget.ID,
        createWidget: () => createTreeViewExampleViewContainer(ctx.container).get(treeview_example_widget_1.TreeViewExampleWidget)
    })).inSingletonScope();
    bind(treeview_example_model_1.TreeViewExampleModel).toSelf().inSingletonScope();
    bind(browser_1.LabelProviderContribution).to(treeview_example_label_provider_1.TreeViewExampleLabelProvider);
    bind(treeview_example_demo_decorator_1.TreeviewExampleDemoDecorator).toSelf().inSingletonScope();
    bind(treeview_example_decoration_service_1.TreeviewExampleDecorator).toService(treeview_example_demo_decorator_1.TreeviewExampleDemoDecorator);
});
/**
 * Create the child container which contains the `TreeViewExampleWidget` and all its collaborators
 * in an isolated child container so the bound services affect only the `TreeViewExampleWidget`
 *
 * @param parent the parent container
 * @returns the new child container
 */
function createTreeViewExampleViewContainer(parent) {
    const child = (0, browser_1.createTreeContainer)(parent, {
        tree: treeview_example_tree_1.TreeviewExampleTree,
        model: treeview_example_model_1.TreeViewExampleModel,
        widget: treeview_example_widget_1.TreeViewExampleWidget,
        props: {
            contextMenuPath: treeview_example_widget_1.TREEVIEW_EXAMPLE_CONTEXT_MENU,
            multiSelect: false,
            search: true,
            expandOnlyOnExpansionToggleClick: false
        },
        decoratorService: treeview_example_decoration_service_1.TreeviewExampleDecorationService,
    });
    (0, core_1.bindContributionProvider)(child, treeview_example_decoration_service_1.TreeviewExampleDecorator);
    child.bind(treeview_example_tree_item_factory_1.TreeViewExampleTreeItemFactory).toSelf().inSingletonScope();
    return child;
}
//# sourceMappingURL=entities-overview-frontend-module.js.map
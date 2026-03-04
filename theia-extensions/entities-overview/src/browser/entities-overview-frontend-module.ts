import { bindContributionProvider } from '@theia/core';
import { bindViewContribution, createTreeContainer, LabelProviderContribution, WidgetFactory } from '@theia/core/lib/browser';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { Container, ContainerModule, interfaces } from '@theia/core/shared/inversify';
import { EntitiesOverviewDecorationService, TreeviewExampleDecorator } from './decorator/entities-overview-decoration-service';
import { EntitiesOverviewDecorator } from './decorator/entities-overview-decorator';
import { EntitiesOverviewLabelProvider } from './entities-overview-label-provider';
import { EntitiesOverviewModel } from './entities-overview-model';
import { EntitiesOverviewTree } from './entities-overview-tree';
import { EntitiesOverviewViewContribution } from './entities-overview-view-contribution';
import { TREEVIEW_EXAMPLE_CONTEXT_MENU, EntitiesOverviewWidget } from './entities-overview-widget';
import { EntitiesOverviewTreeItemFactory } from './entities-overview-tree-item-factory';

/**
 * Frontend contribution bindings.
 */
export default new ContainerModule(bind => {
    bindViewContribution(bind, EntitiesOverviewViewContribution);
    bind(TabBarToolbarContribution).toService(EntitiesOverviewViewContribution);

    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: EntitiesOverviewWidget.ID,
        createWidget: () => createTreeViewExampleViewContainer(ctx.container).get(EntitiesOverviewWidget)
    })).inSingletonScope();

    bind(EntitiesOverviewModel).toSelf().inSingletonScope();
    bind(LabelProviderContribution).to(EntitiesOverviewLabelProvider);

    bind(EntitiesOverviewDecorator).toSelf().inSingletonScope();
    bind(TreeviewExampleDecorator).toService(EntitiesOverviewDecorator);
});

/**
 * Create the child container which contains the `TreeViewExampleWidget` and all its collaborators
 * in an isolated child container so the bound services affect only the `TreeViewExampleWidget`
 *
 * @param parent the parent container
 * @returns the new child container
 */
function createTreeViewExampleViewContainer(parent: interfaces.Container): Container {
    const child = createTreeContainer(parent, {
        tree: EntitiesOverviewTree,
        model: EntitiesOverviewModel,
        widget: EntitiesOverviewWidget,
        props: {
            contextMenuPath: TREEVIEW_EXAMPLE_CONTEXT_MENU,
            multiSelect: false,
            search: false,
            expandOnlyOnExpansionToggleClick: false
        },
        decoratorService: EntitiesOverviewDecorationService,
    });
    bindContributionProvider(child, TreeviewExampleDecorator);
    child.bind(EntitiesOverviewTreeItemFactory).toSelf().inSingletonScope();
    return child;
}

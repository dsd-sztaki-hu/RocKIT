import { ContainerModule } from 'inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { WidgetFactory, FrontendApplicationContribution } from '@theia/core/lib/browser';

import { DataRepositoryManagerWidget, DATA_REPOSITORY_MANAGER_WIDGET_ID } from './data-repository-manager-widget';
import { DataRepositoryManagerContribution } from './data-repository-manager-contribution';

export default new ContainerModule(bind => {
    // 1. Widget
    bind(DataRepositoryManagerWidget).toSelf().inTransientScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: DATA_REPOSITORY_MANAGER_WIDGET_ID,
        createWidget: () => ctx.container.get(DataRepositoryManagerWidget)
    })).inSingletonScope();

    // 2. Contributions
    bind(DataRepositoryManagerContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(DataRepositoryManagerContribution);
    bind(MenuContribution).toService(DataRepositoryManagerContribution);
    bind(FrontendApplicationContribution).toService(DataRepositoryManagerContribution);
});
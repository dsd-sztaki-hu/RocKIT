import { ContainerModule } from 'inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { WidgetFactory, FrontendApplicationContribution } from '@theia/core/lib/browser';

import { DataRepositoryManagerWidget, DATA_REPOSITORY_MANAGER_WIDGET_ID } from './data-repository-manager-widget';
import { DataRepositoryManagerContribution } from './data-repository-manager-contribution';
import { DataRepositoryStoreService } from './services/data-repository-store-service';
import { DataverseService } from './services/dataverse-service';
import { DataverseCollectionService } from './services/dataverse-collection-service';
import { ArpRoCrateExportService } from './services/arp-ro-crate-export-service';

export default new ContainerModule(bind => {
    // 1. Services
    bind(DataRepositoryStoreService).toSelf().inSingletonScope();
    bind(DataverseService).toSelf().inSingletonScope();
    bind(DataverseCollectionService).toSelf().inSingletonScope();
    bind(ArpRoCrateExportService).toSelf().inSingletonScope();

    // 2. Widget
    bind(DataRepositoryManagerWidget).toSelf().inTransientScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: DATA_REPOSITORY_MANAGER_WIDGET_ID,
        createWidget: () => ctx.container.get(DataRepositoryManagerWidget)
    })).inSingletonScope();

    // 3. Contributions
    bind(DataRepositoryManagerContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(DataRepositoryManagerContribution);
    bind(MenuContribution).toService(DataRepositoryManagerContribution);
    bind(FrontendApplicationContribution).toService(DataRepositoryManagerContribution);
});

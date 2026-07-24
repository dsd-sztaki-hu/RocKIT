import { ContainerModule } from 'inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import {
    WidgetFactory,
    FrontendApplicationContribution
} from '@theia/core/lib/browser';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';

import {
    DataRepositoryManagerWidget,
    DATA_REPOSITORY_MANAGER_WIDGET_ID
} from './data-repository-manager-widget';
import { DataRepositoryManagerContribution } from './data-repository-manager-contribution';
import { DataRepositoryStoreService } from './services/data-repository-store-service';
import { DataverseService } from './services/dataverse-service';
import { DataverseCollectionService } from './services/dataverse-collection-service';
import { ArpRoCrateExportService } from './services/arp-ro-crate-export-service';
import { ArpRoCrateImportService } from './services/arp-ro-crate-import-service';
import { NativeDataverseExportService } from './services/native-dataverse-export-service';
import { NativeDataverseImportService } from './services/native-dataverse-import-service';
import { DataverseCapabilityService } from './services/dataverse-capability-service';
import { RoCrateFileHashService } from './services/ro-crate-file-hash-service';
import { ZenodoExportService } from './services/zenodo-export-service';
import { DataRepositoryExportDeleteService } from './services/data-repository-export-delete-service';
import { DataverseMetadataBlockCacheService } from './services/dataverse-metadata-block-cache-service';
import { DataverseMetadataMappingService } from './services/dataverse-metadata-mapping-service';

export default new ContainerModule(bind => {
    // 1. Services
    bind(DataRepositoryStoreService).toSelf().inSingletonScope();
    bind(DataverseService).toSelf().inSingletonScope();
    bind(DataverseCollectionService).toSelf().inSingletonScope();
    bind(ArpRoCrateExportService).toSelf().inSingletonScope();
    bind(ArpRoCrateImportService).toSelf().inSingletonScope();
    bind(NativeDataverseExportService).toSelf().inSingletonScope();
    bind(NativeDataverseImportService).toSelf().inSingletonScope();
    bind(DataverseCapabilityService).toSelf().inSingletonScope();
    bind(RoCrateFileHashService).toSelf().inSingletonScope();
    bind(ZenodoExportService).toSelf().inSingletonScope();
    bind(DataRepositoryExportDeleteService).toSelf().inSingletonScope();
    bind(DataverseMetadataBlockCacheService).toSelf().inSingletonScope();
    bind(DataverseMetadataMappingService).toSelf().inSingletonScope();

    // 2. Widget
    bind(DataRepositoryManagerWidget).toSelf().inTransientScope();

    bind(WidgetFactory)
        .toDynamicValue(ctx => ({
            id: DATA_REPOSITORY_MANAGER_WIDGET_ID,
            createWidget: () =>
                ctx.container.get(DataRepositoryManagerWidget)
        }))
        .inSingletonScope();

    // 3. Contributions
    bind(DataRepositoryManagerContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(DataRepositoryManagerContribution);
    bind(MenuContribution).toService(DataRepositoryManagerContribution);
    bind(FrontendApplicationContribution).toService(
        DataRepositoryManagerContribution
    );
    bind(TabBarToolbarContribution).toService(
        DataRepositoryManagerContribution
    );
});
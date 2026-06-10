import { ContainerModule } from 'inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { WidgetFactory, FrontendApplicationContribution, WebSocketConnectionProvider } from '@theia/core/lib/browser';

import { MetadataSchemaManagerWidget, METADATA_SCHEMA_MANAGER_WIDGET_ID } from './metadata-schema-manager-widget';
import { MetadataSchemaManagerContribution } from './metadata-schema-manager-contribution';
import { SchemaManagerService } from './services/metadata-schema-manager-service';
import { RemoteSchemaProviderStoreService } from './services/remote-schema-provider-store-service';
import { MetadataSchemaSelectorContribution } from './components/metadata-schema-selector'; 
import { RemoteSchemaBrowserContribution } from './components/remote-schema-browser-dialog';
import { MetadataSchemaManager as MetadataSchemaManagerToken } from 'aroma2-common/lib/browser';
import {
    METADATA_PROFILE_CORE_PATH,
    MetadataProfileCoreService
} from '../common/metadata-profile-core-protocol';
import './styles/index.css';


export default new ContainerModule(bind => {
    // 1. Widget
    bind(MetadataSchemaManagerWidget).toSelf().inTransientScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: METADATA_SCHEMA_MANAGER_WIDGET_ID,
        createWidget: () => ctx.container.get(MetadataSchemaManagerWidget)
    })).inSingletonScope();

    // 2. Services
    bind(MetadataProfileCoreService).toDynamicValue(ctx => {
        const connectionProvider = ctx.container.get(WebSocketConnectionProvider);
        return connectionProvider.createProxy<MetadataProfileCoreService>(METADATA_PROFILE_CORE_PATH);
    }).inSingletonScope();
    bind(RemoteSchemaProviderStoreService).toSelf().inSingletonScope();
    bind(SchemaManagerService).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(SchemaManagerService);
    bind(MetadataSchemaManagerToken).toService(SchemaManagerService);

    // 3. Manager Contribution
    bind(MetadataSchemaManagerContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(MetadataSchemaManagerContribution);
    bind(MenuContribution).toService(MetadataSchemaManagerContribution);
    bind(FrontendApplicationContribution).toService(MetadataSchemaManagerContribution);

    // 4. Schema Selector Dialog
    bind(MetadataSchemaSelectorContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(MetadataSchemaSelectorContribution);

    // 5. Remote Browser Dialog
    bind(RemoteSchemaBrowserContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(RemoteSchemaBrowserContribution);
});

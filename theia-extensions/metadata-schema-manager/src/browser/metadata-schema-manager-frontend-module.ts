import { ContainerModule } from 'inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { WidgetFactory, FrontendApplicationContribution } from '@theia/core/lib/browser';

import { MetadataSchemaManagerWidget, METADATA_SCHEMA_MANAGER_WIDGET_ID } from './metadata-schema-manager-widget';
import { MetadataSchemaManagerContribution } from './metadata-schema-manager-contribution';
import { SchemaManagerService } from './services/metadata-schema-manager-service';
import { MetadataSchemaSelectorContribution } from './components/metadata-schema-selector'; 
import { RemoteSchemaBrowserContribution } from './components/remote-schema-browser-dialog';

import './style/index.css';

export default new ContainerModule(bind => {
    // 1. Widget
    bind(MetadataSchemaManagerWidget).toSelf().inTransientScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: METADATA_SCHEMA_MANAGER_WIDGET_ID,
        createWidget: () => ctx.container.get(MetadataSchemaManagerWidget)
    })).inSingletonScope();

    // 2. Service
    bind(SchemaManagerService).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(SchemaManagerService);

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
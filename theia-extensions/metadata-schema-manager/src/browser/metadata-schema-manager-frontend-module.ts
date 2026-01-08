// src/browser/metadata-schema-manager-frontend-module.ts
import { ContainerModule } from 'inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { WidgetFactory, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MetadataSchemaManagerWidget, METADATA_SCHEMA_MANAGER_WIDGET_ID } from './metadata-schema-manager-widget';
import { MetadataSchemaManagerContribution } from './metadata-schema-manager-contribution';
import { SchemaManagerService } from './metadata-schema-manager-service';

export default new ContainerModule(bind => {
    // Change from inSingletonScope() to inTransientScope() to create a new instance each time
    bind(MetadataSchemaManagerWidget).toSelf().inTransientScope();
    
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: METADATA_SCHEMA_MANAGER_WIDGET_ID,
        createWidget: () => {
            // Create a new widget instance each time
            const widget = ctx.container.get(MetadataSchemaManagerWidget);
            console.log("Creating new MetadataSchemaManagerWidget instance");
            return widget;
        }
    })).inSingletonScope();
    bind(SchemaManagerService).toSelf().inSingletonScope();
    
    bind(MetadataSchemaManagerContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(MetadataSchemaManagerContribution);
    bind(MenuContribution).toService(MetadataSchemaManagerContribution);
    bind(FrontendApplicationContribution).toService(MetadataSchemaManagerContribution);
    bind(FrontendApplicationContribution).toService(SchemaManagerService);
});
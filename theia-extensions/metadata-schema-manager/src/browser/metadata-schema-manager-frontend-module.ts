// src/browser/metadata-schema-manager-frontend-module.ts
import { ContainerModule } from 'inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { WidgetFactory, FrontendApplicationContribution } from '@theia/core/lib/browser';

import { MetadataSchemaManagerWidget, METADATA_SCHEMA_MANAGER_WIDGET_ID } from './metadata-schema-manager-widget';
import { MetadataSchemaManagerContribution } from './metadata-schema-manager-contribution';
import { SchemaManagerService } from './metadata-schema-manager-service';
import { SchemaSelectorDialogContribution } from './schema-selector-dialog'; // <--- NEW IMPORT

export default new ContainerModule(bind => {
    // 1. Widget Binding (Transient for new instances)
    bind(MetadataSchemaManagerWidget).toSelf().inTransientScope();
    
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: METADATA_SCHEMA_MANAGER_WIDGET_ID,
        createWidget: () => {
            const widget = ctx.container.get(MetadataSchemaManagerWidget);
            console.log("Creating new MetadataSchemaManagerWidget instance");
            return widget;
        }
    })).inSingletonScope();

    // 2. Service Binding (Logic & State)
    bind(SchemaManagerService).toSelf().inSingletonScope();
    
    // 3. Main Contribution (Menus & Commands for the Manager Widget)
    bind(MetadataSchemaManagerContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(MetadataSchemaManagerContribution);
    bind(MenuContribution).toService(MetadataSchemaManagerContribution);
    bind(FrontendApplicationContribution).toService(MetadataSchemaManagerContribution);

    // 4. Background Service Contribution (Auto-download logic on startup)
    bind(FrontendApplicationContribution).toService(SchemaManagerService);

    // 5. Selector Dialog Contribution (Listens to App State to open Modal)
    bind(SchemaSelectorDialogContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(SchemaSelectorDialogContribution);
});
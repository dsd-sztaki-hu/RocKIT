// src/browser/metadata-schema-manager-frontend-module.ts
import { ContainerModule } from 'inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { WidgetFactory, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MetadataSchemaManagerWidget, METADATA_SCHEMA_MANAGER_WIDGET_ID } from './metadata-schema-manager-widget';
import { MetadataSchemaManagerContribution } from './metadata-schema-manager-contribution';

export default new ContainerModule(bind => {
    bind(MetadataSchemaManagerWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: METADATA_SCHEMA_MANAGER_WIDGET_ID,
        createWidget: () => ctx.container.get(MetadataSchemaManagerWidget)
    })).inSingletonScope();
    bind(MetadataSchemaManagerContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(MetadataSchemaManagerContribution);
    bind(MenuContribution).toService(MetadataSchemaManagerContribution);
    bind(FrontendApplicationContribution).toService(MetadataSchemaManagerContribution);
});
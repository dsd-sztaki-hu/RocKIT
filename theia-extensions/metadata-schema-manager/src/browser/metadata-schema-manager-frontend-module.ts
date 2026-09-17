// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { ContainerModule } from 'inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { WidgetFactory, FrontendApplicationContribution, WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';

import { MetadataSchemaManagerWidget, METADATA_SCHEMA_MANAGER_WIDGET_ID } from './metadata-schema-manager-widget';
import { MetadataSchemaManagerContribution } from './metadata-schema-manager-contribution';
import { SchemaManagerService } from './services/metadata-schema-manager-service';
import { RemoteSchemaProviderStoreService } from './services/remote-schema-provider-store-service';
import { MetadataSchemaSelectorContribution } from './components/metadata-schema-selector'; 
import { RemoteSchemaBrowserContribution } from './components/remote-schema-browser-dialog';
import { ProfileHealthStatusBarContribution } from './profile-health-status-bar-contribution';
import { MetadataSchemaManager as MetadataSchemaManagerToken } from 'rockit-common/lib/browser';
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
    bind(ProfileHealthStatusBarContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(ProfileHealthStatusBarContribution);

    // 3. Manager Contribution
    bind(MetadataSchemaManagerContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(MetadataSchemaManagerContribution);
    bind(MenuContribution).toService(MetadataSchemaManagerContribution);
    bind(FrontendApplicationContribution).toService(MetadataSchemaManagerContribution);
    bind(TabBarToolbarContribution).toService(MetadataSchemaManagerContribution);

    // 4. Schema Selector Dialog
    bind(MetadataSchemaSelectorContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(MetadataSchemaSelectorContribution);

    // 5. Remote Browser Dialog
    bind(RemoteSchemaBrowserContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(RemoteSchemaBrowserContribution);
});

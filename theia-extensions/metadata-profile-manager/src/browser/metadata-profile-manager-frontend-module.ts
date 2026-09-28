// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { ContainerModule } from 'inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { WidgetFactory, FrontendApplicationContribution, WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';

import { MetadataProfileManagerWidget, METADATA_PROFILE_MANAGER_WIDGET_ID } from './metadata-profile-manager-widget';
import { MetadataProfileManagerContribution } from './metadata-profile-manager-contribution';
import { ProfileManagerService } from './services/metadata-profile-manager-service';
import { RemoteSchemaProviderStoreService } from './services/remote-schema-provider-store-service';
import { MetadataSchemaSelectorContribution } from './components/metadata-schema-selector'; 
import { RemoteSchemaBrowserContribution } from './components/remote-schema-browser-dialog';
import { ProfileHealthStatusBarContribution } from './profile-health-status-bar-contribution';
import { MetadataProfileManager as MetadataProfileManagerToken } from 'rockit-common/lib/browser';
import {
    METADATA_PROFILE_CORE_PATH,
    MetadataProfileCoreService
} from '../common/metadata-profile-core-protocol';
import './styles/index.css';


export default new ContainerModule(bind => {
    // 1. Widget
    bind(MetadataProfileManagerWidget).toSelf().inTransientScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: METADATA_PROFILE_MANAGER_WIDGET_ID,
        createWidget: () => ctx.container.get(MetadataProfileManagerWidget)
    })).inSingletonScope();

    // 2. Services
    bind(MetadataProfileCoreService).toDynamicValue(ctx => {
        const connectionProvider = ctx.container.get(WebSocketConnectionProvider);
        return connectionProvider.createProxy<MetadataProfileCoreService>(METADATA_PROFILE_CORE_PATH);
    }).inSingletonScope();
    bind(RemoteSchemaProviderStoreService).toSelf().inSingletonScope();
    bind(ProfileManagerService).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(ProfileManagerService);
    bind(MetadataProfileManagerToken).toService(ProfileManagerService);
    bind(ProfileHealthStatusBarContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(ProfileHealthStatusBarContribution);

    // 3. Manager Contribution
    bind(MetadataProfileManagerContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(MetadataProfileManagerContribution);
    bind(MenuContribution).toService(MetadataProfileManagerContribution);
    bind(FrontendApplicationContribution).toService(MetadataProfileManagerContribution);
    bind(TabBarToolbarContribution).toService(MetadataProfileManagerContribution);

    // 4. Schema Selector Dialog
    bind(MetadataSchemaSelectorContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(MetadataSchemaSelectorContribution);

    // 5. Remote Browser Dialog
    bind(RemoteSchemaBrowserContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(RemoteSchemaBrowserContribution);
});

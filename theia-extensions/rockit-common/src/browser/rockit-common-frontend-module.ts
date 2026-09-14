// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { ContainerModule } from 'inversify';
import { CommandContribution } from '@theia/core/lib/common/command';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser';
import {
    APPLICATION_RESET_PATH,
    ApplicationResetService,
} from '../common/application-reset-protocol';
import {
    SecureStorageService,
    SECURE_STORAGE_PATH,
} from '../common/secure-storage-protocol';
import {
    RoCrateEntityDeleteCommandContribution,
    RoCrateEntityDeleteService,
} from './ro-crate-entity-delete-service';

export default new ContainerModule(bind => {
    bind(RoCrateEntityDeleteService).toSelf().inSingletonScope();
    bind(CommandContribution)
        .to(RoCrateEntityDeleteCommandContribution)
        .inSingletonScope();

    bind(ApplicationResetService)
        .toDynamicValue(ctx => {
            const connectionProvider = ctx.container.get(WebSocketConnectionProvider);
            return connectionProvider.createProxy<ApplicationResetService>(
                APPLICATION_RESET_PATH
            );
        })
        .inSingletonScope();

    // --- shared (keep only once) ---
    bind(SecureStorageService)
        .toDynamicValue(ctx => {
            const connectionProvider = ctx.container.get(WebSocketConnectionProvider);
            return connectionProvider.createProxy<SecureStorageService>(
                SECURE_STORAGE_PATH
            );
        })
        .inSingletonScope();
});
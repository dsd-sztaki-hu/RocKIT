// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { ContainerModule } from 'inversify'
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging'
import { BackendApplicationContribution } from '@theia/core/lib/node'
import { APPLICATION_RESET_PATH, ApplicationResetService } from '../common/application-reset-protocol'
import { SecureStorageService, SECURE_STORAGE_PATH } from '../common/secure-storage-protocol'
import { ApplicationResetServiceImpl } from './application-reset-service-impl'
import { RocrateMcpDaemonManager } from './rocrate-mcp-daemon-manager'
import { initializeRockitApplicationEnvironment } from './rockit-application-environment'
import { SecureStorageServiceImpl } from './secure-storage-service-impl'

// EnvVariablesServer snapshots process.env when it is constructed. Initialize
// at module load time, before Theia resolves backend services and contributions.
initializeRockitApplicationEnvironment()

export default new ContainerModule((bind) => {
  bind(ApplicationResetService).to(ApplicationResetServiceImpl).inSingletonScope()
  bind(SecureStorageService).to(SecureStorageServiceImpl).inSingletonScope()
  bind(SecureStorageServiceImpl).toSelf().inSingletonScope()
  bind(RocrateMcpDaemonManager).toSelf().inSingletonScope()
  bind(BackendApplicationContribution).toService(RocrateMcpDaemonManager)

  bind(ConnectionHandler)
    .toDynamicValue((ctx) =>
      new JsonRpcConnectionHandler(SECURE_STORAGE_PATH, () => ctx.container.get(SecureStorageService)),
    )
    .inSingletonScope()

  bind(ConnectionHandler)
    .toDynamicValue((ctx) =>
      new JsonRpcConnectionHandler(APPLICATION_RESET_PATH, () => ctx.container.get(ApplicationResetService)),
    )
    .inSingletonScope()
})

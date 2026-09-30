// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { ContainerModule } from 'inversify'
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging'
import {
  METADATA_PROFILE_CORE_PATH,
  MetadataProfileCoreService,
} from '../common/metadata-profile-core-protocol'
import { MetadataProfileCoreServiceImpl } from './metadata-profile-core-service-impl'

export default new ContainerModule((bind) => {
  bind(MetadataProfileCoreService).to(MetadataProfileCoreServiceImpl).inSingletonScope()

  bind(ConnectionHandler)
    .toDynamicValue((ctx) =>
      new JsonRpcConnectionHandler(METADATA_PROFILE_CORE_PATH, () =>
        ctx.container.get(MetadataProfileCoreService),
      ),
    )
    .inSingletonScope()
})

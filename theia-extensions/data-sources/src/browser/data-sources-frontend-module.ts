// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify'
import { CommandContribution, MenuContribution } from '@theia/core/lib/common'
import { DataSourcesContribution } from './data-sources-contribution'
import { DataSourceService } from './data-source-service'

export default new ContainerModule((bind) => {
  bind(DataSourceService).toSelf().inSingletonScope()
  bind(DataSourcesContribution).toSelf().inSingletonScope()
  bind(CommandContribution).toService(DataSourcesContribution)
  bind(MenuContribution).toService(DataSourcesContribution)
})

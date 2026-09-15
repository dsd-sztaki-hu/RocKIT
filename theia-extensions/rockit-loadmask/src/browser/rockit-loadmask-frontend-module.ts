// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser'
import { ContainerModule } from '@theia/core/shared/inversify'
import { LoadMaskContribution } from './loadmask-contribution'
import { LoadMaskService } from './loadmask-service'
import '../../src/browser/style/loadmask.css'

export default new ContainerModule((bind) => {
  bind(LoadMaskService).toSelf().inSingletonScope()
  bind(LoadMaskContribution).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(LoadMaskContribution)
})

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser'
import { ContainerModule } from '@theia/core/shared/inversify'
import { RoCratePreviewContribution } from './ro-crate-preview-contribution'

import '../../src/browser/style/index.css'
import { CommandContribution, MenuContribution } from '@theia/core'

export default new ContainerModule((bind) => {
  bind(RoCratePreviewContribution).toSelf().inSingletonScope()
  bind(CommandContribution).toService(RoCratePreviewContribution)
  bind(MenuContribution).toService(RoCratePreviewContribution)
  bind(FrontendApplicationContribution).toService(RoCratePreviewContribution)
})

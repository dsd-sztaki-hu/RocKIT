// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { CommandContribution, MenuContribution } from '@theia/core/lib/common'
import { ContainerModule } from '@theia/core/shared/inversify'
import { RoCrateHtmlGenerator } from 'rockit-common/lib/browser'
import { RoCrateHtmlGeneratorImpl } from './ro-crate-html-generator'
import { SaveRoCrateContribution } from './save-ro-crate-contribution'
import { RoCratePersistenceService } from './ro-crate-persistence-service'

export default new ContainerModule((bind) => {
  bind(SaveRoCrateContribution).toSelf().inSingletonScope()
  bind(RoCrateHtmlGenerator).to(RoCrateHtmlGeneratorImpl).inSingletonScope()
  bind(RoCratePersistenceService).toSelf().inSingletonScope()
  bind(CommandContribution).toService(SaveRoCrateContribution)
  bind(MenuContribution).toService(SaveRoCrateContribution)
})

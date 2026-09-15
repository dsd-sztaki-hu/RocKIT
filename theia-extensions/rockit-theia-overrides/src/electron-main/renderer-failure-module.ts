// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import {
  ElectronMainApplicationContribution,
  ElectronMainProcessArgv,
} from '@theia/core/lib/electron-main/electron-main-application'
import { ContainerModule } from '@theia/core/shared/inversify'
import { RendererFailureContribution } from './renderer-failure-contribution'
import { RockitElectronMainProcessArgv } from './rockit-electron-main-process-argv'

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
  bind(RockitElectronMainProcessArgv).toSelf().inSingletonScope()
  rebind(ElectronMainProcessArgv).toService(RockitElectronMainProcessArgv)

  bind(RendererFailureContribution).toSelf().inSingletonScope()
  bind(ElectronMainApplicationContribution).toService(RendererFailureContribution)
})

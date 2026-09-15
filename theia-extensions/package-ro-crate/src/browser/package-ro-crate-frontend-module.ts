// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { CommandContribution, MenuContribution } from '@theia/core/lib/common'
import { ContainerModule } from '@theia/core/shared/inversify'
import {
  PackageRoCrateCommandContribution,
  PackageRoCrateMenuContribution,
} from './package-ro-crate-contribution'

import '../../src/browser/style/index.css'

export default new ContainerModule((bind) => {
  // add your contribution bindings here
  bind(CommandContribution).to(PackageRoCrateCommandContribution)
  bind(MenuContribution).to(PackageRoCrateMenuContribution)
})

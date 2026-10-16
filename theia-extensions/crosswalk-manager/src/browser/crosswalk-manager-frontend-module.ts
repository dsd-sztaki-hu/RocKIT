// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { bindViewContribution, WidgetFactory } from '@theia/core/lib/browser'
import { ContainerModule } from '@theia/core/shared/inversify'
import { CrosswalkManagerContribution } from './crosswalk-manager-contribution'
import { CrosswalkManagerWidget } from './crosswalk-manager-widget'
import { CrosswalkRegistryService } from './crosswalk-registry-service'
import { CrosswalkRegistryStore } from './crosswalk-registry-store'

import '../../src/browser/style/index.css'

export default new ContainerModule(bind => {
    bindViewContribution(bind, CrosswalkManagerContribution)
    bind(CrosswalkManagerWidget).toSelf()
    bind(CrosswalkRegistryStore).toSelf().inSingletonScope()
    bind(CrosswalkRegistryService).toSelf().inSingletonScope()
    bind(WidgetFactory).toDynamicValue(context => ({
        id: CrosswalkManagerWidget.ID,
        createWidget: () => context.container.get<CrosswalkManagerWidget>(CrosswalkManagerWidget),
    })).inSingletonScope()
})

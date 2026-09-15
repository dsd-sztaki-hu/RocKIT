// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { SchemaValidatorWidget } from './schema-validator-widget';
import { SchemaValidatorContribution } from './schema-validator-contribution';
import { bindViewContribution, FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { SchemaValidatorService } from './schema-validator-service';
import { SchemaValidatorManager } from 'rockit-common/lib/browser';

import '../../src/browser/style/index.css';

export default new ContainerModule(bind => {
    bindViewContribution(bind, SchemaValidatorContribution);
    bind(FrontendApplicationContribution).toService(SchemaValidatorContribution);
    bind(TabBarToolbarContribution).toService(SchemaValidatorContribution);
    bind(SchemaValidatorWidget).toSelf();
    bind(SchemaValidatorManager).to(SchemaValidatorService).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: SchemaValidatorWidget.ID,
        createWidget: () => ctx.container.get<SchemaValidatorWidget>(SchemaValidatorWidget)
    })).inSingletonScope();
});

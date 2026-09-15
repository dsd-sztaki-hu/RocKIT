// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import {
    bindViewContribution,
    WidgetFactory,
    FrontendApplicationContribution
} from '@theia/core/lib/browser';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { RoCrateEditorWidget } from './ro-crate-editor-widget';
import { RoCrateEditorContribution } from './ro-crate-editor-contribution';
import { RoCrateEditorAppStateSyncContribution } from './ro-crate-editor-app-state-sync-contribution';
import '../../src/browser/style/index.css';

export default new ContainerModule(bind => {
    bind(RoCrateEditorWidget).toSelf();
    bindViewContribution(bind, RoCrateEditorContribution);
    bind(TabBarToolbarContribution).toService(RoCrateEditorContribution);
    bind(FrontendApplicationContribution).to(RoCrateEditorAppStateSyncContribution).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: RoCrateEditorWidget.ID,
        createWidget: async (options : any) => {
            const widget = ctx.container.get(RoCrateEditorWidget);
            await widget.initialize(options);
            return widget;
        }
    })).inSingletonScope();
});

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { AbstractViewContribution } from '@theia/core/lib/browser'
import { Command, CommandRegistry, MenuModelRegistry, nls } from '@theia/core/lib/common'
import { injectable } from '@theia/core/shared/inversify'
import { CrosswalkManagerWidget } from './crosswalk-manager-widget'

export const CrosswalkManagerCommand: Command = {
    id: 'crosswalk-manager:open',
    label: nls.localize('rockit/crosswalkManager/open', 'Open Crosswalk Manager'),
}

@injectable()
export class CrosswalkManagerContribution extends AbstractViewContribution<CrosswalkManagerWidget> {
    constructor() {
        super({
            widgetId: CrosswalkManagerWidget.ID,
            widgetName: CrosswalkManagerWidget.LABEL,
            defaultWidgetOptions: { area: 'main' },
            toggleCommandId: CrosswalkManagerCommand.id,
        })
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(CrosswalkManagerCommand, {
            execute: () => this.openView({ activate: true, reveal: true }),
        })
    }

    registerMenus(_menus: MenuModelRegistry): void {
        // RocKIT registers this command in the RO-Crate managers group.
    }
}

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { nls } from '@theia/core/lib/common/nls';
import { MultiEditDialogService } from './multi-edit-dialog-service';

export const MultiEditCommand: Command = {
    id: 'multi-edit:open',
    label: nls.localize('rockit/multiEdit/title', 'Multi Edit')
};

@injectable()
export class MultiEditCommandContribution implements CommandContribution {

    @inject(MultiEditDialogService)
    protected readonly multiEditDialogService!: MultiEditDialogService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(MultiEditCommand, {
            execute: async (entityIds: string[] = []) => {
                await this.multiEditDialogService.open(entityIds);
            }
        });
    }
}

@injectable()
export class MultiEditMenuContribution implements MenuContribution {

    registerMenus(_menus: MenuModelRegistry): void {
        // The command is invoked by feature widgets with their current entity selection.
    }
}

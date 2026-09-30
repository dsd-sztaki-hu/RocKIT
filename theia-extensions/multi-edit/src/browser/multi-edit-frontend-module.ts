// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { MultiEditCommandContribution, MultiEditMenuContribution } from './multi-edit-contribution';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { ContainerModule } from '@theia/core/shared/inversify';
import { MultiEditDialogService } from './multi-edit-dialog-service';

import '../../src/browser/styles/multi-edit-dialog.css';

export default new ContainerModule(bind => {
    // add your contribution bindings here
    bind(MultiEditDialogService).toSelf().inSingletonScope();
    bind(CommandContribution).to(MultiEditCommandContribution);
    bind(MenuContribution).to(MultiEditMenuContribution);
});

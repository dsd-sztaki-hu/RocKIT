// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { RemoteRoCrateConversionCommandContribution, RemoteRoCrateConversionMenuContribution } from './remote-ro-crate-conversion-contribution';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { ContainerModule } from '@theia/core/shared/inversify';

export default new ContainerModule(bind => {
    // add your contribution bindings here
    bind(CommandContribution).to(RemoteRoCrateConversionCommandContribution);
    bind(MenuContribution).to(RemoteRoCrateConversionMenuContribution);
});

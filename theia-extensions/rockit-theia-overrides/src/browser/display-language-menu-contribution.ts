// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { CommonCommands, CommonMenus } from '@theia/core/lib/browser'
import {
  MenuContribution,
  MenuModelRegistry,
} from '@theia/core/lib/common'
import { injectable } from '@theia/core/shared/inversify'

@injectable()
export class DisplayLanguageMenuContribution implements MenuContribution {
  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.FILE_SETTINGS_SUBMENU_OPEN, {
      commandId: CommonCommands.CONFIGURE_DISPLAY_LANGUAGE.id,
      order: 'z_display_language',
    })
  }
}

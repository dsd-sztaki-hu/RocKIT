// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser'
import {
  MAIN_MENU_BAR,
  MenuContribution,
  MenuModelRegistry,
} from '@theia/core/lib/common'
import { inject, injectable } from '@theia/core/shared/inversify'

@injectable()
export class ApplicationMainMenuOverrides
  implements FrontendApplicationContribution, MenuContribution
{
  protected readonly hiddenMainMenuIds: readonly string[] = ['5_go', '6_debug']

  @inject(MenuModelRegistry)
  protected readonly menuRegistry: MenuModelRegistry

  registerMenus(menus: MenuModelRegistry): void {
    this.removeHiddenMainMenus(menus)
  }

  onStart(): void {
    this.removeHiddenMainMenus()
  }

  protected removeHiddenMainMenus(
    menus: MenuModelRegistry = this.menuRegistry,
  ): void {
    for (const menuId of this.hiddenMainMenuIds) {
      menus.unregisterMenuAction(menuId, MAIN_MENU_BAR)
    }
  }
}

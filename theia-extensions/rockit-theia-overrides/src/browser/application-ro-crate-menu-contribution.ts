// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import {
  MAIN_MENU_BAR,
  MenuContribution,
  MenuModelRegistry,
  nls,
} from '@theia/core/lib/common'
import { injectable } from '@theia/core/shared/inversify'

export type RoCrateMenuItem = {
  commandId: string
  labelKey: string
  label: string
  order: string
}

export const RO_CRATE_MENU_PATH = [...MAIN_MENU_BAR, '4z_ro_crate'] // View's position is 4, Go's is 5, the 4z sorts after the 4, but before the 5

const RO_CRATE_WIDGETS_MENU_PATH = [...RO_CRATE_MENU_PATH, '1_widgets']
const RO_CRATE_MANAGERS_MENU_PATH = [...RO_CRATE_MENU_PATH, '2_managers']
const RO_CRATE_TOOLS_MENU_PATH = [...RO_CRATE_MENU_PATH, '3_tools']

export const RO_CRATE_MENU_ITEMS: readonly RoCrateMenuItem[] = [
  { commandId: 'fileNavigator:toggle', labelKey: 'rockit/menu/workspace', label: 'Workspace', order: 'a01' },
  {
    commandId: 'dataset-panel:command',
    labelKey: 'rockit/menu/structurePanel',
    label: 'Structure',
    order: 'a02',
  },
  {
    commandId: 'rocrate.openEditor',
    labelKey: 'rockit/menu/roCrateEditor',
    label: 'Metadata Editor',
    order: 'a03',
  },
  {
    commandId: 'theia-examples:treeview-example-view-command-id',
    labelKey: 'rockit/menu/entities',
    label: 'Entities',
    order: 'a04',
  },
  {
    commandId: 'validation-errors:command',
    labelKey: 'rockit/menu/validationErrors',
    label: 'Validation Errors',
    order: 'a05',
  },
  {
    commandId: 'metadata-profile-manager:open',
    labelKey: 'rockit/menu/metadataProfileManager',
    label: 'Metadata Profile Manager',
    order: 'a06',
  },
  {
    commandId: 'data-repository-manager:open',
    labelKey: 'rockit/menu/dataRepositoryManager',
    label: 'Data Repository Manager',
    order: 'a07',
  },
  {
    commandId: 'RO-Crate Preview',
    labelKey: 'rockit/menu/roCratePreview',
    label: 'Preview',
    order: 'a08',
  },
  {
    commandId: 'RemoteRoCrateConversion.command',
    labelKey: 'rockit/menu/remoteToLocalConversion',
    label: 'Remote to Local Conversion',
    order: 'a09',
  },
]

@injectable()
export class ApplicationRoCrateMenuContribution implements MenuContribution {
  registerMenus(menus: MenuModelRegistry): void {
    menus.registerSubmenu(
      RO_CRATE_MENU_PATH,
      nls.localize('rockit/menu/roCrate', 'RO-Crate'),
    )
    this.registerMenuGroup(menus, RO_CRATE_WIDGETS_MENU_PATH, RO_CRATE_MENU_ITEMS.slice(0, 5))
    this.registerMenuGroup(menus, RO_CRATE_MANAGERS_MENU_PATH, RO_CRATE_MENU_ITEMS.slice(5, 7))
    this.registerMenuGroup(menus, RO_CRATE_TOOLS_MENU_PATH, RO_CRATE_MENU_ITEMS.slice(7))
  }

  protected registerMenuGroup(
    menus: MenuModelRegistry,
    menuPath: string[],
    items: readonly RoCrateMenuItem[],
  ): void {
    for (const item of items) {
      menus.registerMenuAction(menuPath, {
        commandId: item.commandId,
        label: nls.localize(item.labelKey, item.label),
        order: item.order,
      })
    }
  }
}

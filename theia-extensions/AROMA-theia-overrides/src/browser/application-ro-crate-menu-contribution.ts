import {
  MAIN_MENU_BAR,
  MenuContribution,
  MenuModelRegistry,
} from '@theia/core/lib/common'
import { injectable } from '@theia/core/shared/inversify'

export type RoCrateMenuItem = {
  commandId: string
  label: string
  order: string
}

export const RO_CRATE_MENU_PATH = [...MAIN_MENU_BAR, '4z_ro_crate'] // View's position is 4, Go's is 5, the 4z sorts after the 4, but before the 5

const RO_CRATE_WIDGETS_MENU_PATH = [...RO_CRATE_MENU_PATH, '1_widgets']
const RO_CRATE_MANAGERS_MENU_PATH = [...RO_CRATE_MENU_PATH, '2_managers']
const RO_CRATE_TOOLS_MENU_PATH = [...RO_CRATE_MENU_PATH, '3_tools']

export const RO_CRATE_MENU_ITEMS: readonly RoCrateMenuItem[] = [
  { commandId: 'fileNavigator:toggle', label: 'Workspace', order: 'a01' },
  {
    commandId: 'dataset-panel:command',
    label: 'Structure Panel',
    order: 'a02',
  },
  {
    commandId: 'rocrate.openEditor',
    label: 'RO-Crate Editor',
    order: 'a03',
  },
  {
    commandId: 'theia-examples:treeview-example-view-command-id',
    label: 'Entities',
    order: 'a04',
  },
  {
    commandId: 'metadata-schema-manager:open',
    label: 'Metadata Schema Manager',
    order: 'a05',
  },
  {
    commandId: 'data-repository-manager:open',
    label: 'Data Repository Manager',
    order: 'a06',
  },
  {
    commandId: 'RO-Crate Preview',
    label: 'RO-Crate Preview',
    order: 'a07',
  },
  {
    commandId: 'RemoteRoCrateConversion.command',
    label: 'Remote to Locale Conversion',
    order: 'a08',
  },
]

@injectable()
export class ApplicationRoCrateMenuContribution implements MenuContribution {
  registerMenus(menus: MenuModelRegistry): void {
    menus.registerSubmenu(RO_CRATE_MENU_PATH, 'RO-Crate')
    this.registerMenuGroup(menus, RO_CRATE_WIDGETS_MENU_PATH, RO_CRATE_MENU_ITEMS.slice(0, 4))
    this.registerMenuGroup(menus, RO_CRATE_MANAGERS_MENU_PATH, RO_CRATE_MENU_ITEMS.slice(4, 6))
    this.registerMenuGroup(menus, RO_CRATE_TOOLS_MENU_PATH, RO_CRATE_MENU_ITEMS.slice(6))
  }

  protected registerMenuGroup(
    menus: MenuModelRegistry,
    menuPath: string[],
    items: readonly RoCrateMenuItem[],
  ): void {
    for (const item of items) {
      menus.registerMenuAction(menuPath, {
        commandId: item.commandId,
        label: item.label,
        order: item.order,
      })
    }
  }
}

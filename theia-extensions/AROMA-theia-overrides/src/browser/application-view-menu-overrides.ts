import {
  CommonMenus,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser'
import { MenuModelRegistry } from '@theia/core/lib/common'
import { inject, injectable } from '@theia/core/shared/inversify'

type ViewMenuItem = {
  commandId: string
  label: string
  order: string
}

@injectable()
export class ApplicationViewMenuOverrides
  implements FrontendApplicationContribution
{
  protected readonly viewWidgetsMenuPath = [
    ...CommonMenus.VIEW,
    '0_before_primary_widgets',
  ]

  @inject(MenuModelRegistry)
  protected readonly menuRegistry: MenuModelRegistry

  protected readonly topViewItems: readonly ViewMenuItem[] = [
    { commandId: 'fileNavigator:toggle', label: 'Workspace', order: 'a01' },
    {
      commandId: 'theia-examples:treeview-example-view-command-id',
      label: 'Entities',
      order: 'a02',
    },
    {
      commandId: 'dataset-panel:command',
      label: 'Open New RO-Crate Structure Panel',
      order: 'a03',
    },
    {
      commandId: 'rocrate.openEditor',
      label: 'Open New RO-Crate Editor',
      order: 'a04',
    },
    {
      commandId: 'schema-validator:command',
      label: 'Schema Validator Widget',
      order: 'a05',
    },
    {
      commandId: 'property-view:toggle',
      label: 'File Preview',
      order: 'a06',
    },
    {
      commandId: 'schema-selector:command',
      label: 'Property Selector Widget',
      order: 'a07',
    },
  ]

  protected readonly bottomViewItems: readonly ViewMenuItem[] = [
    {
      commandId: 'metadata-schema-manager:open',
      label: 'Metadata Schema Manager',
      order: 'z90',
    },
    {
      commandId: 'data-repository-manager:open',
      label: 'Data Repository Manager',
      order: 'z91',
    },
  ]

  onStart(): void {
    this.reorderViewMenuItems()
  }

  protected reorderViewMenuItems(): void {
    const orderedItems = [...this.topViewItems, ...this.bottomViewItems]

    for (const item of orderedItems) {
      this.menuRegistry.unregisterMenuAction(item.commandId, CommonMenus.VIEW_PRIMARY)
      this.menuRegistry.unregisterMenuAction(item.commandId, CommonMenus.VIEW_VIEWS)
      this.menuRegistry.unregisterMenuAction(item.commandId, CommonMenus.VIEW)
    }

    for (const item of this.topViewItems) {
      this.menuRegistry.registerMenuAction(this.viewWidgetsMenuPath, {
        commandId: item.commandId,
        label: item.label,
        order: item.order,
      })
    }

    for (const item of this.bottomViewItems) {
      this.menuRegistry.registerMenuAction(CommonMenus.VIEW, {
        commandId: item.commandId,
        label: item.label,
        order: item.order,
      })
    }
  }
}

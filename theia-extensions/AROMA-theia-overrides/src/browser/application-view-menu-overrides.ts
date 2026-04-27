import {
  ApplicationShell,
  FrontendApplication,
  FrontendApplicationContribution,
  CommonMenus,
} from '@theia/core/lib/browser'
import {
  CommandRegistry,
  ContributionProvider,
  MenuModelRegistry,
} from '@theia/core/lib/common'
import { ShellLayoutTransformer } from '@theia/core/lib/browser/shell/shell-layout-restorer'
import { inject, injectable, named } from '@theia/core/shared/inversify'

type ViewMenuItem = {
  commandId: string
  label: string
  order: string
}

@injectable()
export class ApplicationViewMenuOverrides
  implements FrontendApplicationContribution, ShellLayoutTransformer
{
  protected readonly outlineWidgetId = 'outline-view'
  protected readonly outlineCommandIds: readonly string[] = [
    'outlineView:toggle',
    'outlineView.collapse.all',
    'outlineView.expand.all',
  ]

  protected readonly viewWidgetsMenuPath = [
    ...CommonMenus.VIEW,
    '0_before_primary_widgets',
  ]

  @inject(ContributionProvider)
  @named(FrontendApplicationContribution)
  protected readonly frontendContributions: ContributionProvider<FrontendApplicationContribution>

  @inject(CommandRegistry)
  protected readonly commandRegistry: CommandRegistry

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

  configure(_app: FrontendApplication): void {
    this.disableOutlineDefaultLayoutContribution()
  }

  onStart(): void {
    this.removeOutlineFromViewMenuAndCommands()
    this.reorderViewMenuItems()
    window.setTimeout(() => this.removeOutlineFromViewMenuAndCommands(), 0)
  }

  transformLayoutOnRestore(layoutData: ApplicationShell.LayoutData): void {
    this.stripOutlineFromSidePanel(layoutData.leftPanel)
    this.stripOutlineFromSidePanel(layoutData.rightPanel)
    this.stripOutlineFromDockLayout(layoutData.mainPanel as unknown)
    this.stripOutlineFromDockLayout(layoutData.bottomPanel?.config as unknown)
    if (layoutData.activeWidgetId === this.outlineWidgetId) {
      layoutData.activeWidgetId = undefined
    }
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

  protected removeOutlineFromViewMenuAndCommands(): void {
    for (const commandId of this.outlineCommandIds) {
      this.menuRegistry.unregisterMenuAction(commandId, CommonMenus.VIEW_PRIMARY)
      this.menuRegistry.unregisterMenuAction(commandId, CommonMenus.VIEW_VIEWS)
      this.menuRegistry.unregisterMenuAction(commandId, CommonMenus.VIEW)
      this.menuRegistry.unregisterMenuAction(commandId, this.viewWidgetsMenuPath)
      this.commandRegistry.unregisterCommand(commandId)
    }
  }

  protected disableOutlineDefaultLayoutContribution(): void {
    for (const contribution of this.frontendContributions.getContributions()) {
      if (contribution === this) {
        continue
      }
      const candidate = contribution as FrontendApplicationContribution & {
        constructor?: { name?: string }
        viewId?: string
        options?: { widgetId?: string }
      }
      const isOutlineContribution =
        candidate.viewId === this.outlineWidgetId ||
        candidate.options?.widgetId === this.outlineWidgetId ||
        candidate.constructor?.name === 'OutlineViewContribution'
      if (!isOutlineContribution || typeof candidate.initializeLayout !== 'function') {
        continue
      }
      candidate.initializeLayout = async () => undefined
    }
  }

  protected stripOutlineFromSidePanel(panel: unknown): void {
    if (!panel || typeof panel !== 'object') {
      return
    }
    const data = panel as { items?: Array<{ widget?: unknown }> }
    if (!Array.isArray(data.items)) {
      return
    }
    data.items = data.items.filter((item) => !this.isOutlineWidget(item?.widget))
  }

  protected stripOutlineFromDockLayout(config: unknown): void {
    if (!config || typeof config !== 'object') {
      return
    }
    const node = config as Record<string, unknown>
    if (Array.isArray(node.widgets)) {
      const filtered = node.widgets.filter((widget) => !this.isOutlineWidget(widget))
      node.widgets = filtered
      if (typeof node.currentIndex === 'number' && filtered.length > 0) {
        node.currentIndex = Math.min(Math.max(node.currentIndex, 0), filtered.length - 1)
      } else if (typeof node.currentIndex === 'number') {
        node.currentIndex = 0
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        this.stripOutlineFromDockLayout(child)
      }
    }
    if ('widget' in node && this.isOutlineWidget(node.widget)) {
      delete node.widget
    }
  }

  protected isOutlineWidget(widget: unknown): boolean {
    if (!widget || typeof widget !== 'object') {
      return false
    }
    const record = widget as {
      id?: string
      constructionOptions?: { factoryId?: string }
    }
    return (
      record.id === this.outlineWidgetId ||
      record.constructionOptions?.factoryId === this.outlineWidgetId
    )
  }
}

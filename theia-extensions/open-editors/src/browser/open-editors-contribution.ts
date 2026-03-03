import { inject, injectable } from '@theia/core/shared/inversify'
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution'
import {
  ApplicationShell,
  CommonCommands,
  NavigatableWidget,
  TabBar,
  Title,
  Widget,
} from '@theia/core/lib/browser'
import { CommandRegistry, MenuModelRegistry, Mutable } from '@theia/core/lib/common'
import {
  RenderedToolbarAction,
  TabBarToolbarContribution,
  TabBarToolbarRegistry,
} from '@theia/core/lib/browser/shell/tab-bar-toolbar'
import { WorkspaceCommands } from '@theia/workspace/lib/browser'
import { nls } from '@theia/core/lib/common/nls'
import { OpenEditorsWidget } from './navigator-open-editors-widget'
import { OpenEditorsCommands } from './navigator-open-editors-commands'
import { OpenEditorsContextMenu } from './navigator-open-editors-menus'

export const OPEN_EDITORS_TOGGLE_COMMAND_ID = 'openEditors:toggle'

@injectable()
export class OpenEditorsContribution
  extends AbstractViewContribution<OpenEditorsWidget>
  implements TabBarToolbarContribution
{
  @inject(CommandRegistry)
  protected readonly commandRegistry: CommandRegistry

  @inject(TabBarToolbarRegistry)
  protected readonly tabbarToolbarRegistry: TabBarToolbarRegistry

  constructor() {
    super({
      widgetId: OpenEditorsWidget.ID,
      widgetName: OpenEditorsWidget.LABEL,
      defaultWidgetOptions: { area: 'left', rank: 99 },
      toggleCommandId: OPEN_EDITORS_TOGGLE_COMMAND_ID,
    })
  }

  override registerCommands(registry: CommandRegistry): void {
    super.registerCommands(registry)

    registry.registerCommand(OpenEditorsCommands.CLOSE_ALL_TABS_FROM_TOOLBAR, {
      execute: (widget) =>
        this.withOpenEditorsWidget(widget, () => this.shell.closeMany(this.editorWidgets)),
      isEnabled: (widget) => this.withOpenEditorsWidget(widget, () => true),
      isVisible: (widget) => this.withOpenEditorsWidget(widget, () => true),
    })

    registry.registerCommand(OpenEditorsCommands.SAVE_ALL_TABS_FROM_TOOLBAR, {
      execute: (widget) =>
        this.withOpenEditorsWidget(widget, () =>
          registry.executeCommand(CommonCommands.SAVE_ALL.id),
        ),
      isEnabled: (widget) => this.withOpenEditorsWidget(widget, () => true),
      isVisible: (widget) => this.withOpenEditorsWidget(widget, () => true),
    })

    const filterEditorWidgets = (title: Title<Widget>) => {
      const { owner } = title
      return NavigatableWidget.is(owner)
    }
    registry.registerCommand(OpenEditorsCommands.CLOSE_ALL_EDITORS_IN_GROUP_FROM_ICON, {
      execute: (tabBarOrArea: ApplicationShell.Area | TabBar<Widget>): void => {
        this.shell.closeTabs(tabBarOrArea, filterEditorWidgets)
      },
      isVisible: () => false,
    })
    registry.registerCommand(OpenEditorsCommands.SAVE_ALL_IN_GROUP_FROM_ICON, {
      execute: (tabBarOrArea: ApplicationShell.Area | TabBar<Widget>) => {
        this.shell.saveTabs(tabBarOrArea, filterEditorWidgets)
      },
      isVisible: () => false,
    })
  }

  override registerMenus(registry: MenuModelRegistry): void {
    super.registerMenus(registry)

    registry.registerMenuAction(OpenEditorsContextMenu.CLIPBOARD, {
      commandId: CommonCommands.COPY_PATH.id,
      order: 'a',
    })
    registry.registerMenuAction(OpenEditorsContextMenu.CLIPBOARD, {
      commandId: WorkspaceCommands.COPY_RELATIVE_FILE_PATH.id,
      order: 'b',
    })
    registry.registerMenuAction(OpenEditorsContextMenu.SAVE, {
      commandId: CommonCommands.SAVE.id,
      order: 'a',
    })

    registry.registerMenuAction(OpenEditorsContextMenu.COMPARE, {
      commandId: 'compare:first',
      order: 'a',
    })
    registry.registerMenuAction(OpenEditorsContextMenu.COMPARE, {
      commandId: 'compare:second',
      order: 'b',
    })

    registry.registerMenuAction(OpenEditorsContextMenu.MODIFICATION, {
      commandId: CommonCommands.CLOSE_TAB.id,
      label: nls.localizeByDefault('Close'),
      order: 'a',
    })
    registry.registerMenuAction(OpenEditorsContextMenu.MODIFICATION, {
      commandId: CommonCommands.CLOSE_OTHER_TABS.id,
      label: nls.localizeByDefault('Close Others'),
      order: 'b',
    })
    registry.registerMenuAction(OpenEditorsContextMenu.MODIFICATION, {
      commandId: CommonCommands.CLOSE_ALL_MAIN_TABS.id,
      label: nls.localizeByDefault('Close All'),
      order: 'c',
    })
  }

  async registerToolbarItems(toolbarRegistry: TabBarToolbarRegistry): Promise<void> {
    toolbarRegistry.registerItem({
      id: OpenEditorsCommands.SAVE_ALL_TABS_FROM_TOOLBAR.id,
      command: OpenEditorsCommands.SAVE_ALL_TABS_FROM_TOOLBAR.id,
      tooltip: OpenEditorsCommands.SAVE_ALL_TABS_FROM_TOOLBAR.label,
      priority: 0,
    })
    toolbarRegistry.registerItem({
      id: OpenEditorsCommands.CLOSE_ALL_TABS_FROM_TOOLBAR.id,
      command: OpenEditorsCommands.CLOSE_ALL_TABS_FROM_TOOLBAR.id,
      tooltip: OpenEditorsCommands.CLOSE_ALL_TABS_FROM_TOOLBAR.label,
      priority: 1,
    })
  }

  protected get editorWidgets(): NavigatableWidget[] {
    return this.tryGetWidget()?.editorWidgets ?? []
  }

  protected withOpenEditorsWidget<T>(
    widget: Widget | undefined = this.tryGetWidget(),
    cb: (navigator: OpenEditorsWidget) => T,
  ): T | false {
    if (widget instanceof OpenEditorsWidget && widget.id === OpenEditorsWidget.ID) {
      return cb(widget)
    }
    return false
  }

  public registerMoreToolbarItem = (item: Mutable<RenderedToolbarAction> & { command: string }) => {
    const commandId = item.command
    const id = 'open-editors.tabbar.toolbar.' + commandId
    const command = this.commandRegistry.getCommand(commandId)
    this.commandRegistry.registerCommand({ id, iconClass: command && command.iconClass }, {
      execute: (w, ...args) =>
        w instanceof OpenEditorsWidget && this.commandRegistry.executeCommand(commandId, ...args),
      isEnabled: (w, ...args) =>
        w instanceof OpenEditorsWidget && this.commandRegistry.isEnabled(commandId, ...args),
      isVisible: (w, ...args) =>
        w instanceof OpenEditorsWidget && this.commandRegistry.isVisible(commandId, ...args),
      isToggled: (w, ...args) =>
        w instanceof OpenEditorsWidget && this.commandRegistry.isToggled(commandId, ...args),
    })
    item.command = id
    this.tabbarToolbarRegistry.registerItem(item)
  }
}

import {
  ApplicationShell,
  CommonCommands,
  CommonMenus,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser'
import {
  Command,
  CommandContribution,
  CommandRegistry,
  CommandService,
  Emitter,
  MenuContribution,
  MenuModelRegistry,
} from '@theia/core/lib/common'
import { inject, injectable } from '@theia/core/shared/inversify'

const METADATA_SCHEMA_MANAGER_WIDGET_ID = 'metadata-schema-manager'
const FILE_NAVIGATOR_WIDGET_ID = 'files'
const RO_CRATE_EDITOR_WIDGET_ID_PREFIX = 'rocrate-editor-widget'

type EditCommandScope = 'all' | 'clipboard'

type EditCommandProxy = {
  proxy: Command
  targetCommandId: string
  menuPath: string[]
  order: string
  scope: EditCommandScope
}

@injectable()
export class ApplicationEditMenuOverrides
  implements
    FrontendApplicationContribution,
    CommandContribution,
    MenuContribution
{
  @inject(ApplicationShell)
  protected readonly shell: ApplicationShell

  @inject(MenuModelRegistry)
  protected readonly menuRegistry: MenuModelRegistry

  @inject(CommandService)
  protected readonly commandService: CommandService

  @inject(CommandRegistry)
  protected readonly commandRegistry: CommandRegistry

  protected readonly onDidChangeEditEnablementEmitter = new Emitter<void>()

  protected readonly proxies: readonly EditCommandProxy[] = [
    {
      proxy: { id: 'aroma.edit.undo.proxy', label: CommonCommands.UNDO.label },
      targetCommandId: CommonCommands.UNDO.id,
      menuPath: CommonMenus.EDIT_UNDO,
      order: '0',
      scope: 'all',
    },
    {
      proxy: { id: 'aroma.edit.redo.proxy', label: CommonCommands.REDO.label },
      targetCommandId: CommonCommands.REDO.id,
      menuPath: CommonMenus.EDIT_UNDO,
      order: '1',
      scope: 'all',
    },
    {
      proxy: { id: 'aroma.edit.find.proxy', label: CommonCommands.FIND.label },
      targetCommandId: CommonCommands.FIND.id,
      menuPath: CommonMenus.EDIT_FIND,
      order: '0',
      scope: 'all',
    },
    {
      proxy: {
        id: 'aroma.edit.replace.proxy',
        label: CommonCommands.REPLACE.label,
      },
      targetCommandId: CommonCommands.REPLACE.id,
      menuPath: CommonMenus.EDIT_FIND,
      order: '1',
      scope: 'all',
    },
    {
      proxy: { id: 'aroma.edit.cut.proxy', label: CommonCommands.CUT.label },
      targetCommandId: CommonCommands.CUT.id,
      menuPath: CommonMenus.EDIT_CLIPBOARD,
      order: '0',
      scope: 'clipboard',
    },
    {
      proxy: { id: 'aroma.edit.copy.proxy', label: CommonCommands.COPY.label },
      targetCommandId: CommonCommands.COPY.id,
      menuPath: CommonMenus.EDIT_CLIPBOARD,
      order: '1',
      scope: 'clipboard',
    },
    {
      proxy: { id: 'aroma.edit.paste.proxy', label: CommonCommands.PASTE.label },
      targetCommandId: CommonCommands.PASTE.id,
      menuPath: CommonMenus.EDIT_CLIPBOARD,
      order: '2',
      scope: 'clipboard',
    },
    {
      proxy: {
        id: 'aroma.edit.copy-path.proxy',
        label: CommonCommands.COPY_PATH.label,
      },
      targetCommandId: CommonCommands.COPY_PATH.id,
      menuPath: CommonMenus.EDIT_CLIPBOARD,
      order: '3',
      scope: 'all',
    },
  ]

  onStart(): void {
    this.replaceEditMenuActions()
    this.shell.onDidChangeCurrentWidget(() =>
      this.onDidChangeEditEnablementEmitter.fire(),
    )
  }

  registerCommands(commands: CommandRegistry): void {
    for (const proxy of this.proxies) {
      commands.registerCommand(proxy.proxy, {
        execute: async (...args) => {
          await this.commandService.executeCommand(proxy.targetCommandId, ...args)
        },
        isEnabled: (...args) =>
          !this.isBlockedForScope(proxy.scope) &&
          this.commandRegistry.isEnabled(proxy.targetCommandId, ...args),
        isVisible: (...args) => this.commandRegistry.isVisible(proxy.targetCommandId, ...args),
        isToggled: (...args) => this.commandRegistry.isToggled(proxy.targetCommandId, ...args),
        onDidChangeEnabled: this.onDidChangeEditEnablementEmitter.event,
      })
    }
  }

  registerMenus(_menus: MenuModelRegistry): void {
    // Replaced in onStart after all menu contributions are registered.
  }

  protected isBlockedForScope(scope: EditCommandScope): boolean {
    if (this.isEditBlockedEverywhereForCurrentWidget()) {
      return true
    }
    if (scope === 'clipboard' && this.isRoCrateEditorFocused()) {
      return true
    }
    return false
  }

  protected isEditBlockedEverywhereForCurrentWidget(): boolean {
    return this.isMetadataSchemaManagerFocused() || this.isFileExplorerFocused()
  }

  protected isMetadataSchemaManagerFocused(): boolean {
    const active = this.shell.activeWidget ?? this.shell.currentWidget
    return active?.id === METADATA_SCHEMA_MANAGER_WIDGET_ID
  }

  protected isFileExplorerFocused(): boolean {
    const active = this.shell.activeWidget ?? this.shell.currentWidget
    return active?.id === FILE_NAVIGATOR_WIDGET_ID
  }

  protected isRoCrateEditorFocused(): boolean {
    const active = this.shell.activeWidget ?? this.shell.currentWidget
    return Boolean(active?.id?.startsWith(RO_CRATE_EDITOR_WIDGET_ID_PREFIX))
  }

  protected replaceEditMenuActions(): void {
    for (const proxy of this.proxies) {
      this.menuRegistry.unregisterMenuAction(proxy.targetCommandId, proxy.menuPath)
      this.menuRegistry.unregisterMenuAction(proxy.proxy.id, proxy.menuPath)
      this.menuRegistry.registerMenuAction(proxy.menuPath, {
        commandId: proxy.proxy.id,
        label: proxy.proxy.label,
        order: proxy.order,
      })
    }
  }
}

// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import {
  ApplicationShell,
  CommonCommands,
  CommonMenus,
  FrontendApplication,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser'
import { ElectronMainMenuFactory } from '@theia/core/lib/electron-browser/menu/electron-main-menu-factory'
import {
  Command,
  CommandContribution,
  CommandRegistry,
  CommandService,
  Emitter,
  MenuContribution,
  MenuModelRegistry,
} from '@theia/core/lib/common'
import { inject, injectable, optional } from '@theia/core/shared/inversify'

const METADATA_SCHEMA_MANAGER_WIDGET_ID = 'metadata-schema-manager'
const FILE_NAVIGATOR_WIDGET_ID = 'files'
const FILE_NAVIGATOR_VIEW_CONTAINER_ID = 'explorer-view-container'
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

  @inject(ElectronMainMenuFactory)
  @optional()
  protected readonly electronMainMenuFactory?: ElectronMainMenuFactory

  protected readonly onDidChangeEditEnablementEmitter = new Emitter<void>()
  protected lastInteractionWidgetId: string | undefined
  protected menuRefreshScheduled = false

  protected readonly proxies: readonly EditCommandProxy[] = [
    {
      proxy: { id: 'rockit.edit.undo.proxy', label: CommonCommands.UNDO.label },
      targetCommandId: CommonCommands.UNDO.id,
      menuPath: CommonMenus.EDIT_UNDO,
      order: '0',
      scope: 'all',
    },
    {
      proxy: { id: 'rockit.edit.redo.proxy', label: CommonCommands.REDO.label },
      targetCommandId: CommonCommands.REDO.id,
      menuPath: CommonMenus.EDIT_UNDO,
      order: '1',
      scope: 'all',
    },
    {
      proxy: { id: 'rockit.edit.find.proxy', label: CommonCommands.FIND.label },
      targetCommandId: CommonCommands.FIND.id,
      menuPath: CommonMenus.EDIT_FIND,
      order: '0',
      scope: 'all',
    },
    {
      proxy: {
        id: 'rockit.edit.replace.proxy',
        label: CommonCommands.REPLACE.label,
      },
      targetCommandId: CommonCommands.REPLACE.id,
      menuPath: CommonMenus.EDIT_FIND,
      order: '1',
      scope: 'all',
    },
    {
      proxy: { id: 'rockit.edit.cut.proxy', label: CommonCommands.CUT.label },
      targetCommandId: CommonCommands.CUT.id,
      menuPath: CommonMenus.EDIT_CLIPBOARD,
      order: '0',
      scope: 'clipboard',
    },
    {
      proxy: { id: 'rockit.edit.copy.proxy', label: CommonCommands.COPY.label },
      targetCommandId: CommonCommands.COPY.id,
      menuPath: CommonMenus.EDIT_CLIPBOARD,
      order: '1',
      scope: 'clipboard',
    },
    {
      proxy: { id: 'rockit.edit.paste.proxy', label: CommonCommands.PASTE.label },
      targetCommandId: CommonCommands.PASTE.id,
      menuPath: CommonMenus.EDIT_CLIPBOARD,
      order: '2',
      scope: 'clipboard',
    },
    {
      proxy: {
        id: 'rockit.edit.copy-path.proxy',
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
    this.triggerMainMenuRefresh('onStart')
    this.lastInteractionWidgetId = this.getPrimaryWidgetId()
    window.setTimeout(() => this.replaceEditMenuActions(), 0)
    window.setTimeout(() => this.replaceEditMenuActions(), 500)
    this.shell.onDidChangeCurrentWidget(({ newValue }) => {
      if (newValue?.id) {
        this.lastInteractionWidgetId = newValue.id
      }
      this.onDidChangeEditEnablementEmitter.fire()
      this.triggerMainMenuRefresh('shell.onDidChangeCurrentWidget')
    })
    this.shell.onDidChangeActiveWidget(({ newValue }) => {
      if (newValue?.id) {
        this.lastInteractionWidgetId = newValue.id
      }
      this.onDidChangeEditEnablementEmitter.fire()
      this.triggerMainMenuRefresh('shell.onDidChangeActiveWidget')
    })
    document.addEventListener(
      'focusin',
      (event) => {
        this.updateLastInteractionWidgetId('focusin', event.target)
      },
      true,
    )
    document.addEventListener(
      'mousedown',
      (event) => {
        this.updateLastInteractionWidgetId('mousedown', event.target)
      },
      true,
    )
  }

  onDidInitializeLayout(_app: FrontendApplication): void {
    this.replaceEditMenuActions()
    this.triggerMainMenuRefresh('onDidInitializeLayout')
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
    return (
      this.getWidgetIdsForContextCheck().some((id) =>
        id.startsWith(METADATA_SCHEMA_MANAGER_WIDGET_ID),
      ) ||
      this.getWidgetLabelsForContextCheck().some((label) =>
        label.includes('Metadata Schema Manager'),
      )
    )
  }

  protected isFileExplorerFocused(): boolean {
    return this.getWidgetIdsForContextCheck().some(
      (id) =>
        id === FILE_NAVIGATOR_WIDGET_ID ||
        id === FILE_NAVIGATOR_VIEW_CONTAINER_ID ||
        id.startsWith(FILE_NAVIGATOR_VIEW_CONTAINER_ID),
    )
  }

  protected isRoCrateEditorFocused(): boolean {
    return (
      this.getWidgetIdsForContextCheck().some((id) =>
        id.startsWith(RO_CRATE_EDITOR_WIDGET_ID_PREFIX),
      ) ||
      this.getWidgetLabelsForContextCheck().some((label) =>
        label.startsWith('RO-Crate Editor'),
      )
    )
  }

  protected getPrimaryWidgetId(): string | undefined {
    return this.shell.currentWidget?.id ?? this.shell.activeWidget?.id
  }

  protected getWidgetIdsForContextCheck(): string[] {
    const ids = new Set<string>()
    const currentId = this.shell.currentWidget?.id
    const activeId = this.shell.activeWidget?.id

    if (currentId) {
      ids.add(currentId)
    }
    if (activeId) {
      ids.add(activeId)
    }
    if (this.lastInteractionWidgetId) {
      ids.add(this.lastInteractionWidgetId)
    }

    return Array.from(ids)
  }

  protected getWidgetLabelsForContextCheck(): string[] {
    const labels = new Set<string>()
    const currentLabel = this.shell.currentWidget?.title?.label
    const activeLabel = this.shell.activeWidget?.title?.label
    if (currentLabel) {
      labels.add(currentLabel)
    }
    if (activeLabel) {
      labels.add(activeLabel)
    }
    return Array.from(labels)
  }

  protected updateLastInteractionWidgetId(
    source: 'focusin' | 'mousedown',
    target: EventTarget | null,
  ): void {
    if (!(target instanceof HTMLElement)) {
      return
    }

    const widgetId = this.resolveWidgetIdFromTarget(target)
    if (widgetId) {
      this.lastInteractionWidgetId = widgetId
      this.onDidChangeEditEnablementEmitter.fire()
      this.triggerMainMenuRefresh(`dom.${source}`)
    }
  }

  protected resolveWidgetIdFromTarget(target: HTMLElement): string | undefined {
    const widgetElement = target.closest('.p-Widget') as HTMLElement | null
    if (widgetElement?.id) {
      return widgetElement.id
    }
    if (target.closest('.metadata-schema-manager-widget')) {
      return METADATA_SCHEMA_MANAGER_WIDGET_ID
    }
    if (target.closest('.rocrate-editor')) {
      return `${RO_CRATE_EDITOR_WIDGET_ID_PREFIX}:dom`
    }
    if (
      target.closest('.theia-Files') ||
      target.closest(`#${FILE_NAVIGATOR_WIDGET_ID}`) ||
      target.closest(`#${FILE_NAVIGATOR_VIEW_CONTAINER_ID}`)
    ) {
      return FILE_NAVIGATOR_WIDGET_ID
    }
    return undefined
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
    this.triggerMainMenuRefresh('replaceEditMenuActions')
  }

  protected triggerMainMenuRefresh(_reason: string): void {
    if (!this.electronMainMenuFactory || this.menuRefreshScheduled) {
      return
    }
    this.menuRefreshScheduled = true
    window.setTimeout(() => {
      this.menuRefreshScheduled = false
      try {
        this.electronMainMenuFactory?.doSetMenuBar()
      } catch {
        // no-op
      }
    }, 0)
  }
}

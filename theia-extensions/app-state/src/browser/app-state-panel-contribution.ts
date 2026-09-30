// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import {
  ApplicationShell,
  CommonMenus,
  type FrontendApplicationContribution,
  WidgetManager,
} from '@theia/core/lib/browser'
import type {
  Command,
  CommandContribution,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
} from '@theia/core/lib/common'
import { nls } from '@theia/core/lib/common/nls'
import { inject, injectable } from 'inversify'
import { AppStatePanelWidget } from './app-state-panel-widget'
import { AppStateService } from './state/app-state-service'

export const OpenAppStatePanelCommand: Command = {
  id: 'app-state-extension:open-app-state-panel',
  label: nls.localize('rockit/appState/panel/show', 'Show AppState Panel'),
  category: nls.localize('rockit/appState/panel/viewCategory', 'View'),
}

@injectable()
export class AppStatePanelContribution
  implements FrontendApplicationContribution, CommandContribution, MenuContribution
{
  @inject(AppStateService)
  protected readonly appState: AppStateService

  @inject(WidgetManager)
  protected readonly widgetManager: WidgetManager

  @inject(ApplicationShell)
  protected readonly shell: ApplicationShell

  onStart(): void {
    // Panel is opened manually through its command or menu item.
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(OpenAppStatePanelCommand, {
      execute: async () => {
        this.openPanel()
      },
    })
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.VIEW, {
      commandId: OpenAppStatePanelCommand.id,
      label: OpenAppStatePanelCommand.label,
    })
  }

  private async openPanel(): Promise<void> {
    const widget = await this.widgetManager.getOrCreateWidget<AppStatePanelWidget>(
      AppStatePanelWidget.ID,
    )
    if (!widget.isAttached) {
      this.shell.addWidget(widget, { area: 'bottom' })
    }
    this.shell.activateWidget(widget.id)
  }
}

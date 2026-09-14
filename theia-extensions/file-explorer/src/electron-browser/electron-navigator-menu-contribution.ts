// *****************************************************************************
// Copyright (C) 2021 EclipseSource and others.
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
  Command,
  CommandContribution,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
  SelectionService,
} from '@theia/core'
import {
  CommonCommands,
  KeybindingContribution,
  KeybindingRegistry,
  OpenWithService,
} from '@theia/core/lib/browser'
import { nls } from '@theia/core/lib/common'
import { FileUri } from '@theia/core/lib/common/file-uri'
import { isOSX, isWindows } from '@theia/core/lib/common/os'
import { UriAwareCommandHandler } from '@theia/core/lib/common/uri-command-handler'
import { inject, injectable } from '@theia/core/shared/inversify'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { NavigatorContextMenu, SHELL_TABBAR_CONTEXT_REVEAL } from '../browser/navigator-contribution'

// Side-effect import to attach types to window for Electron
import '@theia/core/lib/electron-common/electron-api'

export const OPEN_CONTAINING_FOLDER = Command.toLocalizedCommand(
  {
    id: 'revealFileInOS',
    category: CommonCommands.FILE_CATEGORY,
    label: isWindows
      ? 'Reveal in File Explorer'
      : isOSX
        ? 'Reveal in Finder'
        : 'Open Containing Folder',
  },
  isWindows
    ? 'rockit/fileExplorer/revealInFileExplorer'
    : isOSX
      ? 'rockit/fileExplorer/revealInFinder'
      : 'rockit/fileExplorer/openContainingFolder',
)

export const OPEN_WITH_SYSTEM_APP = Command.toLocalizedCommand(
  {
    id: 'openWithSystemApp',
    category: CommonCommands.FILE_CATEGORY,
    label: 'Open With System Editor',
  },
  'rockit/fileExplorer/openWithSystemEditor',
)

@injectable()
export class ElectronNavigatorMenuContribution
  implements MenuContribution, CommandContribution, KeybindingContribution
{
  @inject(SelectionService) protected readonly selectionService: SelectionService
  @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService
  @inject(OpenWithService) protected readonly openWithService: OpenWithService

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(
      OPEN_CONTAINING_FOLDER,
      UriAwareCommandHandler.MonoSelect(this.selectionService, {
        execute: async (uri) => {
          ;(window as any).electronTheiaCore.showItemInFolder(FileUri.fsPath(uri))
        },
        isEnabled: (uri) => !!this.workspaceService.getWorkspaceRootUri(uri),
        isVisible: (uri) => !!this.workspaceService.getWorkspaceRootUri(uri),
      }),
    )
    commands.registerCommand(
      OPEN_WITH_SYSTEM_APP,
      UriAwareCommandHandler.MonoSelect(this.selectionService, {
        execute: async (uri) => {
          this.openWithSystemApplication(uri)
        },
      }),
    )
    this.openWithService.registerHandler({
      id: 'system-editor',
      label: nls.localize('rockit/fileExplorer/systemEditor', 'System Editor'),
      providerName: nls.localize('rockit/fileExplorer/builtIn', 'Built-in'),
      canHandle: (uri) => (uri.scheme === 'file' ? 10 : 0),
      open: (uri) => {
        this.openWithSystemApplication(uri)
        return {}
      },
    })
  }

  protected openWithSystemApplication(uri: import('@theia/core').URI): void {
    ;(window as any).electronTheiaCore.openWithSystemApp(FileUri.fsPath(uri))
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(NavigatorContextMenu.NAVIGATION, {
      commandId: OPEN_CONTAINING_FOLDER.id,
      label: OPEN_CONTAINING_FOLDER.label,
    })
    menus.registerMenuAction(SHELL_TABBAR_CONTEXT_REVEAL, {
      commandId: OPEN_CONTAINING_FOLDER.id,
      label: OPEN_CONTAINING_FOLDER.label,
      order: '4',
    })
  }

  registerKeybindings(keybindings: KeybindingRegistry): void {
    keybindings.registerKeybinding({
      command: OPEN_CONTAINING_FOLDER.id,
      keybinding: 'ctrlcmd+alt+p',
      when: 'filesExplorerFocus',
    })
  }
}

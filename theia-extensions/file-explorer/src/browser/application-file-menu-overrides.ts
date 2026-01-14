import { environment } from '@theia/core'
import { CommonMenus, FrontendApplicationContribution } from '@theia/core/lib/browser'
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding'
import { CommandRegistry, MenuModelRegistry } from '@theia/core/lib/common'
import { isOSX } from '@theia/core/lib/common/os'
import { inject, injectable } from '@theia/core/shared/inversify'
import { WorkspaceCommands } from '@theia/workspace/lib/browser'
import { FILE_WORKSPACE } from '@theia/workspace/lib/browser/workspace-frontend-contribution'

@injectable()
export class ApplicationFileMenuOverrides implements FrontendApplicationContribution {
  @inject(MenuModelRegistry)
  protected readonly menuRegistry: MenuModelRegistry

  @inject(CommandRegistry)
  protected readonly commandRegistry: CommandRegistry

  @inject(KeybindingRegistry)
  protected readonly keybindingRegistry: KeybindingRegistry

  onStart(): void {
    this.updateWorkspaceLabels()
    this.removeWorkspaceMenuItems()
    this.removeWorkspaceCommands()
    this.removeWorkspaceKeybindings()
  }

  protected updateWorkspaceLabels(): void {
    const openFolderLabel = 'Open Folder as RO-Crate'
    WorkspaceCommands.OPEN_FOLDER.label = openFolderLabel
    WorkspaceCommands.OPEN_FOLDER.dialogLabel = openFolderLabel
    this.updateCommandLabel(WorkspaceCommands.OPEN_FOLDER.id, openFolderLabel)

    const openRecentLabel = 'Open Recent RO-Crate'
    WorkspaceCommands.OPEN_RECENT_WORKSPACE.label = openRecentLabel
    this.updateCommandLabel(WorkspaceCommands.OPEN_RECENT_WORKSPACE.id, openRecentLabel)

    const closeLabel = 'Close RO-Crate'
    WorkspaceCommands.CLOSE.label = closeLabel
    this.updateCommandLabel(WorkspaceCommands.CLOSE.id, closeLabel)
  }

  protected updateCommandLabel(commandId: string, label: string): void {
    const command = this.commandRegistry.getCommand(commandId)
    if (!command) {
      return
    }
    command.label = label
    command.originalLabel = label
  }

  protected removeWorkspaceMenuItems(): void {
    this.menuRegistry.unregisterMenuAction(
      WorkspaceCommands.OPEN_WORKSPACE.id,
      CommonMenus.FILE_OPEN,
    )
    this.menuRegistry.unregisterMenuAction(
      WorkspaceCommands.ADD_FOLDER.id,
      FILE_WORKSPACE,
    )
    this.menuRegistry.unregisterMenuAction(
      WorkspaceCommands.SAVE_WORKSPACE_AS.id,
      FILE_WORKSPACE,
    )

    this.menuRegistry.unregisterMenuAction(
      WorkspaceCommands.OPEN_FOLDER.id,
      CommonMenus.FILE_OPEN,
    )
    if (!isOSX && environment.electron.is()) {
      this.menuRegistry.registerMenuAction(CommonMenus.FILE_OPEN, {
        commandId: WorkspaceCommands.OPEN_FOLDER.id,
        label: 'Open Folder as RO-Crate',
        order: 'a02',
      })
    }
  }

  protected removeWorkspaceCommands(): void {
    this.commandRegistry.unregisterCommand(WorkspaceCommands.OPEN_WORKSPACE.id)
    this.commandRegistry.unregisterCommand(WorkspaceCommands.ADD_FOLDER.id)
    this.commandRegistry.unregisterCommand(WorkspaceCommands.SAVE_WORKSPACE_AS.id)
  }

  protected removeWorkspaceKeybindings(): void {
    this.keybindingRegistry.unregisterKeybinding(WorkspaceCommands.OPEN_WORKSPACE.id)
    this.keybindingRegistry.unregisterKeybinding(WorkspaceCommands.ADD_FOLDER.id)
    this.keybindingRegistry.unregisterKeybinding(WorkspaceCommands.SAVE_WORKSPACE_AS.id)
  }
}

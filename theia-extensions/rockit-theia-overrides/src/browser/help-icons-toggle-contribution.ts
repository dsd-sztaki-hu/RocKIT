import {
  CommonMenus,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser'
import { ElectronMainMenuFactory } from '@theia/core/lib/electron-browser/menu/electron-main-menu-factory'
import {
  Command,
  CommandContribution,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
  PreferenceScope,
  PreferenceService,
} from '@theia/core/lib/common'
import { inject, injectable, optional } from '@theia/core/shared/inversify'
import { ROCKIT_HELP_ICONS_VISIBLE } from '../common/rockit-splash-preferences'

export const TOGGLE_HELP_ICONS_COMMAND: Command = {
  id: 'rockit.helpIcons.toggle',
  label: 'Toggle Help Icons',
}

const HELP_TOGGLE_GROUP = [...CommonMenus.HELP, 'z_toggle']
const HELP_ICONS_HIDDEN_CLASS = 'rockit-help-icons-hidden'

@injectable()
export class HelpIconsToggleContribution
  implements FrontendApplicationContribution, CommandContribution, MenuContribution
{
  @inject(PreferenceService)
  protected readonly preferenceService: PreferenceService

  @inject(ElectronMainMenuFactory)
  @optional()
  protected readonly electronMainMenuFactory?: ElectronMainMenuFactory

  protected menuRefreshScheduled = false

  onStart(): void {
    this.applyHelpIconsVisibility()
    this.preferenceService.onPreferenceChanged((event) => {
      if (event.preferenceName === ROCKIT_HELP_ICONS_VISIBLE) {
        this.applyHelpIconsVisibility()
        this.triggerMainMenuRefresh()
      }
    })
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(TOGGLE_HELP_ICONS_COMMAND, {
      execute: async () => {
        await this.preferenceService.set(
          ROCKIT_HELP_ICONS_VISIBLE,
          !this.areHelpIconsVisible(),
          PreferenceScope.User,
        )
        this.applyHelpIconsVisibility()
        this.triggerMainMenuRefresh()
      },
      isToggled: () => this.areHelpIconsVisible(),
    })
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(HELP_TOGGLE_GROUP, {
      commandId: TOGGLE_HELP_ICONS_COMMAND.id,
      label: TOGGLE_HELP_ICONS_COMMAND.label,
      order: '0',
    })
  }

  protected areHelpIconsVisible(): boolean {
    return this.preferenceService.get<boolean>(ROCKIT_HELP_ICONS_VISIBLE, true)
  }

  protected applyHelpIconsVisibility(): void {
    document.body.classList.toggle(
      HELP_ICONS_HIDDEN_CLASS,
      !this.areHelpIconsVisible(),
    )
  }

  protected triggerMainMenuRefresh(): void {
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

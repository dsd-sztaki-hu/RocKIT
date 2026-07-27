import {
  codicon,
  CommonCommands,
  CommonMenus,
  FrontendApplication,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser'
import { quickCommand } from '@theia/core/lib/browser/quick-input/quick-command-service'
import { IconThemeService } from '@theia/core/lib/browser/icon-theme-service'
import { ThemeService } from '@theia/core/lib/browser/theming'
import { MenuContribution, MenuModelRegistry, nls } from '@theia/core/lib/common'
import { MANAGE_MENU } from '@theia/core/lib/common/menu'
import { inject, injectable } from '@theia/core/shared/inversify'

@injectable()
export class ApplicationManageMenuOverrides
  implements FrontendApplicationContribution, MenuContribution
{
  @inject(MenuModelRegistry)
  protected readonly menuRegistry: MenuModelRegistry
  @inject(ThemeService)
  protected readonly themeService: ThemeService
  @inject(IconThemeService)
  protected readonly iconThemeService: IconThemeService

  registerMenus(menus: MenuModelRegistry): void {
    this.localizeManageMenu(menus)
  }

  onStart(): void {
    this.localizeManageMenu()
    this.localizeBuiltInThemeLabels()
    window.setTimeout(() => {
      this.localizeManageMenu()
      this.localizeBuiltInThemeLabels()
    }, 0)
  }

  onDidInitializeLayout(app: FrontendApplication): void {
    app.shell.leftPanelHandler.removeBottomMenu('settings-menu')
    app.shell.leftPanelHandler.addBottomMenu({
      id: 'settings-menu',
      iconClass: codicon('settings-gear'),
      title: nls.localize('rockit/manageMenu/manage', 'Manage'),
      menuPath: MANAGE_MENU,
      order: 0,
    })
  }

  protected localizeManageMenu(menus: MenuModelRegistry = this.menuRegistry): void {
    menus.unregisterMenuAction(quickCommand.id, CommonMenus.MANAGE_GENERAL)
    menus.registerMenuAction(CommonMenus.MANAGE_GENERAL, {
      commandId: quickCommand.id,
      label: nls.localize('rockit/manageMenu/commandPalette', 'Command Palette...'),
      order: '0',
    })

    menus.unregisterMenuAction(
      CommonCommands.OPEN_PREFERENCES.id,
      CommonMenus.MANAGE_SETTINGS,
    )
    menus.registerMenuAction(CommonMenus.MANAGE_SETTINGS, {
      commandId: CommonCommands.OPEN_PREFERENCES.id,
      label: nls.localize('rockit/manageMenu/settings', 'Settings'),
      order: 'a10',
    })

    menus.registerSubmenu(
      CommonMenus.MANAGE_SETTINGS_THEMES,
      nls.localize('rockit/manageMenu/themes', 'Themes'),
      { sortString: 'a50' },
    )

    for (const menuPath of [
      CommonMenus.MANAGE_SETTINGS_THEMES,
      CommonMenus.FILE_SETTINGS_SUBMENU_THEME,
    ]) {
      menus.unregisterMenuAction(CommonCommands.SELECT_COLOR_THEME.id, menuPath)
      menus.unregisterMenuAction(CommonCommands.SELECT_ICON_THEME.id, menuPath)
      menus.registerMenuAction(menuPath, {
        commandId: CommonCommands.SELECT_COLOR_THEME.id,
        label: nls.localize('rockit/manageMenu/colorTheme', 'Color Theme'),
        order: '0',
      })
      menus.registerMenuAction(menuPath, {
        commandId: CommonCommands.SELECT_ICON_THEME.id,
        label: nls.localize('rockit/manageMenu/fileIconTheme', 'File Icon Theme'),
        order: '1',
      })
    }
  }

  protected localizeBuiltInThemeLabels(): void {
    const colorThemeLabels: Record<string, string> = {
      light: nls.localize('rockit/manageMenu/lightTheme', 'Light (Theia)'),
      dark: nls.localize('rockit/manageMenu/darkTheme', 'Dark (Theia)'),
      'hc-theia': nls.localize(
        'rockit/manageMenu/highContrastTheme',
        'High Contrast (Theia)',
      ),
      'hc-theia-light': nls.localize(
        'rockit/manageMenu/highContrastLightTheme',
        'High Contrast Light (Theia)',
      ),
    }
    for (const theme of this.themeService.getThemes()) {
      const label = colorThemeLabels[theme.id]
      if (label) {
        ;(theme as { label: string }).label = label
      }
    }

    for (const theme of this.iconThemeService.definitions) {
      if (theme.id === 'theia-file-icons') {
        ;(theme as { label: string }).label = nls.localize(
          'rockit/manageMenu/theiaFileIcons',
          'File Icons (Theia)',
        )
      } else if (theme.id === 'none') {
        const mutableTheme = theme as { label: string; description?: string }
        mutableTheme.label = nls.localize('rockit/manageMenu/noIconTheme', 'None')
        mutableTheme.description = nls.localize(
          'rockit/manageMenu/disableFileIcons',
          'Disable file icons',
        )
      }
    }
  }
}

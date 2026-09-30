import { injectable } from '@theia/core/shared/inversify'
import { MenuModelRegistry, nls } from '@theia/core'
import { GlobalEntityLibraryWidget } from './global-entity-library-widget'
import { AbstractViewContribution } from '@theia/core/lib/browser'
import { Command, CommandRegistry } from '@theia/core/lib/common/command'

export const GlobalEntityLibraryCommand: Command = {
    id: 'global-entity-library:open',
    label: nls.localize('rockit/globalEntities/open', 'Open Global Entity Library'),
}

@injectable()
export class GlobalEntityLibraryContribution extends AbstractViewContribution<GlobalEntityLibraryWidget> {

    /**
     * `AbstractViewContribution` handles the creation and registering
     *  of the widget including commands, menus, and keybindings.
     * 
     * We can pass `defaultWidgetOptions` which define widget properties such as 
     * its location `area` (`main`, `left`, `right`, `bottom`), `mode`, and `ref`.
     * 
     */
    constructor() {
        super({
            widgetId: GlobalEntityLibraryWidget.ID,
            widgetName: GlobalEntityLibraryWidget.LABEL,
            defaultWidgetOptions: { area: 'main' },
            toggleCommandId: GlobalEntityLibraryCommand.id,
        })
    }

    /**
     * Example command registration to open the widget from the menu, and quick-open.
     * For a simpler use case, it is possible to simply call:
     ```ts
        super.registerCommands(commands)
     ```
     *
     * For more flexibility, we can pass `OpenViewArguments` which define 
     * options on how to handle opening the widget:
     * 
     ```ts
        toggle?: boolean
        activate?: boolean;
        reveal?: boolean;
     ```
     *
     * @param commands
     */
    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(GlobalEntityLibraryCommand, {
            execute: () => this.openView({ activate: true, reveal: true }),
        })
    }

    /**
     * Example menu registration to contribute a menu item used to open the widget.
     * Default location when extending the `AbstractViewContribution` is the `View` main-menu item.
     * 
     * We can however define new menu path locations in the following way:
     ```ts
        menus.registerMenuAction(CommonMenus.HELP, {
            commandId: 'id',
            label: 'label'
        });
     ```
     * 
     * @param menus
     */
    registerMenus(_menus: MenuModelRegistry): void {
        // RocKIT registers this command in the RO-Crate managers group.
    }
}

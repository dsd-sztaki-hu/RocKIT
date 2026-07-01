import { injectable } from '@theia/core/shared/inversify';
import { MenuModelRegistry } from '@theia/core';
import { SchemaValidatorWidget } from './schema-validator-widget';
import { AbstractViewContribution, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { inject } from '@theia/core/shared/inversify';
import { AppStateService } from 'app-state/lib/browser/state/app-state-service';

export const SchemaValidatorCommand: Command = { id: 'validation-errors:command' };

@injectable()
export class SchemaValidatorContribution
    extends AbstractViewContribution<SchemaValidatorWidget>
    implements FrontendApplicationContribution {

    @inject(AppStateService)
    protected readonly appStateService!: AppStateService;

    protected previousValidationErrorCount = 0;

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
            widgetId: SchemaValidatorWidget.ID,
            widgetName: SchemaValidatorWidget.LABEL,
            defaultWidgetOptions: { area: 'left' },
            toggleCommandId: SchemaValidatorCommand.id
        });
    }

    async onStart(): Promise<void> {
        await this.appStateService.ready;
        this.previousValidationErrorCount = this.appStateService.validationErrors?.length ?? 0;
        this.appStateService.onDidChangeSelector(s => s.validationErrors)((errors) => {
            const nextCount = errors?.length ?? 0;
            const shouldReveal = this.previousValidationErrorCount === 0 && nextCount > 0;
            this.previousValidationErrorCount = nextCount;
            if (shouldReveal) {
                void super.openView({ activate: false, reveal: true });
            }
        });
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
        commands.registerCommand(SchemaValidatorCommand, {
            execute: () => super.openView({ activate: false, reveal: true })
        });
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
    registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
    }
}

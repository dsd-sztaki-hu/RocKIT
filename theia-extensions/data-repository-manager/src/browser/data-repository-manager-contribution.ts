import { injectable, inject } from 'inversify';
import { Command, CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { FrontendApplicationContribution, WidgetManager, CommonMenus, ApplicationShell } from '@theia/core/lib/browser';
import { DATA_REPOSITORY_MANAGER_WIDGET_ID, DATA_REPOSITORY_MANAGER_LABEL } from './data-repository-manager-widget';

export namespace DataRepositoryManagerCommands {
    export const OPEN: Command = {
        id: 'data-repository-manager:open',
        label: `Open ${DATA_REPOSITORY_MANAGER_LABEL}`
    };
}

@injectable()
export class DataRepositoryManagerContribution implements CommandContribution, MenuContribution, FrontendApplicationContribution {
    
    constructor(
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell
    ) {}

    async initializeLayout(): Promise<void> {}

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(DataRepositoryManagerCommands.OPEN, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget(DATA_REPOSITORY_MANAGER_WIDGET_ID);
                if (widget) {
                    this.shell.addWidget(widget, { area: 'main' }); // Opens in main workspace
                    this.shell.activateWidget(widget.id);
                }
            }
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.VIEW, {
            commandId: DataRepositoryManagerCommands.OPEN.id,
            label: DATA_REPOSITORY_MANAGER_LABEL,
            order: 'z60'
        });
    }
}
import { injectable, inject } from 'inversify';
import { Command, CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { FrontendApplicationContribution, WidgetManager, CommonMenus, ApplicationShell } from '@theia/core/lib/browser';
import { DATA_REPOSITORY_MANAGER_WIDGET_ID, DATA_REPOSITORY_MANAGER_LABEL, DataRepositoryManagerWidget } from './data-repository-manager-widget';

export namespace DataRepositoryManagerCommands {
    export const OPEN: Command = {
        id: 'data-repository-manager:open',
        label: `Open ${DATA_REPOSITORY_MANAGER_LABEL}`
    };

    export const EXPORT_TO_REMOTE: Command = {
        id: 'data-repository-manager:export-to-remote',
        label: 'Export To Remote Repository'
    };

    export const IMPORT_FROM_REMOTE: Command = {
        id: 'data-repository-manager:import-from-remote',
        label: 'Import From Remote Repository'
    };
}

@injectable()
export class DataRepositoryManagerContribution implements CommandContribution, MenuContribution, FrontendApplicationContribution {

    constructor(
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell
    ) { }

    async initializeLayout(): Promise<void> { }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(DataRepositoryManagerCommands.OPEN, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget(DATA_REPOSITORY_MANAGER_WIDGET_ID);
                if (widget) {
                    this.shell.addWidget(widget, { area: 'main' });
                    this.shell.activateWidget(widget.id);
                }
            }
        });

        commands.registerCommand(DataRepositoryManagerCommands.EXPORT_TO_REMOTE, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget<DataRepositoryManagerWidget>(DATA_REPOSITORY_MANAGER_WIDGET_ID);
                if (widget) {
                    // We don't necessarily need to add it to shell if it's just a background action,
                    // but usually, we want to ensure the widget is ready or has its state.
                    // The user wants to trigger handleExportToRemote()
                    (widget as any).handleExportToRemote();
                }
            }
        });

        commands.registerCommand(DataRepositoryManagerCommands.IMPORT_FROM_REMOTE, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget<DataRepositoryManagerWidget>(DATA_REPOSITORY_MANAGER_WIDGET_ID);
                if (widget) {
                    widget.handleImportFromRemote();
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

        menus.registerMenuAction(CommonMenus.FILE, {
            commandId: DataRepositoryManagerCommands.IMPORT_FROM_REMOTE.id,
            label: 'Import From Remote Repository',
            order: 'a11'
        });

        menus.registerMenuAction(CommonMenus.FILE, {
            commandId: DataRepositoryManagerCommands.EXPORT_TO_REMOTE.id,
            label: 'Export To Remote Repository',
            order: 'a12'
        });
    }
}

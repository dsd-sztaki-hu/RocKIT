import { injectable, inject } from 'inversify';
import { Command, CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { FrontendApplicationContribution, WidgetManager, CommonMenus, ApplicationShell, OpenerService, codicon } from '@theia/core/lib/browser';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { ApplicationServer } from '@theia/core/lib/common/application-protocol';
import { openRockitDocumentationPage, ROCKIT_DOCUMENTATION_PAGES } from 'rockit-common/lib/browser';
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

    export const LINK_LOCAL_TO_REMOTE: Command = {
        id: 'data-repository-manager:link-local-to-remote',
        label: 'Link Local Dataset To Remote Repository'
    };

    export const OPEN_DOCUMENTATION: Command = {
        id: 'data-repository-manager:open-documentation',
        label: 'Open Data Repository Manager Documentation',
        iconClass: codicon('info')
    };
}

@injectable()
export class DataRepositoryManagerContribution implements CommandContribution, MenuContribution, FrontendApplicationContribution, TabBarToolbarContribution {

    constructor(
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(ApplicationServer) protected readonly applicationServer: ApplicationServer,
        @inject(OpenerService) protected readonly openerService: OpenerService
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

        commands.registerCommand(DataRepositoryManagerCommands.LINK_LOCAL_TO_REMOTE, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget<DataRepositoryManagerWidget>(DATA_REPOSITORY_MANAGER_WIDGET_ID);
                if (widget) {
                    widget.handleLinkLocalToRemote();
                }
            }
        });

        commands.registerCommand(DataRepositoryManagerCommands.OPEN_DOCUMENTATION, {
            execute: () => openRockitDocumentationPage(
                this.applicationServer,
                this.openerService,
                ROCKIT_DOCUMENTATION_PAGES.DATA_REPOSITORY_MANAGER,
            ),
            isEnabled: widget => this.isDataRepositoryManagerWidget(widget),
            isVisible: widget => this.isDataRepositoryManagerWidget(widget)
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
            commandId: DataRepositoryManagerCommands.LINK_LOCAL_TO_REMOTE.id,
            label: 'Link Local Dataset To Remote Repository',
            order: 'a12'
        });

        menus.registerMenuAction(CommonMenus.FILE, {
            commandId: DataRepositoryManagerCommands.EXPORT_TO_REMOTE.id,
            label: 'Export To Remote Repository',
            order: 'a13'
        });
    }

    async registerToolbarItems(toolbarRegistry: TabBarToolbarRegistry): Promise<void> {
        toolbarRegistry.registerItem({
            id: DataRepositoryManagerCommands.OPEN_DOCUMENTATION.id,
            command: DataRepositoryManagerCommands.OPEN_DOCUMENTATION.id,
            tooltip: DataRepositoryManagerCommands.OPEN_DOCUMENTATION.label,
            priority: -100
        });
    }

    protected isDataRepositoryManagerWidget(widget: unknown): boolean {
        return Boolean(widget && typeof widget === 'object' && (widget as { id?: string }).id === DATA_REPOSITORY_MANAGER_WIDGET_ID);
    }
}

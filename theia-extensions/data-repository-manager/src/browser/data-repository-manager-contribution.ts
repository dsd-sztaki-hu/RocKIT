// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { injectable, inject } from 'inversify';
import { Command, CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { FrontendApplicationContribution, WidgetManager, CommonMenus, ApplicationShell, OpenerService, codicon } from '@theia/core/lib/browser';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { ApplicationServer } from '@theia/core/lib/common/application-protocol';
import { openRockitDocumentationPage, ROCKIT_DOCUMENTATION_PAGES } from 'rockit-common/lib/browser';
import { DATA_REPOSITORY_MANAGER_WIDGET_ID, DATA_REPOSITORY_MANAGER_LABEL, DataRepositoryManagerWidget } from './data-repository-manager-widget';
import { nls } from '@theia/core/lib/common/nls';

export namespace DataRepositoryManagerCommands {
    export const OPEN: Command = {
        id: 'data-repository-manager:open',
        label: `Open ${DATA_REPOSITORY_MANAGER_LABEL}`
    };

    export const EXPORT_TO_REMOTE: Command = {
        id: 'data-repository-manager:export-to-remote',
        label: nls.localize('rockit/dataRepository/repositoryOperations', 'Repository Operations')
    };

    export const IMPORT_FROM_REMOTE: Command = {
        id: 'data-repository-manager:import-from-remote',
        label: nls.localize('rockit/dataRepository/importRemote', 'Import From Remote Repository')
    };

    export const LINK_LOCAL_TO_REMOTE: Command = {
        id: 'data-repository-manager:link-local-to-remote',
        label: nls.localize('rockit/dataRepository/linkLocalRemote', 'Link Local Dataset To Remote Repository')
    };

    export const OPEN_DOCUMENTATION: Command = {
        id: 'data-repository-manager:open-documentation',
        label: nls.localize('rockit/dataRepository/openDocumentation', 'Open Data Repository Manager Documentation'),
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

    async initializeLayout(): Promise<void> {
        const widget = await this.widgetManager.getOrCreateWidget<DataRepositoryManagerWidget>(
            DATA_REPOSITORY_MANAGER_WIDGET_ID
        );
        setTimeout(() => {
            void widget.offerInterruptedExportRecovery().catch(error =>
                console.error('Failed to offer interrupted export recovery:', error)
            );
        }, 0);
    }

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
                    widget.handleRepositoryOperations();
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
            commandId: DataRepositoryManagerCommands.EXPORT_TO_REMOTE.id,
            label: DataRepositoryManagerCommands.EXPORT_TO_REMOTE.label,
            order: 'a11'
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

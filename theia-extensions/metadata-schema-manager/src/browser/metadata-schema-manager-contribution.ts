// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

// src/browser/metadata-schema-manager-contribution.ts
import { injectable, inject } from 'inversify';
import { Command, CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { FrontendApplicationContribution, WidgetManager, CommonMenus, ApplicationShell, OpenerService, codicon } from '@theia/core/lib/browser';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { ApplicationServer } from '@theia/core/lib/common/application-protocol';
import { openRockitDocumentationPage, ROCKIT_DOCUMENTATION_PAGES } from 'rockit-common/lib/browser';
import { METADATA_PROFILE_MANAGER_WIDGET_ID } from './metadata-schema-manager-widget';
import { nls } from '@theia/core/lib/common/nls';

export namespace MetadataProfileManagerCommands {
    export const OPEN: Command = {
        id: 'metadata-schema-manager:open',
        label: nls.localize('rockit/schemaManager/open', 'Open Metadata Profile Manager')
    };
    export const OPEN_DOCUMENTATION: Command = {
        id: 'metadata-schema-manager:open-documentation',
        label: nls.localize(
            'rockit/schemaManager/openDocumentation',
            'Open Metadata Profile Manager Documentation',
        ),
        iconClass: codicon('info')
    };
}

@injectable()
export class MetadataProfileManagerContribution implements CommandContribution, MenuContribution, FrontendApplicationContribution, TabBarToolbarContribution {
    
    // Clean, standard Inversify constructor injection. Avoids double-initialization.
    constructor(
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(ApplicationServer) protected readonly applicationServer: ApplicationServer,
        @inject(OpenerService) protected readonly openerService: OpenerService
    ) {}

    async initializeLayout(): Promise<void> {
        // Reserved for future layout initialization
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(MetadataProfileManagerCommands.OPEN, {
            execute: async () => {
                try {
                    const widget = await this.widgetManager.getOrCreateWidget(METADATA_PROFILE_MANAGER_WIDGET_ID);
                    if (widget) {
                        this.shell.addWidget(widget, { area: 'main' });
                        this.shell.activateWidget(widget.id);
                    } else {
                        console.error("Failed to create or retrieve widget:", METADATA_PROFILE_MANAGER_WIDGET_ID);
                    }
                } catch (error) {
                    console.error("Error opening Metadata Profile Manager widget:", error);
                }
            }
        });
        commands.registerCommand(MetadataProfileManagerCommands.OPEN_DOCUMENTATION, {
            execute: () => openRockitDocumentationPage(
                this.applicationServer,
                this.openerService,
                ROCKIT_DOCUMENTATION_PAGES.METADATA_SCHEMA_MANAGER,
            ),
            isEnabled: widget => this.isMetadataProfileManagerWidget(widget),
            isVisible: widget => this.isMetadataProfileManagerWidget(widget)
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.VIEW, {
            commandId: MetadataProfileManagerCommands.OPEN.id,
            label: nls.localize('rockit/schemaManager/title', 'Metadata Profile Manager'),
            order: 'z50'
        });
    }

    async registerToolbarItems(toolbarRegistry: TabBarToolbarRegistry): Promise<void> {
        toolbarRegistry.registerItem({
            id: MetadataProfileManagerCommands.OPEN_DOCUMENTATION.id,
            command: MetadataProfileManagerCommands.OPEN_DOCUMENTATION.id,
            tooltip: MetadataProfileManagerCommands.OPEN_DOCUMENTATION.label,
            priority: -100
        });
    }

    protected isMetadataProfileManagerWidget(widget: unknown): boolean {
        return Boolean(widget && typeof widget === 'object' && (widget as { id?: string }).id === METADATA_PROFILE_MANAGER_WIDGET_ID);
    }
}

// src/browser/metadata-schema-manager-contribution.ts
import { injectable, inject } from 'inversify';
import { Command, CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { FrontendApplicationContribution, WidgetManager, CommonMenus, ApplicationShell } from '@theia/core/lib/browser';
import { METADATA_SCHEMA_MANAGER_WIDGET_ID } from './metadata-schema-manager-widget';

export namespace MetadataSchemaManagerCommands {
    export const OPEN: Command = {
        id: 'metadata-schema-manager:open',
        label: 'Open Metadata Schema Manager'
    };
}

@injectable()
export class MetadataSchemaManagerContribution implements CommandContribution, MenuContribution, FrontendApplicationContribution {
    
    // Clean, standard Inversify constructor injection. Avoids double-initialization.
    constructor(
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell
    ) {}

    async initializeLayout(): Promise<void> {
        // Reserved for future layout initialization
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(MetadataSchemaManagerCommands.OPEN, {
            execute: async () => {
                try {
                    const widget = await this.widgetManager.getOrCreateWidget(METADATA_SCHEMA_MANAGER_WIDGET_ID);
                    if (widget) {
                        this.shell.addWidget(widget, { area: 'main' });
                        this.shell.activateWidget(widget.id);
                    } else {
                        console.error("Failed to create or retrieve widget:", METADATA_SCHEMA_MANAGER_WIDGET_ID);
                    }
                } catch (error) {
                    console.error("Error opening Metadata Schema Manager widget:", error);
                }
            }
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.VIEW, {
            commandId: MetadataSchemaManagerCommands.OPEN.id,
            label: 'Metadata Schema Manager',
            order: 'z50'
        });
    }
}
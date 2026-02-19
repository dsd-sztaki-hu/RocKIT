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
    @inject(WidgetManager) protected readonly widgetManager: WidgetManager;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell; // Inject ApplicationShell

    // Initialize the properties explicitly
    constructor(
        @inject(WidgetManager) widgetManager: WidgetManager,
        @inject(ApplicationShell) shell: ApplicationShell // Inject ApplicationShell in constructor
    ) {
        this.widgetManager = widgetManager;
        this.shell = shell;
    }

    async initializeLayout(): Promise<void> {
        // Optional: Create widget on startup if desired
        // const widget = await this.widgetManager.getOrCreateWidget(METADATA_SCHEMA_MANAGER_WIDGET_ID);
        // if (widget) {
        //     widget.update();
        // }
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
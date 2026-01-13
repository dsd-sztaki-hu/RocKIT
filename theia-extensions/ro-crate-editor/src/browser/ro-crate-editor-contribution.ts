import { injectable, inject } from 'inversify';
import {
    AbstractViewContribution,
    WidgetManager,
    ApplicationShell,
    CommonMenus
} from '@theia/core/lib/browser';
import { MenuModelRegistry } from '@theia/core';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { RoCrateEditorWidget } from './ro-crate-editor-widget';
import { AppStateService } from 'app-state/lib/browser/state/app-state-service';

export const OpenRoCrateEditorCommand: Command = {
    id: 'rocrate.openEditor',
    label: 'Open New RO-Crate Editor'
};

const ROOT_ENTITY_ID = './';

@injectable()
export class RoCrateEditorContribution
    extends AbstractViewContribution<RoCrateEditorWidget> {

    constructor(
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(AppStateService) protected readonly appStateService: AppStateService
    ) {
        super({
            widgetId: RoCrateEditorWidget.ID,
            widgetName: 'RO-Crate Editor',
            defaultWidgetOptions: { area: 'main' }
        });
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(OpenRoCrateEditorCommand, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget(
                    RoCrateEditorWidget.ID,
                    {
                        instance: Math.random().toString()
                    }
                );
                await this.shell.addWidget(widget, { area: 'main' });
                this.registerEditorWidget(widget.id, ROOT_ENTITY_ID);
                await this.shell.activateWidget(widget.id);
            }
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.VIEW, {
            commandId: OpenRoCrateEditorCommand.id,
            label: OpenRoCrateEditorCommand.label
        });
    }

    protected registerEditorWidget(widgetId: string, entityId: string): void {
        // Keep the shared EIRCEIA map keyed by the widget IDs that are actually open.
        const mapping = { ...(this.appStateService.EIRCEIA ?? {}) };
        for (const key of Object.keys(mapping)) {
            if (key === widgetId || mapping[key] === entityId) {
                delete mapping[key];
            }
        }
        mapping[widgetId] = entityId;
        this.appStateService.EIRCEIA = mapping;
    }
}

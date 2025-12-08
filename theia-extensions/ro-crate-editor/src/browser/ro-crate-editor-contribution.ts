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

export const OpenRoCrateEditorCommand: Command = {
    id: 'rocrate.openEditor',
    label: 'Open New RO-Crate Editor'
};

@injectable()
export class RoCrateEditorContribution
    extends AbstractViewContribution<RoCrateEditorWidget> {

    constructor(
        @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell
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
                this.shell.addWidget(widget, { area: 'main' });
                this.shell.activateWidget(widget.id);
            }
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.VIEW, {
            commandId: OpenRoCrateEditorCommand.id,
            label: OpenRoCrateEditorCommand.label
        });
    }
}

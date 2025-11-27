import { AbstractViewContribution, WidgetManager, ApplicationShell } from '@theia/core/lib/browser';
import { MenuModelRegistry } from '@theia/core';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { RoCrateEditorWidget } from './ro-crate-editor-widget';
export declare const OpenRoCrateEditorCommand: Command;
export declare class RoCrateEditorContribution extends AbstractViewContribution<RoCrateEditorWidget> {
    protected readonly widgetManager: WidgetManager;
    protected readonly shell: ApplicationShell;
    constructor(widgetManager: WidgetManager, shell: ApplicationShell);
    registerCommands(registry: CommandRegistry): void;
    registerMenus(menus: MenuModelRegistry): void;
}
//# sourceMappingURL=ro-crate-editor-contribution.d.ts.map
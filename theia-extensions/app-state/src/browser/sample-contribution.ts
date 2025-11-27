import { injectable, inject } from 'inversify';
import { Command, CommandRegistry, CommandContribution, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { FrontendApplicationContribution, WidgetManager, ApplicationShell, CommonMenus } from '@theia/core/lib/browser';
import { AppStateService } from './state/app-state-service';
import { SampleReactWidget } from './sample-react-widget';

export const OpenSampleWidgetCommand: Command = {
    id: 'theia-app-state-extension:open-sample-widget',
    label: 'Open AppState Sample Widget'
};

@injectable()
export class AppStateSampleContribution implements FrontendApplicationContribution, CommandContribution, MenuContribution {

    @inject(AppStateService)
    protected readonly appState: AppStateService;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    onStart(): void {
        // Listen to state changes and log them (as an example)
        this.appState.onDidChangeState(({ current }) => {
            console.log('[AppState] changed:', current);
        });
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(OpenSampleWidgetCommand, {
            execute: async () => {
                const widget = await this.widgetManager.getOrCreateWidget<SampleReactWidget>(
                    SampleReactWidget.ID
                );
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, { area: 'main' });
                }
                this.shell.activateWidget(widget.id);
            }
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.VIEW, {
            commandId: OpenSampleWidgetCommand.id,
            label: OpenSampleWidgetCommand.label
        });
    }
}

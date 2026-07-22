import { ApplicationShell, CommonMenus, WidgetManager } from '@theia/core/lib/browser'
import type {
  Command,
  CommandContribution,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
} from '@theia/core/lib/common'
import { nls } from '@theia/core/lib/common/nls'
import { inject, injectable } from 'inversify'
import { SampleReactWidget } from './sample-react-widget'

export const OpenSampleWidgetCommand: Command = {
  id: 'theia-app-state-sample:open-sample-widget',
  label: nls.localize(
    'rockit/appState/sample/open',
    'Open AppState Sample Widget',
  ),
}

@injectable()
export class AppStateSampleContribution implements CommandContribution, MenuContribution {
  @inject(WidgetManager)
  protected readonly widgetManager: WidgetManager

  @inject(ApplicationShell)
  protected readonly shell: ApplicationShell

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(OpenSampleWidgetCommand, {
      execute: async () => {
        const widget = await this.widgetManager.getOrCreateWidget<SampleReactWidget>(
          SampleReactWidget.ID,
        )
        if (!widget.isAttached) {
          this.shell.addWidget(widget, { area: 'main' })
        }
        this.shell.activateWidget(widget.id)
      },
    })
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.VIEW, {
      commandId: OpenSampleWidgetCommand.id,
      label: OpenSampleWidgetCommand.label,
    })
  }
}

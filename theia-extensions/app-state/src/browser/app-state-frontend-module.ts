import { FrontendApplicationContribution } from '@theia/core/lib/browser'
import { WidgetFactory } from '@theia/core/lib/browser/widget-manager'
import { CommandContribution, MenuContribution } from '@theia/core/lib/common'
import { ContainerModule } from 'inversify'
import { AppStatePanelContribution } from './app-state-panel-contribution'
import { AppStatePanelWidget } from './app-state-panel-widget'
import { AppStateService } from './state/app-state-service'
import {RoCrateLoaderContribution} from "./state/ro-crate-loader";

export default new ContainerModule((bind) => {
  // Global app state service
  bind(AppStateService).toSelf().inSingletonScope()

  // AppState Panel widget
  bind(AppStatePanelWidget).toSelf()
  bind<WidgetFactory>(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: AppStatePanelWidget.ID,
      createWidget: () => ctx.container.get(AppStatePanelWidget),
    }))
    .inSingletonScope()

  // Contributions
  bind(AppStatePanelContribution).toSelf().inSingletonScope()
  bind(RoCrateLoaderContribution).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).to(AppStatePanelContribution)
  bind(FrontendApplicationContribution).toService(RoCrateLoaderContribution);
  bind(CommandContribution).to(AppStatePanelContribution)
  bind(MenuContribution).to(AppStatePanelContribution)
})

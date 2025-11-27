import { ContainerModule } from 'inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { WidgetFactory } from '@theia/core/lib/browser/widget-manager';

import { AppStateService } from './state/app-state-service';
import { AppStatePanelWidget } from './app-state-panel-widget';
import { AppStatePanelContribution } from './app-state-panel-contribution';

export default new ContainerModule(bind => {
    // Global app state service
    bind(AppStateService).toSelf().inSingletonScope();

    // AppState Panel widget
    bind(AppStatePanelWidget).toSelf();
    bind<WidgetFactory>(WidgetFactory).toDynamicValue(ctx => ({
        id: AppStatePanelWidget.ID,
        createWidget: () => ctx.container.get(AppStatePanelWidget)
    })).inSingletonScope();

    // Contributions
    bind(AppStatePanelContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).to(AppStatePanelContribution);
    bind(CommandContribution).to(AppStatePanelContribution);
    bind(MenuContribution).to(AppStatePanelContribution);

});

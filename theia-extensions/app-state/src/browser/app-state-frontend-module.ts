import { ContainerModule } from 'inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { WidgetFactory } from '@theia/core/lib/browser/widget-manager';

import { AppStateService } from './state/app-state-service';
import { SampleReactWidget } from './sample-react-widget';
import { AppStatePanelWidget } from './app-state-panel-widget';
import { AppStatePanelContribution } from './app-state-panel-contribution';
import { AppStateSampleContribution } from './sample-contribution';
// import { AppStateSampleContribution } from './sample-contribution';

export default new ContainerModule(bind => {
    // Global app state service
    bind(AppStateService).toSelf().inSingletonScope();

    // React widgets
    bind(SampleReactWidget).toSelf();
    bind<WidgetFactory>(WidgetFactory).toDynamicValue(ctx => ({
        id: SampleReactWidget.ID,
        createWidget: () => ctx.container.get(SampleReactWidget)
    })).inSingletonScope();

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

    // Sample widget contribution (commands/menus)
    bind(AppStateSampleContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).to(AppStateSampleContribution);
    bind(CommandContribution).to(AppStateSampleContribution);
    bind(MenuContribution).to(AppStateSampleContribution);
});

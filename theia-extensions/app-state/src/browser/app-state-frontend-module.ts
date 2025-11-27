import { ContainerModule } from 'inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { WidgetFactory } from '@theia/core/lib/browser/widget-manager';

import { AppStateService } from './state/app-state-service';
import { SampleReactWidget } from './sample-react-widget';
import { AppStateSampleContribution } from './sample-contribution';

export default new ContainerModule(bind => {
    // Global app state service
    bind(AppStateService).toSelf().inSingletonScope();

    // React widget
    bind(SampleReactWidget).toSelf();
    bind<WidgetFactory>(WidgetFactory).toDynamicValue(ctx => ({
        id: SampleReactWidget.ID,
        createWidget: () => ctx.container.get(SampleReactWidget)
    })).inSingletonScope();

    // Contribution
    bind(AppStateSampleContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AppStateSampleContribution);
});

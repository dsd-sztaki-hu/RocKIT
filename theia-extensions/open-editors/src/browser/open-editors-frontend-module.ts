import { ContainerModule } from '@theia/core/shared/inversify';
import { OpenEditorsWidget } from './open-editors-widget';
import { OpenEditorsContribution } from './open-editors-contribution';
import { bindViewContribution, FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';

import '../../src/browser/style/index.css';

export default new ContainerModule(bind => {
    bindViewContribution(bind, OpenEditorsContribution);
    bind(FrontendApplicationContribution).toService(OpenEditorsContribution);
    bind(OpenEditorsWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: OpenEditorsWidget.ID,
        createWidget: () => ctx.container.get<OpenEditorsWidget>(OpenEditorsWidget)
    })).inSingletonScope();
});

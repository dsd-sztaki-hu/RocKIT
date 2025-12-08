import { ContainerModule } from '@theia/core/shared/inversify';
import { SchemaSelectorWidget } from './schema-selector-widget';
import { SchemaSelectorContribution } from './schema-selector-contribution';
import { bindViewContribution, FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';

import '../../src/browser/style/index.css';

export default new ContainerModule(bind => {
    bindViewContribution(bind, SchemaSelectorContribution);
    bind(FrontendApplicationContribution).toService(SchemaSelectorContribution);
    bind(SchemaSelectorWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: SchemaSelectorWidget.ID,
        createWidget: () => ctx.container.get<SchemaSelectorWidget>(SchemaSelectorWidget)
    })).inSingletonScope();
});

import { ContainerModule } from '@theia/core/shared/inversify';
import { PropertySelectorWidget } from './property-selector-widget';
import { PropertySelectorContribution } from './property-selector-contribution';
import { bindViewContribution, FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';

import '../../src/browser/style/index.css';

export default new ContainerModule(bind => {
    bindViewContribution(bind, PropertySelectorContribution);
    bind(FrontendApplicationContribution).toService(PropertySelectorContribution);
    bind(PropertySelectorWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: PropertySelectorWidget.ID,
        createWidget: () => ctx.container.get<PropertySelectorWidget>(PropertySelectorWidget)
    })).inSingletonScope();
});

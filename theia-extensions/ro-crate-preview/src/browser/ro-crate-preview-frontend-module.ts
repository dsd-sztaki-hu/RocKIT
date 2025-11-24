import { ContainerModule } from '@theia/core/shared/inversify';
import { RoCratePreviewWidget } from './ro-crate-preview-widget';
import { RoCratePreviewContribution } from './ro-crate-preview-contribution';
import { bindViewContribution, FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';

import '../../src/browser/style/index.css';

export default new ContainerModule(bind => {
    bindViewContribution(bind, RoCratePreviewContribution);
    bind(FrontendApplicationContribution).toService(RoCratePreviewContribution);
    bind(RoCratePreviewWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: RoCratePreviewWidget.ID,
        createWidget: () => ctx.container.get<RoCratePreviewWidget>(RoCratePreviewWidget)
    })).inSingletonScope();
});

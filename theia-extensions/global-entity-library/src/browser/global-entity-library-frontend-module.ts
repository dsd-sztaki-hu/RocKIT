import { ContainerModule } from '@theia/core/shared/inversify';
import { GlobalEntityLibraryWidget } from './global-entity-library-widget';
import { GlobalEntityLibraryContribution } from './global-entity-library-contribution';
import { bindViewContribution, FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { GlobalEntityLibraryStore } from './global-entity-library-store';

import '../../src/browser/style/index.css';

export default new ContainerModule(bind => {
    bindViewContribution(bind, GlobalEntityLibraryContribution);
    bind(FrontendApplicationContribution).toService(GlobalEntityLibraryContribution);
    bind(GlobalEntityLibraryWidget).toSelf();
    bind(GlobalEntityLibraryStore).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: GlobalEntityLibraryWidget.ID,
        createWidget: () => ctx.container.get<GlobalEntityLibraryWidget>(GlobalEntityLibraryWidget)
    })).inSingletonScope();
});

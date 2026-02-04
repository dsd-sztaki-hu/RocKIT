import { ContainerModule } from '@theia/core/shared/inversify';
import { SchemaValidatorWidget } from './schema-validator-widget';
import { SchemaValidatorContribution } from './schema-validator-contribution';
import { bindViewContribution, FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { SchemaValidatorService } from './schema-validator-service';
import { SchemaValidatorManager } from 'aroma2-common/lib/browser';

import '../../src/browser/style/index.css';

export default new ContainerModule(bind => {
    bindViewContribution(bind, SchemaValidatorContribution);
    bind(FrontendApplicationContribution).toService(SchemaValidatorContribution);
    bind(SchemaValidatorWidget).toSelf();
    bind(SchemaValidatorManager).to(SchemaValidatorService).inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: SchemaValidatorWidget.ID,
        createWidget: () => ctx.container.get<SchemaValidatorWidget>(SchemaValidatorWidget)
    })).inSingletonScope();
});

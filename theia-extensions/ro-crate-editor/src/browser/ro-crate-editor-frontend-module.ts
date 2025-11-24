import { ContainerModule } from '@theia/core/shared/inversify';
import { bindViewContribution, WidgetFactory } from '@theia/core/lib/browser';
import { RoCrateEditorWidget } from './ro-crate-editor-widget';
import { RoCrateEditorContribution } from './ro-crate-editor-contribution';
import '../../src/browser/style/index.css';

export default new ContainerModule(bind => {
    bind(RoCrateEditorWidget).toSelf();
    bindViewContribution(bind, RoCrateEditorContribution);
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: RoCrateEditorWidget.ID,
        createWidget: (options : any) => {
            const widget = ctx.container.get(RoCrateEditorWidget);
            widget.initialize(options);
            return widget;
        }
    })).inSingletonScope();
});
import { bindViewContribution, WidgetFactory } from '@theia/core/lib/browser'
import { ContainerModule } from '@theia/core/shared/inversify'
import { DatasetPanelContribution } from './dataset-panel-contribution'
import { DatasetPanelWidget } from './dataset-panel-widget'

import '../../src/browser/style/index.css'

export default new ContainerModule((bind) => {
  bind(DatasetPanelWidget).toSelf()
  bindViewContribution(bind, DatasetPanelContribution)
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: DatasetPanelWidget.ID,
      createWidget: (options: any) => {
        const widget = ctx.container.get(DatasetPanelWidget)
        widget.initialize(options)
        return widget
      },
    }))
    .inSingletonScope()
})

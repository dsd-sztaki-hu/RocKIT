import { bindViewContribution, WidgetFactory } from '@theia/core/lib/browser'
import { ContainerModule } from '@theia/core/shared/inversify'
import { RoCrateStructurePanelContribution } from './ro-crate-structure-panel-contribution'
import { RoCrateStructurePanelWidget } from './ro-crate-structure-panel-widget'

import '../../src/browser/style/index.css'

export default new ContainerModule((bind) => {
  bind(RoCrateStructurePanelWidget).toSelf()
  bindViewContribution(bind, RoCrateStructurePanelContribution)
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: RoCrateStructurePanelWidget.ID,
      createWidget: (options: any) => {
        const widget = ctx.container.get(RoCrateStructurePanelWidget)
        widget.initialize(options)
        return widget
      },
    }))
    .inSingletonScope()
})

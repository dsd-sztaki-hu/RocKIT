import { WidgetFactory } from '@theia/core/lib/browser/widget-manager'
import { CommandContribution, MenuContribution } from '@theia/core/lib/common'
import { ContainerModule } from 'inversify'
import { AppStateSampleContribution } from './sample-contribution'
import { SampleReactWidget } from './sample-react-widget'

export default new ContainerModule((bind) => {
  bind(SampleReactWidget).toSelf()
  bind<WidgetFactory>(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: SampleReactWidget.ID,
      createWidget: () => ctx.container.get(SampleReactWidget),
    }))
    .inSingletonScope()

  bind(AppStateSampleContribution).toSelf().inSingletonScope()
  bind(CommandContribution).to(AppStateSampleContribution)
  bind(MenuContribution).to(AppStateSampleContribution)
})

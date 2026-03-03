import '../../src/browser/open-editors.css'

import { ContainerModule } from '@theia/core/shared/inversify'
import {
  bindViewContribution,
  FrontendApplicationContribution,
  LabelProviderContribution,
} from '@theia/core/lib/browser'
import { TabBarDecorator } from '@theia/core/lib/browser/shell/tab-bar-decorator'
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar'
import { WidgetFactory } from '@theia/core/lib/browser/widget-manager'
import { bindContributionProvider } from '@theia/core/lib/common'
import { FileTreeDecoratorAdapter } from '@theia/filesystem/lib/browser'
import { OpenEditorsContribution } from './open-editors-contribution'
import { OpenEditorsWidget } from './navigator-open-editors-widget'
import { OpenEditorsTreeDecorator } from './navigator-open-editors-decorator-service'
import { NavigatorDeletedEditorDecorator } from './navigator-deleted-editor-decorator'
import { OpenEditorsLabelProvider } from './open-editors-label-provider'
import { OpenEditorsTabBarDecorator } from './open-editors-tab-bar-decorator'

export default new ContainerModule((bind) => {
  bindViewContribution(bind, OpenEditorsContribution)
  bind(FrontendApplicationContribution).toService(OpenEditorsContribution)
  bind(TabBarToolbarContribution).toService(OpenEditorsContribution)

  bindContributionProvider(bind, OpenEditorsTreeDecorator)
  bind(OpenEditorsTreeDecorator).toService(FileTreeDecoratorAdapter)
  bind(NavigatorDeletedEditorDecorator).toSelf().inSingletonScope()
  bind(OpenEditorsTreeDecorator).toService(NavigatorDeletedEditorDecorator)

  bind(OpenEditorsLabelProvider).toSelf().inSingletonScope()
  bind(LabelProviderContribution).toService(OpenEditorsLabelProvider)

  bind(WidgetFactory)
    .toDynamicValue(({ container }) => ({
      id: OpenEditorsWidget.ID,
      createWidget: () => OpenEditorsWidget.createWidget(container),
    }))
    .inSingletonScope()

  bind(OpenEditorsTabBarDecorator).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(OpenEditorsTabBarDecorator)
  bind(TabBarDecorator).toService(OpenEditorsTabBarDecorator)
})

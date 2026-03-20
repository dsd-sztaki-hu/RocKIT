import { FrontendApplicationContribution } from '@theia/core/lib/browser'
import { ContainerModule } from '@theia/core/shared/inversify'
import { RoCrateDefaultLayoutContribution } from './application-default-layout-contribution'
import { ApplicationFileMenuOverrides } from './application-file-menu-overrides'
import { ApplicationViewMenuOverrides } from './application-view-menu-overrides'

export default new ContainerModule((bind) => {
  bind(ApplicationFileMenuOverrides).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(ApplicationFileMenuOverrides)
  bind(ApplicationViewMenuOverrides).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(ApplicationViewMenuOverrides)
  bind(RoCrateDefaultLayoutContribution).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(RoCrateDefaultLayoutContribution)
})

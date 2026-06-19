import { FrontendApplicationContribution } from '@theia/core/lib/browser'
import { ContainerModule } from '@theia/core/shared/inversify'
import { LoadMaskContribution } from './loadmask-contribution'
import { LoadMaskService } from './loadmask-service'
import '../../src/browser/style/loadmask.css'

export default new ContainerModule((bind) => {
  bind(LoadMaskService).toSelf().inSingletonScope()
  bind(LoadMaskContribution).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(LoadMaskContribution)
})

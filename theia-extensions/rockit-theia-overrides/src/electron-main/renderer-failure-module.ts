import { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application'
import { ContainerModule } from '@theia/core/shared/inversify'
import { RendererFailureContribution } from './renderer-failure-contribution'

export default new ContainerModule((bind) => {
  bind(RendererFailureContribution).toSelf().inSingletonScope()
  bind(ElectronMainApplicationContribution).toService(
    RendererFailureContribution,
  )
})

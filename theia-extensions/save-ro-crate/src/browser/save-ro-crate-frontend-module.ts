import { CommandContribution, MenuContribution } from '@theia/core/lib/common'
import { ContainerModule } from '@theia/core/shared/inversify'
import { SaveRoCrateContribution } from './save-ro-crate-contribution'

export default new ContainerModule((bind) => {
  bind(SaveRoCrateContribution).toSelf().inSingletonScope()
  bind(CommandContribution).toService(SaveRoCrateContribution)
  bind(MenuContribution).toService(SaveRoCrateContribution)
})

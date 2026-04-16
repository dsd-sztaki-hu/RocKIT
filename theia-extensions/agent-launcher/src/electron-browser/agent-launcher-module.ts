import { CommandContribution, MenuContribution } from '@theia/core'
import { ContainerModule } from '@theia/core/shared/inversify'
import { AgentLauncherContribution } from './agent-launcher-contribution'

export default new ContainerModule((bind) => {
  bind(AgentLauncherContribution).toSelf().inSingletonScope()
  bind(CommandContribution).toService(AgentLauncherContribution)
  bind(MenuContribution).toService(AgentLauncherContribution)
})

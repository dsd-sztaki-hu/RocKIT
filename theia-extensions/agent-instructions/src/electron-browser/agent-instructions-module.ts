import { ContainerModule } from '@theia/core/shared/inversify'
import { AgentInstructionService } from './agent-instruction-service'

export default new ContainerModule((bind) => {
  bind(AgentInstructionService).toSelf().inSingletonScope()
  bind('AgentInstructionService').toService(AgentInstructionService)
})

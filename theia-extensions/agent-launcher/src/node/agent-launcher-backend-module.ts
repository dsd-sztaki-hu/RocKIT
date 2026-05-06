import { ContainerModule } from 'inversify'
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging'
import {
  NativeAgentClient,
  NativeAgentServer,
  NATIVE_AGENT_SERVICE_PATH,
} from '../common/native-agent-protocol'
import { NativeAgentServiceImpl } from './native-agent-service-impl'

export default new ContainerModule((bind) => {
  bind(NativeAgentServer).to(NativeAgentServiceImpl).inSingletonScope()
  bind(ConnectionHandler)
    .toDynamicValue((ctx) =>
      new JsonRpcConnectionHandler<NativeAgentClient>(NATIVE_AGENT_SERVICE_PATH, (client) => {
        const service = ctx.container.get<NativeAgentServer>(NativeAgentServer)
        service.setClient(client)
        return service
      }),
    )
    .inSingletonScope()
})

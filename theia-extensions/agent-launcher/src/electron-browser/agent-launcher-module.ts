import { CommandContribution, MenuContribution } from '@theia/core'
import { WidgetFactory } from '@theia/core/lib/browser'
import { WebSocketConnectionProvider } from '@theia/core/lib/browser/messaging/ws-connection-provider'
import { Emitter } from '@theia/core/lib/common/event'
import { ContainerModule } from '@theia/core/shared/inversify'
import {
  NativeAgentClient,
  NativeAgentService,
  NativeAgentServer,
  NativeAgentSessionEvent,
  NATIVE_AGENT_SERVICE_PATH,
} from '../common/native-agent-protocol'
import { AgentLauncherContribution } from './agent-launcher-contribution'
import { NativeAgentChatWidget, NativeAgentChatWidgetOptions } from './native-agent-chat-widget'

export default new ContainerModule((bind) => {
  bind(NativeAgentService)
    .toDynamicValue((ctx): NativeAgentService => {
      const connectionProvider = ctx.container.get(WebSocketConnectionProvider)
      const onDidChangeSessionEmitter = new Emitter<NativeAgentSessionEvent>()
      const client: NativeAgentClient = {
        notifySessionChanged: (event) => onDidChangeSessionEmitter.fire(event),
      }
      const proxy = connectionProvider.createProxy<NativeAgentServer>(
        NATIVE_AGENT_SERVICE_PATH,
        client,
      )
      return {
        onDidChangeSession: onDidChangeSessionEmitter.event,
        startSession: (input) => proxy.startSession(input),
        getSession: (sessionId) => proxy.getSession(sessionId),
        sendMessage: (input) => proxy.sendMessage(input),
        cancel: (sessionId) => proxy.cancel(sessionId),
        closeSession: (sessionId) => proxy.closeSession(sessionId),
      }
    })
    .inSingletonScope()
  bind(NativeAgentChatWidget).toSelf()
  bind(WidgetFactory)
    .toDynamicValue((ctx) => ({
      id: NativeAgentChatWidget.ID,
      createWidget: async (options?: NativeAgentChatWidgetOptions) => {
        const widget = ctx.container.get(NativeAgentChatWidget)
        widget.initWidget()
        if (options) {
          await widget.initialize(options)
        }
        return widget
      },
    }))
    .inSingletonScope()
  bind(AgentLauncherContribution).toSelf().inSingletonScope()
  bind(CommandContribution).toService(AgentLauncherContribution)
  bind(MenuContribution).toService(AgentLauncherContribution)
})

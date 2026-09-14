// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { CommandContribution, MenuContribution } from '@theia/core'
import { WidgetFactory } from '@theia/core/lib/browser'
import { WebSocketConnectionProvider } from '@theia/core/lib/browser/messaging/ws-connection-provider'
import { Emitter } from '@theia/core/lib/common/event'
import { ContainerModule } from '@theia/core/shared/inversify'
import { TerminalContribution } from '@theia/terminal/lib/browser/terminal-widget-impl'
import {
  NativeAgentClient,
  NativeAgentService,
  NativeAgentServer,
  NativeAgentSessionEvent,
  NATIVE_AGENT_SERVICE_PATH,
} from '../common/native-agent-protocol'
import { bindAgentLauncherPreferences } from '../common/agent-launcher-preferences'
import { AgentLauncherContribution } from './agent-launcher-contribution'
import { NativeAgentChatWidget, NativeAgentChatWidgetOptions } from './native-agent-chat-widget'
import { RockitTerminalLinkContribution } from './rockit-terminal-link-contribution'

export default new ContainerModule((bind) => {
  bindAgentLauncherPreferences(bind)
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
        listChatSessions: (input) => proxy.listChatSessions(input),
        deleteChatSession: (sessionId) => proxy.deleteChatSession(sessionId),
        clearChatSessions: (input) => proxy.clearChatSessions(input),
        renameChatSession: (sessionId, title) => proxy.renameChatSession(sessionId, title),
        listPromptHistory: (input) => proxy.listPromptHistory(input),
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
  bind(RockitTerminalLinkContribution).toSelf().inSingletonScope()
  bind(TerminalContribution).toService(RockitTerminalLinkContribution)
})

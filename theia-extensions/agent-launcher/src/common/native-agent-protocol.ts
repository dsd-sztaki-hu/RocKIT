// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import type { Event } from '@theia/core/lib/common/event'

export const NativeAgentService = Symbol('NativeAgentService')
export const NativeAgentServer = Symbol('NativeAgentServer')
export const NATIVE_AGENT_SERVICE_PATH = '/services/rockit-native-agent'

export type NativeAgentProvider = 'codex' | 'claude'
export type NativeAgentRole = 'user' | 'assistant' | 'system' | 'activity' | 'error'
export type NativeAgentSessionStatus = 'starting' | 'ready' | 'running' | 'error' | 'closed'

export interface NativeAgentMessage {
  id: string
  role: NativeAgentRole
  text: string
  createdAt: string
  streaming?: boolean
  details?: NativeAgentMessageDetail[]
}

export interface NativeAgentMessageDetail {
  title: string
  text: string
  language?: string
}

export interface NativeAgentSession {
  id: string
  provider: NativeAgentProvider
  cwd: string
  status: NativeAgentSessionStatus
  createdAt: string
  updatedAt: string
  messages: NativeAgentMessage[]
  lastError?: string
}

export interface StartNativeAgentSessionInput {
  provider: NativeAgentProvider
  cwd: string
  resumeSessionId?: string
}

export interface SendNativeAgentMessageInput {
  sessionId: string
  text: string
  context?: NativeAgentTurnContext
}

export interface NativeAgentTurnContext {
  selectedEntityId?: string
  validationErrors?: Array<{
    entityId?: string
    fieldName?: string
    fieldLabel?: string
    error?: string
  }>
}

export interface NativeAgentSessionEvent {
  sessionId: string
  session: NativeAgentSession
}

export interface NativeChatSessionIndex {
  id: string
  provider: NativeAgentProvider
  cwd: string
  title: string
  preview: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface NativePromptHistoryEntry {
  provider: NativeAgentProvider
  cwd: string
  text: string
  sentAt: string
}

export interface NativeAgentClient {
  notifySessionChanged(event: NativeAgentSessionEvent): void
}

export interface NativeAgentServer {
  setClient(client: NativeAgentClient | undefined): void
  startSession(input: StartNativeAgentSessionInput): Promise<NativeAgentSession>
  getSession(sessionId: string): Promise<NativeAgentSession | undefined>
  listChatSessions(input?: { cwd?: string; provider?: NativeAgentProvider }): Promise<NativeChatSessionIndex[]>
  deleteChatSession(sessionId: string): Promise<void>
  clearChatSessions(input?: { cwd?: string; provider?: NativeAgentProvider }): Promise<number>
  renameChatSession(sessionId: string, title: string): Promise<NativeChatSessionIndex | undefined>
  listPromptHistory(input: { cwd: string; provider: NativeAgentProvider; query?: string; limit?: number }): Promise<NativePromptHistoryEntry[]>
  sendMessage(input: SendNativeAgentMessageInput): Promise<NativeAgentSession>
  cancel(sessionId: string): Promise<NativeAgentSession | undefined>
  closeSession(sessionId: string): Promise<void>
}

export interface NativeAgentService {
  readonly onDidChangeSession: Event<NativeAgentSessionEvent>
  startSession(input: StartNativeAgentSessionInput): Promise<NativeAgentSession>
  getSession(sessionId: string): Promise<NativeAgentSession | undefined>
  listChatSessions(input?: { cwd?: string; provider?: NativeAgentProvider }): Promise<NativeChatSessionIndex[]>
  deleteChatSession(sessionId: string): Promise<void>
  clearChatSessions(input?: { cwd?: string; provider?: NativeAgentProvider }): Promise<number>
  renameChatSession(sessionId: string, title: string): Promise<NativeChatSessionIndex | undefined>
  listPromptHistory(input: { cwd: string; provider: NativeAgentProvider; query?: string; limit?: number }): Promise<NativePromptHistoryEntry[]>
  sendMessage(input: SendNativeAgentMessageInput): Promise<NativeAgentSession>
  cancel(sessionId: string): Promise<NativeAgentSession | undefined>
  closeSession(sessionId: string): Promise<void>
}

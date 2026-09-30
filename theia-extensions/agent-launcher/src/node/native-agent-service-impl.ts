// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Emitter } from '@theia/core/lib/common/event'
import { injectable } from '@theia/core/shared/inversify'
import type {
  Options as ClaudeQueryOptions,
  Query as ClaudeQuery,
  SDKMessage,
  SDKUserMessage,
  SettingSource,
} from '@anthropic-ai/claude-agent-sdk'
import {
  NativeAgentClient,
  NativeChatSessionIndex,
  NativeAgentMessage,
  NativeAgentProvider,
  NativeAgentServer,
  NativeAgentSession,
  NativeAgentSessionEvent,
  NativePromptHistoryEntry,
  SendNativeAgentMessageInput,
  StartNativeAgentSessionInput,
} from '../common/native-agent-protocol'
import { JsonRpcChildProcess, JsonRpcMessage } from './json-rpc-child-process'

const ROCKIT_AGENT_CONTEXT_PROMPT =
  [
    'You are embedded in RocKIT as an RO-Crate data steward. Prefer RO-Crate MCP tools for metadata edits and keep responses concise.',
    'You are launched from inside RocKIT.',
    'Before doing RO-Crate work, call the RO-Crate MCP tool `set_agent_session_context` with {"launchContext":"inside_rockit","editorAlreadyOpen":true}.',
    'Because RocKIT is already open for this session, do not suggest opening AROMA after edits.',
  ].join('\n')
const RESTORED_CHAT_CONTEXT_MAX_CHARS = 24000

type Adapter = {
  send(text: string): Promise<void>
  cancel(): Promise<void>
  dispose(): void
}

type SessionRecord = {
  session: NativeAgentSession
  adapter?: Adapter
  title?: string
}

type StoredNativeChatSession = NativeChatSessionIndex & {
  messages: NativeAgentMessage[]
  lastError?: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function findExecutable(candidates: string[]): string | undefined {
  const pathValue = process.env.PATH ?? ''
  const dirs = [
    ...pathValue.split(path.delimiter),
    process.env.HOME ? path.join(process.env.HOME, '.volta/bin') : '',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ].filter(Boolean)
  const extensions =
    process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of dirs) {
    for (const candidate of candidates) {
      for (const ext of extensions) {
        const full = path.join(dir, candidate + ext)
        try {
          require('fs').accessSync(full)
          return full
        } catch {}
      }
    }
  }
  return undefined
}

function appendMessage(
  session: NativeAgentSession,
  role: NativeAgentMessage['role'],
  text: string,
  streaming = false,
  details?: NativeAgentMessage['details'],
): NativeAgentMessage {
  const message = { id: id('msg'), role, text, createdAt: nowIso(), streaming, details }
  session.messages.push(message)
  session.updatedAt = message.createdAt
  return message
}

function appendToMessage(message: NativeAgentMessage, text: string): void {
  message.text += text
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function appendActivity(
  session: NativeAgentSession,
  text: string,
  detailTitle: string,
  detailValue: unknown,
): NativeAgentMessage {
  return appendMessage(session, 'activity', text, false, [
    {
      title: detailTitle,
      text: typeof detailValue === 'string' ? detailValue : prettyJson(detailValue),
      language: typeof detailValue === 'string' ? undefined : 'json',
    },
  ])
}

function hasRestorableConversation(messages: NativeAgentMessage[]): boolean {
  return messages.some((message) =>
    (message.role === 'user' || message.role === 'assistant') && Boolean(message.text.trim()),
  )
}

function formatRestoredConversationContext(messages: NativeAgentMessage[], currentText: string): string {
  const transcript = serializeRestoredConversation(messages)
  if (!transcript) {
    return currentText
  }
  return [
    'A previous RocKIT native chat session was reopened. Use the restored transcript below as conversation context, then answer only the newest user message.',
    '',
    '<restored_chat_transcript>',
    transcript,
    '</restored_chat_transcript>',
    '',
    'Newest user message:',
    currentText,
  ].join('\n')
}

function serializeRestoredConversation(messages: NativeAgentMessage[]): string {
  const lines: string[] = []
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') {
      continue
    }
    const text = message.text.trim()
    if (!text) {
      continue
    }
    lines.push(`## ${message.role} (${message.createdAt})`)
    lines.push(text)
    lines.push('')
  }
  const transcript = lines.join('\n').trim()
  if (transcript.length <= RESTORED_CHAT_CONTEXT_MAX_CHARS) {
    return transcript
  }
  return `[Earlier restored chat omitted; showing the most recent ${RESTORED_CHAT_CONTEXT_MAX_CHARS} characters.]\n${transcript.slice(-RESTORED_CHAT_CONTEXT_MAX_CHARS)}`
}

type ClaudeAgentSdkModule = typeof import('@anthropic-ai/claude-agent-sdk')

const importClaudeAgentSdk = new Function(
  'specifier',
  'return import(specifier)',
) as (specifier: string) => Promise<ClaudeAgentSdkModule>

class AsyncMessageQueue<T> implements AsyncIterable<T> {
  protected readonly values: T[] = []
  protected readonly waiters: Array<(result: IteratorResult<T>) => void> = []
  protected closed = false

  push(value: T): void {
    if (this.closed) {
      throw new Error('Cannot send to a closed Claude session.')
    }
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ done: false, value })
      return
    }
    this.values.push(value)
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true, value: undefined as any })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next(),
    }
  }

  protected next(): Promise<IteratorResult<T>> {
    const value = this.values.shift()
    if (value !== undefined) {
      return Promise.resolve({ done: false, value })
    }
    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined as any })
    }
    return new Promise((resolve) => this.waiters.push(resolve))
  }
}

class CodexNativeAdapter implements Adapter {
  protected rpc: JsonRpcChildProcess | undefined
  protected providerThreadId: string | undefined
  protected activeAssistant: NativeAgentMessage | undefined
  protected disposed = false
  protected readonly seenActivityKeys = new Set<string>()
  protected restoredContextPending: boolean

  constructor(
    protected readonly record: SessionRecord,
    protected readonly publish: () => void,
  ) {
    this.restoredContextPending = hasRestorableConversation(record.session.messages)
  }

  async send(text: string): Promise<void> {
    await this.ensureStarted()
    const rpc = this.rpc!
    const inputText = this.consumeRestoredContext(text)
    this.activeAssistant = appendMessage(this.record.session, 'assistant', '', true)
    this.publish()
    await rpc.request('turn/start', {
      threadId: this.providerThreadId,
      input: [{ type: 'text', text: inputText }],
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'dangerFullAccess' },
    })
  }

  protected consumeRestoredContext(text: string): string {
    if (!this.restoredContextPending) {
      return text
    }
    this.restoredContextPending = false
    return formatRestoredConversationContext(this.record.session.messages.slice(0, -1), text)
  }

  async cancel(): Promise<void> {
    this.stopActiveAssistant()
    appendActivity(this.record.session, 'Codex run stopped', 'Cancel details', {
      provider: 'codex',
      stoppedAt: nowIso(),
    })
    this.dispose()
  }

  dispose(): void {
    this.disposed = true
    this.stopActiveAssistant()
    this.rpc?.dispose()
    this.rpc = undefined
  }

  protected stopActiveAssistant(): void {
    if (!this.activeAssistant) {
      return
    }
    this.activeAssistant.streaming = false
    if (!this.activeAssistant.text.trim()) {
      this.activeAssistant.text = 'Stopped.'
    }
    this.activeAssistant = undefined
  }

  protected async ensureStarted(): Promise<void> {
    if (this.rpc) {
      return
    }
    this.disposed = false
    const executable = findExecutable(['codex'])
    if (!executable) {
      throw new Error('Codex executable not found in PATH.')
    }
    const rpc = new JsonRpcChildProcess(executable, ['app-server'], this.record.session.cwd, process.env)
    this.rpc = rpc
    rpc.on('message', (message: JsonRpcMessage) => this.handleMessage(message))
    rpc.on('error', (error: Error) => this.handleRuntimeFailure(error.message))
    rpc.on('exit', ({ code, signal }: { code: number | null; signal: string | null }) => {
      if (!this.disposed && this.record.session.status === 'running') {
        this.handleRuntimeFailure(`Codex app-server exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`)
      }
    })
    rpc.on('stderr', (line: string) => {
      if (line.trim()) {
        appendActivity(this.record.session, 'Codex runtime output', 'stderr', line.trim())
        this.publish()
      }
    })
    await rpc.request('initialize', {
      clientInfo: { name: 'rockit', title: 'RocKIT', version: '0.0.0' },
      capabilities: { experimentalApi: true, optOutNotificationMethods: null },
    })
    rpc.notify('initialized')
    const started = (await rpc.request('thread/start', {
      cwd: this.record.session.cwd,
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      developerInstructions: ROCKIT_AGENT_CONTEXT_PROMPT,
    })) as any
    this.providerThreadId = started?.thread?.id
    if (!this.providerThreadId) {
      throw new Error('Codex app-server did not return a thread id.')
    }
  }

  protected handleMessage(message: JsonRpcMessage): void {
    if (message.id !== undefined && message.method) {
      this.rpc?.respond(message.id, null)
      return
    }
    const params = (message.params ?? {}) as any
    if (message.method === 'item/agentMessage/delta') {
      if (!this.activeAssistant) {
        this.activeAssistant = appendMessage(this.record.session, 'assistant', '', true)
      }
      appendToMessage(this.activeAssistant, String(params.delta ?? ''))
      this.publish()
      return
    }
    if (message.method === 'turn/completed') {
      if (this.activeAssistant) {
        this.activeAssistant.streaming = false
      }
      this.record.session.status = 'ready'
      this.publish()
      return
    }
    if (message.method === 'item/commandExecution/outputDelta') {
      const output = String(params.delta ?? '').trim()
      if (output) {
        appendActivity(this.record.session, 'Command output', 'output', output)
      }
      this.publish()
      return
    }
    const activity = this.summarizeCodexActivity(message)
    if (activity) {
      appendActivity(this.record.session, activity.title, activity.detailTitle, activity.detail)
      this.publish()
      return
    }
    if (message.method === 'error') {
      const error = String(params.message ?? params.error ?? 'Codex runtime error')
      appendMessage(this.record.session, 'error', error)
      this.record.session.lastError = error
      this.record.session.status = 'error'
      this.publish()
    }
  }

  protected summarizeCodexActivity(
    message: JsonRpcMessage,
  ): { title: string; detailTitle: string; detail: unknown } | undefined {
    const method = String(message.method ?? '')
    if (!method.startsWith('item/')) {
      return undefined
    }
    const params = (message.params ?? {}) as any
    const item = params.item ?? params
    const itemType = String(item.type ?? '')
    if (itemType === 'mcpToolCall' || method.toLowerCase().includes('mcptool')) {
      const toolName = this.codexToolName(item)
      const result = this.codexToolResult(item)
      const key = `${method}:${item.id ?? item.callId ?? item.name ?? toolName}:${result ? 'result' : 'call'}:${prettyJson(result ?? item.input ?? item.arguments ?? item).slice(0, 160)}`
      if (this.seenActivityKeys.has(key)) {
        return undefined
      }
      this.seenActivityKeys.add(key)
      if (result !== undefined) {
        return {
          title: `Tool result${this.codexToolResultFailed(item, result) ? ' failed' : ''}`,
          detailTitle: 'Tool output',
          detail: {
            toolName,
            toolUseId: item.id ?? item.callId,
            isError: this.codexToolResultFailed(item, result),
            content: result,
          },
        }
      }
      return {
        title: `Tool: ${toolName}`,
        detailTitle: 'Tool call',
        detail: item,
      }
    }
    if (itemType === 'commandExecution' || method.toLowerCase().includes('commandexecution')) {
      const key = `${method}:${item.id ?? item.callId ?? item.command ?? item.cmd ?? prettyJson(item).slice(0, 160)}`
      if (this.seenActivityKeys.has(key)) {
        return undefined
      }
      this.seenActivityKeys.add(key)
      return {
        title: `Command: ${item.command ?? item.cmd ?? 'execution'}`,
        detailTitle: 'Command details',
        detail: item,
      }
    }
    return undefined
  }

  protected codexToolResult(item: any): unknown {
    for (const key of ['result', 'output', 'content', 'response']) {
      if (item && Object.prototype.hasOwnProperty.call(item, key)) {
        return item[key]
      }
    }
    return undefined
  }

  protected codexToolResultFailed(item: any, result: unknown): boolean {
    if (typeof item?.isError === 'boolean') {
      return item.isError
    }
    if (typeof item?.is_error === 'boolean') {
      return item.is_error
    }
    const status = String(item?.status ?? '').toLowerCase()
    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      return true
    }
    return Boolean(result && typeof result === 'object' && (result as Record<string, unknown>).isError === true)
  }

  protected codexToolName(item: any): string {
    const server = item.server ?? item.serverName ?? item.mcpServerName ?? item.mcpServer
    const tool = item.tool ?? item.toolName ?? item.name ?? item.mcpToolName
    if (typeof server === 'string' && typeof tool === 'string') {
      return `${server}__${tool}`
    }
    if (typeof tool === 'string') {
      return tool
    }
    return 'MCP tool'
  }

  protected handleRuntimeFailure(message: string): void {
    if (this.activeAssistant) {
      this.activeAssistant.streaming = false
      this.activeAssistant = undefined
    }
    this.record.session.status = 'error'
    this.record.session.lastError = message
    appendMessage(this.record.session, 'error', message)
    this.publish()
  }
}

class ClaudeNativeAdapter implements Adapter {
  protected queryRuntime: ClaudeQuery | undefined
  protected promptQueue: AsyncMessageQueue<SDKUserMessage> | undefined
  protected streamPromise: Promise<void> | undefined
  protected activeAssistant: NativeAgentMessage | undefined
  protected cancelling = false
  protected stopped = false
  protected readonly seenActivityKeys = new Set<string>()
  protected restoredContextPending: boolean

  constructor(
    protected readonly record: SessionRecord,
    protected readonly publish: () => void,
  ) {
    this.restoredContextPending = hasRestorableConversation(record.session.messages)
  }

  async send(text: string): Promise<void> {
    await this.ensureStarted()
    this.cancelling = false
    if (this.activeAssistant?.streaming) {
      throw new Error('Claude is still working on the previous message.')
    }
    const inputText = this.consumeRestoredContext(text)
    this.activeAssistant = appendMessage(this.record.session, 'assistant', '', true)
    this.publish()
    this.promptQueue!.push(this.createUserMessage(inputText))
  }

  protected consumeRestoredContext(text: string): string {
    if (!this.restoredContextPending) {
      return text
    }
    this.restoredContextPending = false
    return formatRestoredConversationContext(this.record.session.messages.slice(0, -1), text)
  }

  async cancel(): Promise<void> {
    this.cancelling = true
    await this.queryRuntime?.interrupt().catch(() => undefined)
    if (this.activeAssistant) {
      this.activeAssistant.streaming = false
      this.activeAssistant = undefined
    }
  }

  dispose(): void {
    this.stopped = true
    this.promptQueue?.close()
    this.queryRuntime?.close()
    this.promptQueue = undefined
    this.queryRuntime = undefined
    this.cancelling = false
    if (this.activeAssistant) {
      this.activeAssistant.streaming = false
      this.activeAssistant = undefined
    }
  }

  protected async ensureStarted(): Promise<void> {
    if (this.queryRuntime) {
      return
    }
    this.stopped = false
    const sdk = await importClaudeAgentSdk('@anthropic-ai/claude-agent-sdk')
    const promptQueue = new AsyncMessageQueue<SDKUserMessage>()
    const executable = findExecutable(['claude'])
    const settingSources: SettingSource[] = ['user', 'project', 'local']
    const options: ClaudeQueryOptions = {
      cwd: this.record.session.cwd,
      additionalDirectories: [this.record.session.cwd],
      env: {
        ...process.env,
        CLAUDE_AGENT_SDK_CLIENT_APP: 'rockit/0.0.0',
      },
      settingSources,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: ROCKIT_AGENT_CONTEXT_PROMPT,
      },
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
      stderr: (data: string) => {
        const text = data.trim()
        if (text) {
          appendActivity(this.record.session, 'Claude runtime output', 'stderr', text)
          this.publish()
        }
      },
    }
    this.promptQueue = promptQueue
    this.queryRuntime = sdk.query({ prompt: promptQueue, options })
    this.streamPromise = this.readStream(this.queryRuntime).catch((error) => {
      if (this.stopped) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      if (this.activeAssistant) {
        this.activeAssistant.streaming = false
        this.activeAssistant = undefined
      }
      this.record.session.status = 'error'
      this.record.session.lastError = message
      appendMessage(this.record.session, 'error', message)
      this.publish()
    })
  }

  protected async readStream(queryRuntime: ClaudeQuery): Promise<void> {
    for await (const event of queryRuntime) {
      this.handleClaudeEvent(event)
    }
    if (!this.stopped) {
      this.queryRuntime = undefined
      this.promptQueue = undefined
      if (this.activeAssistant?.streaming) {
        this.activeAssistant.streaming = false
        this.activeAssistant = undefined
      }
      if (this.record.session.status === 'running') {
        this.record.session.status = 'error'
        const message = 'Claude SDK session ended unexpectedly.'
        this.record.session.lastError = message
        appendMessage(this.record.session, 'error', message)
      }
      this.publish()
    }
  }

  protected createUserMessage(text: string): SDKUserMessage {
    return {
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: text,
      },
    } as SDKUserMessage
  }

  protected handleClaudeEvent(event: SDKMessage): void {
    const rawEvent = event as any
    this.appendClaudeActivities(rawEvent)
    const delta = this.extractClaudeText(rawEvent)
    if (delta && this.activeAssistant) {
      appendToMessage(this.activeAssistant, delta)
      this.publish()
    }
    if (rawEvent?.type === 'result') {
      this.completeActiveTurn(rawEvent)
    }
  }

  protected appendClaudeActivities(event: any): void {
    const content = event?.message?.content ?? event?.content
    if (event?.type === 'system' && event?.subtype === 'init') {
      this.appendDistinctActivity('claude:init', 'Claude session initialized', 'Session details', this.summarizeClaudeInit(event))
      return
    }
    if (event?.type === 'result') {
      const usage = event.usage ?? event.total_cost_usd ?? event.duration_ms
      if (usage) {
        this.appendDistinctActivity('claude:result', 'Claude run summary', 'Run details', event)
      }
      return
    }
    if (!Array.isArray(content)) {
      return
    }
    for (const item of content) {
      if (item?.type === 'tool_use') {
        const toolName = item.name ?? 'tool'
        this.appendDistinctActivity(
          `claude:tool_use:${item.id ?? toolName}:${prettyJson(item.input).slice(0, 120)}`,
          `Tool: ${toolName}`,
          'Tool input',
          {
            toolName,
            toolUseId: item.id,
            input: item.input ?? null,
          },
        )
      }
      if (item?.type === 'tool_result') {
        this.appendDistinctActivity(
          `claude:tool_result:${item.tool_use_id ?? prettyJson(item).slice(0, 120)}`,
          `Tool result${item.is_error ? ' failed' : ''}`,
          'Tool output',
          {
            toolUseId: item.tool_use_id,
            isError: Boolean(item.is_error),
            content: item.content ?? null,
          },
        )
      }
    }
  }

  protected summarizeClaudeInit(event: any): unknown {
    return {
      session_id: event.session_id,
      claude_code_version: event.claude_code_version,
      cwd: event.cwd,
      model: event.model,
      permissionMode: event.permissionMode,
      tools: event.tools,
      mcp_servers: event.mcp_servers,
      slash_commands: event.slash_commands,
      output_style: event.output_style,
      skills: event.skills,
      plugins: Array.isArray(event.plugins)
        ? event.plugins.map((plugin: any) => ({
            name: plugin?.name,
            path: plugin?.path,
          }))
        : undefined,
    }
  }

  protected appendDistinctActivity(
    key: string,
    title: string,
    detailTitle: string,
    detail: unknown,
  ): void {
    if (this.seenActivityKeys.has(key)) {
      return
    }
    this.seenActivityKeys.add(key)
    appendActivity(this.record.session, title, detailTitle, detail)
    this.publish()
  }

  protected extractClaudeText(event: any): string {
    if (event?.type === 'stream_event') {
      const streamEvent = event.event
      if (streamEvent?.type === 'content_block_delta') {
        const delta = streamEvent.delta
        if (typeof delta?.text === 'string') {
          return delta.text
        }
        if (typeof delta?.thinking === 'string') {
          return delta.thinking
        }
      }
      return ''
    }
    if (
      event?.type === 'result' &&
      this.activeAssistant &&
      !this.activeAssistant.text.trim() &&
      typeof event?.result === 'string'
    ) {
      return event.result
    }
    return ''
  }

  protected completeActiveTurn(event: any): void {
    if (this.activeAssistant) {
      this.activeAssistant.streaming = false
      this.activeAssistant = undefined
    }
    if (this.cancelling) {
      this.cancelling = false
      this.record.session.status = 'ready'
      this.publish()
      return
    }
    const failed = event.subtype !== 'success' || event.is_error === true
    this.record.session.status = failed ? 'error' : 'ready'
    if (failed) {
      const error = event.error ?? event.result ?? 'Claude turn failed.'
      this.record.session.lastError = String(error)
      appendMessage(this.record.session, 'error', String(error))
    }
    this.publish()
  }
}

@injectable()
export class NativeAgentServiceImpl implements NativeAgentServer {
  protected readonly onDidChangeSessionEmitter = new Emitter<NativeAgentSessionEvent>()
  readonly onDidChangeSession = this.onDidChangeSessionEmitter.event
  protected readonly sessions = new Map<string, SessionRecord>()
  protected client: NativeAgentClient | undefined
  protected readonly historyRoot = path.join(os.homedir(), '.rockit', 'native-chat-history')
  protected readonly sessionsRoot = path.join(this.historyRoot, 'sessions')
  protected readonly promptHistoryPath = path.join(this.historyRoot, 'prompt-history.json')

  setClient(client: NativeAgentClient | undefined): void {
    this.client = client
  }

  async startSession(input: StartNativeAgentSessionInput): Promise<NativeAgentSession> {
    const stored = input.resumeSessionId ? this.readStoredSession(input.resumeSessionId) : undefined
    const session: NativeAgentSession = stored
      ? {
          id: stored.id,
          provider: stored.provider,
          cwd: stored.cwd,
          status: 'ready',
          createdAt: stored.createdAt,
          updatedAt: nowIso(),
          messages: stored.messages ?? [],
          lastError: stored.lastError,
        }
      : {
          id: id('session'),
          provider: input.provider,
          cwd: input.cwd,
          status: 'ready',
          createdAt: nowIso(),
          updatedAt: nowIso(),
          messages: [],
        }
    const record: SessionRecord = { session, title: stored?.title }
    record.adapter = this.createAdapter(input.provider, record)
    this.sessions.set(session.id, record)
    if (!stored) {
      appendMessage(session, 'system', `Native ${input.provider === 'codex' ? 'Codex' : 'Claude'} chat started for ${input.cwd}.`)
    }
    this.publish(record)
    return session
  }

  async getSession(sessionId: string): Promise<NativeAgentSession | undefined> {
    const session = this.sessions.get(sessionId)?.session
    return session ? this.clone(session) : undefined
  }

  async listChatSessions(input?: { cwd?: string; provider?: NativeAgentProvider }): Promise<NativeChatSessionIndex[]> {
    const sessions = this.readSessionIndex()
      .filter((entry) => !input?.cwd || entry.cwd === input.cwd)
      .filter((entry) => !input?.provider || entry.provider === input.provider)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return this.clone(sessions)
  }

  async deleteChatSession(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    record?.adapter?.dispose()
    this.sessions.delete(sessionId)
    const index = this.readSessionIndex().filter((entry) => entry.id !== sessionId)
    this.writeSessionIndex(index)
    try {
      fs.rmSync(this.sessionPath(sessionId), { force: true })
    } catch {}
  }

  async clearChatSessions(input?: { cwd?: string; provider?: NativeAgentProvider }): Promise<number> {
    const index = this.readSessionIndex()
    const deleting = index.filter((entry) => this.matchesSessionFilter(entry, input))
    if (!deleting.length) {
      return 0
    }
    const deletingIds = new Set(deleting.map((entry) => entry.id))
    for (const sessionId of deletingIds) {
      const record = this.sessions.get(sessionId)
      record?.adapter?.dispose()
      this.sessions.delete(sessionId)
      try {
        fs.rmSync(this.sessionPath(sessionId), { force: true })
      } catch {}
    }
    this.writeSessionIndex(index.filter((entry) => !deletingIds.has(entry.id)))
    return deletingIds.size
  }

  async renameChatSession(
    sessionId: string,
    title: string,
  ): Promise<NativeChatSessionIndex | undefined> {
    const trimmed = title.trim()
    if (!trimmed) {
      return undefined
    }
    const stored = this.readStoredSession(sessionId)
    if (!stored) {
      return undefined
    }
    stored.title = trimmed
    this.writeStoredSession(stored)
    const live = this.sessions.get(sessionId)
    if (live) {
      live.title = trimmed
      this.persistSession(live)
    }
    return this.clone(this.toSessionIndex(stored))
  }

  async listPromptHistory(input: {
    cwd: string
    provider: NativeAgentProvider
    query?: string
    limit?: number
  }): Promise<NativePromptHistoryEntry[]> {
    const query = input.query?.trim().toLowerCase() ?? ''
    const limit = Math.max(1, Math.min(Number(input.limit ?? 100), 500))
    const entries = this.readPromptHistory()
      .filter((entry) => entry.cwd === input.cwd && entry.provider === input.provider)
      .filter((entry) => !query || entry.text.toLowerCase().includes(query))
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
      .slice(0, limit)
    return this.clone(entries)
  }

  async sendMessage(input: SendNativeAgentMessageInput): Promise<NativeAgentSession> {
    const record = this.requireSession(input.sessionId)
    if (record.session.status === 'running') {
      throw new Error('The native agent is still working on the previous message.')
    }
    appendMessage(record.session, 'user', input.text)
    this.recordPrompt(record.session.provider, record.session.cwd, input.text)
    record.session.status = 'running'
    this.publish(record)
    try {
      await record.adapter!.send(this.formatUserInput(input))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      appendMessage(record.session, 'error', message)
      record.session.lastError = message
      record.session.status = 'error'
      this.publish(record)
    }
    return this.clone(record.session)
  }

  async cancel(sessionId: string): Promise<NativeAgentSession | undefined> {
    const record = this.sessions.get(sessionId)
    if (!record) {
      return undefined
    }
    await record.adapter?.cancel()
    record.session.status = 'ready'
    this.publish(record)
    return this.clone(record.session)
  }

  async closeSession(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId)
    record?.adapter?.dispose()
    this.sessions.delete(sessionId)
  }

  protected ensureHistoryDirs(): void {
    fs.mkdirSync(this.sessionsRoot, { recursive: true })
  }

  protected indexPath(): string {
    return path.join(this.historyRoot, 'sessions-index.json')
  }

  protected sessionPath(sessionId: string): string {
    return path.join(this.sessionsRoot, `${sessionId}.json`)
  }

  protected readSessionIndex(): NativeChatSessionIndex[] {
    try {
      const raw = fs.readFileSync(this.indexPath(), 'utf8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(this.isSessionIndex) : []
    } catch {
      return []
    }
  }

  protected writeSessionIndex(index: NativeChatSessionIndex[]): void {
    this.ensureHistoryDirs()
    fs.writeFileSync(this.indexPath(), `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  }

  protected readStoredSession(sessionId: string): StoredNativeChatSession | undefined {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.sessionPath(sessionId), 'utf8'))
      const record = parsed as Record<string, unknown>
      if (!this.isSessionIndex(parsed) || !Array.isArray(record.messages)) {
        return undefined
      }
      return parsed as StoredNativeChatSession
    } catch {
      return undefined
    }
  }

  protected writeStoredSession(stored: StoredNativeChatSession): void {
    this.ensureHistoryDirs()
    fs.writeFileSync(this.sessionPath(stored.id), `${JSON.stringify(stored, null, 2)}\n`, 'utf8')
    const next = this.readSessionIndex().filter((entry) => entry.id !== stored.id)
    next.push(this.toSessionIndex(stored))
    this.writeSessionIndex(next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
  }

  protected persistSession(record: SessionRecord): void {
    const stored = this.toStoredSession(record)
    this.writeStoredSession(stored)
  }

  protected toStoredSession(record: SessionRecord): StoredNativeChatSession {
    const index = this.toSessionIndex({
      id: record.session.id,
      provider: record.session.provider,
      cwd: record.session.cwd,
      createdAt: record.session.createdAt,
      updatedAt: record.session.updatedAt,
      title: record.title ?? this.deriveSessionTitle(record.session),
      preview: this.deriveSessionPreview(record.session),
      messageCount: record.session.messages.length,
    })
    return {
      ...index,
      messages: record.session.messages,
      lastError: record.session.lastError,
    }
  }

  protected toSessionIndex(value: {
    id: string
    provider: NativeAgentProvider
    cwd: string
    title: string
    preview: string
    createdAt: string
    updatedAt: string
    messageCount: number
  }): NativeChatSessionIndex {
    return {
      id: value.id,
      provider: value.provider,
      cwd: value.cwd,
      title: value.title,
      preview: value.preview,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      messageCount: value.messageCount,
    }
  }

  protected matchesSessionFilter(
    entry: NativeChatSessionIndex,
    input?: { cwd?: string; provider?: NativeAgentProvider },
  ): boolean {
    return (!input?.cwd || entry.cwd === input.cwd) && (!input?.provider || entry.provider === input.provider)
  }

  protected deriveSessionTitle(session: NativeAgentSession): string {
    const firstUser = session.messages.find((message) => message.role === 'user' && message.text.trim())
    if (firstUser) {
      return this.truncateLine(firstUser.text, 64)
    }
    return `${session.provider === 'codex' ? 'Codex' : 'Claude'} chat ${session.createdAt}`
  }

  protected deriveSessionPreview(session: NativeAgentSession): string {
    const message = [...session.messages].reverse().find((entry) => entry.text.trim())
    return message ? this.truncateLine(message.text, 120) : ''
  }

  protected truncateLine(text: string, maxLength: number): string {
    const line = text.replace(/\s+/g, ' ').trim()
    return line.length <= maxLength ? line : `${line.slice(0, maxLength - 1)}…`
  }

  protected isSessionIndex(value: unknown): value is NativeChatSessionIndex {
    if (!value || typeof value !== 'object') {
      return false
    }
    const record = value as Record<string, unknown>
    return (
      typeof record.id === 'string' &&
      (record.provider === 'codex' || record.provider === 'claude') &&
      typeof record.cwd === 'string' &&
      typeof record.title === 'string' &&
      typeof record.preview === 'string' &&
      typeof record.createdAt === 'string' &&
      typeof record.updatedAt === 'string' &&
      typeof record.messageCount === 'number'
    )
  }

  protected readPromptHistory(): NativePromptHistoryEntry[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.promptHistoryPath, 'utf8'))
      return Array.isArray(parsed) ? parsed.filter(this.isPromptHistoryEntry) : []
    } catch {
      return []
    }
  }

  protected writePromptHistory(entries: NativePromptHistoryEntry[]): void {
    this.ensureHistoryDirs()
    fs.writeFileSync(this.promptHistoryPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
  }

  protected recordPrompt(provider: NativeAgentProvider, cwd: string, text: string): void {
    const trimmed = text.trim()
    if (!trimmed) {
      return
    }
    const entries = this.readPromptHistory()
    const latest = entries
      .filter((entry) => entry.provider === provider && entry.cwd === cwd)
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0]
    if (latest?.text === trimmed) {
      return
    }
    const next = [
      { provider, cwd, text: trimmed, sentAt: nowIso() },
      ...entries,
    ].slice(0, 2000)
    this.writePromptHistory(next)
  }

  protected isPromptHistoryEntry(value: unknown): value is NativePromptHistoryEntry {
    if (!value || typeof value !== 'object') {
      return false
    }
    const record = value as Record<string, unknown>
    return (
      (record.provider === 'codex' || record.provider === 'claude') &&
      typeof record.cwd === 'string' &&
      typeof record.text === 'string' &&
      typeof record.sentAt === 'string'
    )
  }

  protected createAdapter(provider: NativeAgentProvider, record: SessionRecord): Adapter {
    return provider === 'codex'
      ? new CodexNativeAdapter(record, () => this.publish(record))
      : new ClaudeNativeAdapter(record, () => this.publish(record))
  }

  protected requireSession(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId)
    if (!record) {
      throw new Error(`Unknown native agent session: ${sessionId}`)
    }
    return record
  }

  protected formatUserInput(input: SendNativeAgentMessageInput): string {
    const context = input.context
    if (!context) {
      return input.text
    }
    const parts = [input.text]
    if (context.selectedEntityId) {
      parts.push(`Selected RO-Crate entity: ${context.selectedEntityId}`)
    }
    if (context.validationErrors?.length) {
      parts.push(
        `Current validation errors:\n${context.validationErrors
          .slice(0, 10)
          .map((error) => `- ${error.entityId ?? 'unknown'} ${error.fieldLabel ?? error.fieldName ?? ''}: ${error.error ?? ''}`)
          .join('\n')}`,
      )
    }
    return parts.join('\n\n')
  }

  protected publish(record: SessionRecord): void {
    this.persistSession(record)
    const event = {
      sessionId: record.session.id,
      session: this.clone(record.session),
    }
    this.onDidChangeSessionEmitter.fire(event)
    this.client?.notifySessionChanged(event)
  }

  protected clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }
}

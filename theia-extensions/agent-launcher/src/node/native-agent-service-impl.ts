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
  NativeAgentMessage,
  NativeAgentProvider,
  NativeAgentServer,
  NativeAgentSession,
  NativeAgentSessionEvent,
  SendNativeAgentMessageInput,
  StartNativeAgentSessionInput,
} from '../common/native-agent-protocol'
import { JsonRpcChildProcess, JsonRpcMessage } from './json-rpc-child-process'

const CLAUDE_SYSTEM_PROMPT =
  'You are embedded in AROMA as an RO-Crate data steward. Prefer RO-Crate MCP tools for metadata edits and keep responses concise.'

type Adapter = {
  send(text: string): Promise<void>
  cancel(): Promise<void>
  dispose(): void
}

type SessionRecord = {
  session: NativeAgentSession
  adapter?: Adapter
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
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = path.join(dir, candidate)
      try {
        require('fs').accessSync(full)
        return full
      } catch {}
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

  constructor(
    protected readonly record: SessionRecord,
    protected readonly publish: () => void,
  ) {}

  async send(text: string): Promise<void> {
    await this.ensureStarted()
    const rpc = this.rpc!
    this.activeAssistant = appendMessage(this.record.session, 'assistant', '', true)
    this.publish()
    await rpc.request('turn/start', {
      threadId: this.providerThreadId,
      input: [{ type: 'text', text }],
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'dangerFullAccess' },
    })
  }

  async cancel(): Promise<void> {
    this.dispose()
  }

  dispose(): void {
    this.disposed = true
    this.rpc?.dispose()
    this.rpc = undefined
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
      clientInfo: { name: 'aroma', title: 'AROMA', version: '0.0.0' },
      capabilities: { experimentalApi: true, optOutNotificationMethods: null },
    })
    rpc.notify('initialized')
    const started = (await rpc.request('thread/start', {
      cwd: this.record.session.cwd,
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      developerInstructions:
        'You are embedded in AROMA as an RO-Crate data steward. Prefer RO-Crate MCP tools for metadata edits and keep responses concise.',
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

  constructor(
    protected readonly record: SessionRecord,
    protected readonly publish: () => void,
  ) {}

  async send(text: string): Promise<void> {
    await this.ensureStarted()
    this.cancelling = false
    if (this.activeAssistant?.streaming) {
      throw new Error('Claude is still working on the previous message.')
    }
    this.activeAssistant = appendMessage(this.record.session, 'assistant', '', true)
    this.publish()
    this.promptQueue!.push(this.createUserMessage(text))
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
        CLAUDE_AGENT_SDK_CLIENT_APP: 'aroma/0.0.0',
      },
      settingSources,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: CLAUDE_SYSTEM_PROMPT,
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

  setClient(client: NativeAgentClient | undefined): void {
    this.client = client
  }

  async startSession(input: StartNativeAgentSessionInput): Promise<NativeAgentSession> {
    const session: NativeAgentSession = {
      id: id('session'),
      provider: input.provider,
      cwd: input.cwd,
      status: 'ready',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      messages: [],
    }
    const record: SessionRecord = { session }
    record.adapter = this.createAdapter(input.provider, record)
    this.sessions.set(session.id, record)
    appendMessage(session, 'system', `Native ${input.provider === 'codex' ? 'Codex' : 'Claude'} chat started for ${input.cwd}.`)
    this.publish(record)
    return session
  }

  async getSession(sessionId: string): Promise<NativeAgentSession | undefined> {
    const session = this.sessions.get(sessionId)?.session
    return session ? this.clone(session) : undefined
  }

  async sendMessage(input: SendNativeAgentMessageInput): Promise<NativeAgentSession> {
    const record = this.requireSession(input.sessionId)
    if (record.session.status === 'running') {
      throw new Error('The native agent is still working on the previous message.')
    }
    appendMessage(record.session, 'user', input.text)
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

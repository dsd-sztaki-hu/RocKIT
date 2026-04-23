import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import * as path from 'path'
import { Emitter } from '@theia/core/lib/common/event'
import { injectable } from '@theia/core/shared/inversify'
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

class CodexNativeAdapter implements Adapter {
  protected rpc: JsonRpcChildProcess | undefined
  protected providerThreadId: string | undefined
  protected activeAssistant: NativeAgentMessage | undefined
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
    this.rpc?.dispose()
    this.rpc = undefined
  }

  protected async ensureStarted(): Promise<void> {
    if (this.rpc) {
      return
    }
    const executable = findExecutable(['codex'])
    if (!executable) {
      throw new Error('Codex executable not found in PATH.')
    }
    const rpc = new JsonRpcChildProcess(executable, ['app-server'], this.record.session.cwd, process.env)
    this.rpc = rpc
    rpc.on('message', (message: JsonRpcMessage) => this.handleMessage(message))
    rpc.on('stderr', (line: string) => {
      if (line.trim()) {
        appendActivity(this.record.session, 'Codex runtime output', 'stderr', line.trim())
        this.publish()
      }
    })
    await rpc.request('initialize', {
      clientInfo: { name: 'aroma', title: 'AROMA', version: '0.0.0' },
      capabilities: { experimentalApi: true },
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
    const key = `${method}:${item.id ?? item.callId ?? item.name ?? prettyJson(item).slice(0, 160)}`
    if (this.seenActivityKeys.has(key)) {
      return undefined
    }
    this.seenActivityKeys.add(key)

    const itemType = String(item.type ?? '')
    if (itemType === 'mcpToolCall' || method.toLowerCase().includes('mcptool')) {
      const toolName = item.toolName ?? item.name ?? item.mcpToolName ?? 'MCP tool'
      return {
        title: `MCP tool: ${toolName}`,
        detailTitle: 'Tool call',
        detail: item,
      }
    }
    if (itemType === 'commandExecution' || method.toLowerCase().includes('commandexecution')) {
      return {
        title: `Command: ${item.command ?? item.cmd ?? 'execution'}`,
        detailTitle: 'Command details',
        detail: item,
      }
    }
    return undefined
  }
}

class ClaudeNativeAdapter implements Adapter {
  protected child: ChildProcessWithoutNullStreams | undefined
  protected readonly seenActivityKeys = new Set<string>()

  constructor(
    protected readonly record: SessionRecord,
    protected readonly publish: () => void,
  ) {}

  async send(text: string): Promise<void> {
    const executable = findExecutable(['claude'])
    if (!executable) {
      throw new Error('Claude executable not found in PATH.')
    }
    const prompt = this.buildPrompt(text)
    const assistant = appendMessage(this.record.session, 'assistant', '', true)
    this.publish()
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        executable,
        ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'],
        { cwd: this.record.session.cwd, env: process.env, stdio: 'pipe' },
      )
      this.child = child
      child.stdin.end()
      let buffer = ''
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          this.handleClaudeLine(line, assistant)
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim()
        if (text) {
          appendMessage(this.record.session, 'activity', text)
          this.publish()
        }
      })
      child.on('error', reject)
      child.on('exit', (code) => {
        assistant.streaming = false
        this.record.session.status = code === 0 ? 'ready' : 'error'
        if (code !== 0) {
          const error = `Claude exited with code ${code ?? 'unknown'}.`
          this.record.session.lastError = error
          appendMessage(this.record.session, 'error', error)
        }
        this.child = undefined
        this.publish()
        resolve()
      })
    })
  }

  async cancel(): Promise<void> {
    this.child?.kill()
  }

  dispose(): void {
    this.child?.kill()
    this.child = undefined
  }

  protected buildPrompt(text: string): string {
    const previous = this.record.session.messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-8)
      .map((message) => `${message.role}: ${message.text}`)
      .join('\n\n')
    const context = previous ? `Conversation so far:\n${previous}\n\n` : ''
    return `${context}You are embedded in AROMA as an RO-Crate data steward. Prefer RO-Crate MCP tools for metadata edits and keep responses concise.\n\nUser: ${text}`
  }

  protected handleClaudeLine(line: string, assistant: NativeAgentMessage): void {
    if (!line.trim()) {
      return
    }
    try {
      const event = JSON.parse(line) as any
      this.appendClaudeActivities(event)
      const delta = this.extractClaudeText(event, assistant)
      if (delta) {
        appendToMessage(assistant, delta)
        this.publish()
      }
    } catch {
      appendToMessage(assistant, `${line}\n`)
      this.publish()
    }
  }

  protected appendClaudeActivities(event: any): void {
    const content = event?.message?.content ?? event?.content
    if (event?.type === 'system' && event?.subtype === 'init') {
      this.appendDistinctActivity('claude:init', 'Claude session initialized', 'Session details', event)
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

  protected extractClaudeText(event: any, assistant: NativeAgentMessage): string {
    if (event?.type === 'result' && assistant.text.trim()) {
      return ''
    }
    if (typeof event?.delta?.text === 'string') {
      return event.delta.text
    }
    if (typeof event?.text === 'string') {
      return event.text
    }
    const content = event?.message?.content ?? event?.content
    if (Array.isArray(content)) {
      return content
        .map((item) => (typeof item?.text === 'string' ? item.text : ''))
        .filter(Boolean)
        .join('')
    }
    if (typeof event?.result === 'string') {
      return event.result
    }
    return ''
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

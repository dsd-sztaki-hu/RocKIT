import * as React from 'react'
import MarkdownIt = require('markdown-it')
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { MessageService } from '@theia/core/lib/common/message-service'
import { inject, injectable } from '@theia/core/shared/inversify'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import {
  NativeAgentProvider,
  NativeAgentMessage,
  NativeAgentMessageDetail,
  NativeAgentService,
  NativeAgentSession,
} from '../common/native-agent-protocol'
import './native-agent-chat.css'

export interface NativeAgentChatWidgetOptions {
  instanceId?: string
  provider: NativeAgentProvider
  cwd: string
}

type NativeAgentTimelineItem =
  | { type: 'message'; message: NativeAgentMessage }
  | {
      type: 'assistant-turn'
      id: string
      assistants: NativeAgentMessage[]
      activities: NativeAgentMessage[]
    }

type NativeAgentActivityStatus = 'running' | 'done' | 'fail'

type NativeAgentActivityDisplay = {
  message: NativeAgentMessage
  label: string
  status?: NativeAgentActivityStatus
  rawToolName?: string
}

type NativeAgentChatViewProps = {
  provider: NativeAgentProvider
  cwd: string
  session: NativeAgentSession | undefined
  activityExpanded: boolean
  onActivityExpandedChange: (expanded: boolean) => void
  onCancel: () => void
  onSend: (text: string) => Promise<void>
  onError: (error: unknown) => void
}

type NativeAgentChatViewState = {
  draft: string
  sending: boolean
}

class NativeAgentChatView extends React.Component<
  NativeAgentChatViewProps,
  NativeAgentChatViewState,
  boolean
> {
  override state: NativeAgentChatViewState = {
    draft: '',
    sending: false,
  }

  protected messagesElement: HTMLDivElement | undefined
  protected followChatEnd = true
  protected scrollFrame: number | undefined
  protected autoScrollPending = false
  protected readonly markdown = new MarkdownIt({
    breaks: true,
    html: false,
    linkify: true,
  })

  override componentDidMount(): void {
    this.scrollChatToBottomSoon(true)
  }

  override getSnapshotBeforeUpdate(): boolean {
    return this.shouldFollowChatEnd()
  }

  override componentDidUpdate(
    _prevProps: Readonly<NativeAgentChatViewProps>,
    _prevState: Readonly<NativeAgentChatViewState>,
    shouldFollow: boolean,
  ): void {
    if (shouldFollow) {
      this.scrollChatToBottomSoon(true)
    }
  }

  override render(): React.ReactNode {
    const { cwd, provider, session } = this.props
    const { draft, sending } = this.state
    return (
      <div className="native-agent-chat-shell">
        <div className="native-agent-chat-header">
          <div>
            <div className="native-agent-chat-title">
              {provider === 'codex' ? 'Codex' : 'Claude'} in AROMA
            </div>
            <div className="native-agent-chat-cwd">{cwd}</div>
          </div>
          <div className={`native-agent-chat-status status-${session?.status ?? 'starting'}`}>
            {session?.status ?? 'starting'}
          </div>
        </div>
        <div
          className="native-agent-chat-messages"
          ref={this.setMessagesElement}
          onScroll={this.handleMessagesScroll}
          onWheel={this.handleMessagesWheel}
        >
          {session?.messages.length ? (
            this.buildTimeline(session.messages).map((item) => this.renderTimelineItem(item))
          ) : (
            <div className="native-agent-chat-empty">
              Ask the agent to curate, validate, or explain this RO-Crate.
            </div>
          )}
        </div>
        <form className="native-agent-chat-composer" onSubmit={this.handleSubmit}>
          <textarea
            value={draft}
            placeholder="Ask about this RO-Crate..."
            onChange={this.handleDraftChange}
            onKeyDown={this.handleKeyDown}
            disabled={sending}
          />
          <div className="native-agent-chat-actions">
            <button
              type="button"
              disabled={!session || session.status !== 'running'}
              onClick={this.handleCancel}
            >
              Stop
            </button>
            <button
              type="submit"
              disabled={!draft.trim() || sending || session?.status === 'running'}
            >
              Send
            </button>
          </div>
        </form>
      </div>
    )
  }

  protected buildTimeline(messages: NativeAgentMessage[]): NativeAgentTimelineItem[] {
    const items: NativeAgentTimelineItem[] = []
    let activeAssistantTurn: Extract<NativeAgentTimelineItem, { type: 'assistant-turn' }> | undefined

    for (const message of messages) {
      if (message.role === 'assistant') {
        if (!activeAssistantTurn) {
          activeAssistantTurn = {
            type: 'assistant-turn',
            id: message.id,
            assistants: [],
            activities: [],
          }
          items.push(activeAssistantTurn)
        }
        activeAssistantTurn.assistants.push(message)
        continue
      }

      if ((message.role === 'activity' || message.role === 'error') && activeAssistantTurn) {
        activeAssistantTurn.activities.push(message)
        continue
      }

      activeAssistantTurn = undefined
      items.push({ type: 'message', message })
    }

    return items
  }

  protected renderTimelineItem(item: NativeAgentTimelineItem): React.ReactNode {
    if (item.type === 'message') {
      return this.renderMessage(item.message)
    }
    const streaming = item.assistants.some((message) => message.streaming)
    return (
      <div
        key={item.id}
        className={`native-agent-message role-assistant${streaming ? ' is-streaming' : ''}`}
      >
        <div className="native-agent-message-role">assistant</div>
        {item.assistants.length
          ? item.assistants.map((message) => (
              <div key={message.id} className="native-agent-assistant-part">
                {this.renderMessageBody(message)}
              </div>
            ))
          : this.renderWorkingState()}
        {this.renderActivityTrail(item.activities)}
      </div>
    )
  }

  protected renderMessage(message: NativeAgentMessage): React.ReactNode {
    return (
      <div
        key={message.id}
        className={`native-agent-message role-${message.role}${message.streaming ? ' is-streaming' : ''}`}
      >
        <div className="native-agent-message-role">{message.role}</div>
        {this.renderMessageBody(message)}
      </div>
    )
  }

  protected renderMessageBody(message: NativeAgentMessage): React.ReactNode {
    if (!message.text && message.streaming) {
      return this.renderWorkingState()
    }

    return (
      <div className="native-agent-message-content">
        {this.renderMarkdown(message)}
        {this.renderDetails(message)}
        {message.streaming ? <div className="native-agent-progress" /> : undefined}
      </div>
    )
  }

  protected renderWorkingState(): React.ReactNode {
    return (
      <div className="native-agent-working">
        <span>Working</span>
        <span className="native-agent-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <div className="native-agent-progress" />
      </div>
    )
  }

  protected renderActivityTrail(
    activities: NativeAgentMessage[],
  ): React.ReactNode {
    if (!activities.length) {
      return undefined
    }
    const displayActivities = this.buildActivityDisplay(activities)
    if (!displayActivities.length) {
      return undefined
    }
    const errors = displayActivities.filter(
      (activity) => activity.message.role === 'error' || activity.status === 'fail',
    ).length
    const latest = displayActivities[displayActivities.length - 1]
    return (
      <details
        className="native-agent-activity-trail"
        open={this.props.activityExpanded}
        onToggle={this.handleActivityTrailToggle}
      >
        <summary>
          <span className="native-agent-activity-summary-main">
            <span>Agent activity</span>
            <span className="native-agent-activity-latest">
              {latest.label}
            </span>
          </span>
          <span className="native-agent-activity-count">
            {displayActivities.length}
            {errors ? `, ${errors} error${errors === 1 ? '' : 's'}` : ''}
          </span>
        </summary>
        <div className="native-agent-activity-list">
          {displayActivities.map((activity) => (
            <div
              key={activity.message.id}
              className={`native-agent-activity-row role-${activity.message.role}`}
            >
              <div className="native-agent-activity-title">
                <span>{activity.label}</span>
                {activity.status ? (
                  <span className={`native-agent-activity-status status-${activity.status}`}>
                    {activity.status}
                  </span>
                ) : undefined}
              </div>
              {this.renderDetails(activity.message)}
            </div>
          ))}
        </div>
      </details>
    )
  }

  protected buildActivityDisplay(
    activities: NativeAgentMessage[],
  ): NativeAgentActivityDisplay[] {
    const displayActivities: NativeAgentActivityDisplay[] = []
    const toolRowsByUseId = new Map<string, NativeAgentActivityDisplay>()
    let latestToolRow: NativeAgentActivityDisplay | undefined

    for (const activity of activities) {
      const raw = activity.text.trim()
      const toolMatch = raw.match(/^Tool:\s*(.+)$/)
      if (toolMatch) {
        const rawToolName = toolMatch[1].trim()
        const label = this.formatToolName(rawToolName)
        const toolUseId = this.getToolUseId(activity)
        const display = {
          message: this.withToolIdentityDetails(activity, label, rawToolName),
          label,
          rawToolName,
          status: 'running' as NativeAgentActivityStatus,
        }
        displayActivities.push(display)
        latestToolRow = display
        if (toolUseId) {
          toolRowsByUseId.set(toolUseId, display)
        }
        continue
      }

      const resultMatch = raw.match(/^Tool result(?<failed>\s+failed)?$/)
      if (resultMatch) {
        const result = this.getToolResult(activity)
        const toolRow = (result.toolUseId ? toolRowsByUseId.get(result.toolUseId) : undefined) ?? latestToolRow
        if (toolRow) {
          toolRow.status = result.failed ? 'fail' : 'done'
          toolRow.message = this.mergeActivityDetails(toolRow.message, activity.details)
          continue
        }
        if (!result.failed) {
          continue
        }
      }

      const label = this.formatActivityTitle(activity)
      displayActivities.push({ message: activity, label })
    }

    return displayActivities
  }

  protected withToolIdentityDetails(
    activity: NativeAgentMessage,
    label: string,
    rawToolName: string,
  ): NativeAgentMessage {
    return {
      ...activity,
      details: [
        {
          title: 'Tool',
          text: JSON.stringify({ label, toolName: rawToolName }, null, 2),
          language: 'json',
        },
        ...(activity.details ?? []),
      ],
    }
  }

  protected mergeActivityDetails(
    activity: NativeAgentMessage,
    details: NativeAgentMessageDetail[] | undefined,
  ): NativeAgentMessage {
    if (!details?.length) {
      return activity
    }
    return {
      ...activity,
      details: [...(activity.details ?? []), ...details],
    }
  }

  protected getToolUseId(activity: NativeAgentMessage): string | undefined {
    for (const detail of activity.details ?? []) {
      const value = this.parseDetailJson(detail)
      const toolUseId = value?.toolUseId ?? value?.id
      if (typeof toolUseId === 'string') {
        return toolUseId
      }
    }
    return undefined
  }

  protected getToolResult(activity: NativeAgentMessage): { toolUseId?: string; failed: boolean } {
    let failed = activity.text.includes('failed')
    let toolUseId: string | undefined
    for (const detail of activity.details ?? []) {
      const value = this.parseDetailJson(detail)
      if (typeof value?.toolUseId === 'string') {
        toolUseId = value.toolUseId
      }
      if (typeof value?.isError === 'boolean') {
        failed = value.isError
      } else if (typeof value?.is_error === 'boolean') {
        failed = value.is_error
      }
    }
    return { toolUseId, failed }
  }

  protected parseDetailJson(detail: NativeAgentMessageDetail): any | undefined {
    if (detail.language !== 'json') {
      return undefined
    }
    try {
      return JSON.parse(detail.text)
    } catch {
      return undefined
    }
  }

  protected readonly handleActivityTrailToggle = (
    event: React.SyntheticEvent<HTMLDetailsElement>,
  ): void => {
    if (event.currentTarget !== event.target) {
      return
    }
    this.props.onActivityExpandedChange(event.currentTarget.open)
  }

  protected formatActivityTitle(activity: NativeAgentMessage | undefined): string {
    if (!activity) {
      return ''
    }
    if (activity.role === 'error') {
      return `Error: ${activity.text}`
    }
    const raw = activity.text.trim()
    const toolMatch = raw.match(/^Tool:\s*(.+)$/)
    if (toolMatch) {
      return this.formatToolName(toolMatch[1])
    }
    return raw
  }

  protected formatToolName(rawName: string): string {
    const normalized = rawName
      .trim()
      .replace(/^mcp__/, '')
      .replace(/^mcp_/, '')
      .replace(/^rocrate__/, '')
      .replace(/^rocrate_/, '')
    const known: Record<string, string> = {
      apply_changes: 'Apply RO-Crate changes',
      get_rocrate_context: 'Read RO-Crate context',
      read_crate: 'Read RO-Crate',
      validate_crate: 'Validate RO-Crate',
      write_crate_atomic: 'Write RO-Crate',
      suggest_context_terms: 'Suggest context terms',
      suggest_properties: 'Suggest properties',
      suggest_types: 'Suggest types',
    }
    if (known[normalized]) {
      return known[normalized]
    }
    return normalized
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  }

  protected renderMarkdown(message: NativeAgentMessage): React.ReactNode {
    const html = this.formatRenderedHtml(this.markdown.render(this.formatMessageText(message)))
    return (
      <div
        className="native-agent-markdown"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  protected renderDetails(message: NativeAgentMessage): React.ReactNode {
    if (!message.details?.length) {
      return undefined
    }
    return (
      <div className="native-agent-details">
        {message.details.map((detail, index) => (
          <details key={`${message.id}:detail:${index}`}>
            <summary>{detail.title}</summary>
            <pre className={detail.language ? `language-${detail.language}` : undefined}>
              {detail.text}
            </pre>
          </details>
        ))}
      </div>
    )
  }

  protected formatMessageText(message: NativeAgentMessage): string {
    let text = message.text.replace(/\r\n/g, '\n').trim()
    if (message.role === 'assistant') {
      text = text
        .replace(/([.!?])(?=[A-Z])/g, '$1\n\n')
        .replace(/([^\s])([✓✔])/g, '$1\n\n$2')
        .replace(/([✓✔])\s*/g, '$1 ')
        .replace(/\s+(?=(?:Now|Next|Then|Finally)\b)/g, '\n\n')
    }
    return text
  }

  protected formatRenderedHtml(html: string): string {
    return html
      .replace(/(^|[>\s])(✓|✔)(?=\s|<|$)/g, '$1<span class="native-agent-check">$2</span>')
      .replace(/(^|[>\s])(✗|✘|✕|×)(?=\s|<|$)/g, '$1<span class="native-agent-cross">$2</span>')
  }

  protected readonly handleDraftChange = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
    this.setState({ draft: event.target.value })
  }

  protected readonly setMessagesElement = (element: HTMLDivElement | null): void => {
    this.messagesElement = element ?? undefined
    if (this.messagesElement && this.followChatEnd) {
      this.scrollChatToBottomSoon(true)
    }
  }

  protected readonly handleMessagesScroll = (): void => {
    if (this.autoScrollPending) {
      return
    }
    this.followChatEnd = this.isMessagesScrolledToBottom()
  }

  protected readonly handleMessagesWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    if (event.deltaY < 0) {
      this.autoScrollPending = false
      this.followChatEnd = false
      if (this.scrollFrame !== undefined) {
        window.cancelAnimationFrame(this.scrollFrame)
        this.scrollFrame = undefined
      }
    }
  }

  protected shouldFollowChatEnd(): boolean {
    return this.followChatEnd || this.isMessagesScrolledToBottom()
  }

  protected isMessagesScrolledToBottom(): boolean {
    const element = this.messagesElement
    if (!element) {
      return true
    }
    return element.scrollHeight - element.scrollTop - element.clientHeight <= 24
  }

  protected scrollChatToBottomSoon(force = false): void {
    if (this.scrollFrame !== undefined) {
      window.cancelAnimationFrame(this.scrollFrame)
    }
    this.autoScrollPending = force || this.followChatEnd
    this.scrollFrame = window.requestAnimationFrame(() => {
      this.scrollFrame = undefined
      const shouldScroll = this.autoScrollPending
      this.autoScrollPending = false
      if (shouldScroll && this.messagesElement) {
        this.messagesElement.scrollTop = this.messagesElement.scrollHeight
        this.followChatEnd = true
      }
    })
  }

  protected readonly handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void this.submitDraft()
    }
  }

  protected readonly handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault()
    void this.submitDraft()
  }

  protected readonly handleCancel = (): void => {
    this.props.onCancel()
  }

  protected async submitDraft(): Promise<void> {
    const text = this.state.draft.trim()
    if (!text || !this.props.session || this.state.sending || this.props.session.status === 'running') {
      return
    }
    this.setState({ draft: '', sending: true })
    try {
      await this.props.onSend(text)
    } catch (error) {
      this.props.onError(error)
    } finally {
      this.setState({ sending: false })
    }
  }
}

@injectable()
export class NativeAgentChatWidget extends ReactWidget {
  static readonly ID = 'native-agent-chat-widget'

  @inject(NativeAgentService)
  protected readonly nativeAgentService: NativeAgentService

  @inject(AppStateService)
  protected readonly appStateService: AppStateService

  @inject(MessageService)
  protected readonly messageService: MessageService

  protected session: NativeAgentSession | undefined
  protected provider: NativeAgentProvider = 'codex'
  protected cwd = ''
  protected initialized = false

  initWidget(): void {
    if (this.initialized) {
      return
    }
    this.initialized = true
    this.id = NativeAgentChatWidget.ID
    this.title.label = 'AI Assistant'
    this.title.caption = 'AI Assistant'
    this.title.iconClass = 'fa fa-comments'
    this.title.closable = true
    this.addClass('native-agent-chat')
    this.toDispose.push(
      this.nativeAgentService.onDidChangeSession((event) => {
        if (event.sessionId === this.session?.id) {
          this.session = event.session
          this.updateTitle()
          this.update()
        }
      }),
    )
    this.toDispose.push(
      this.appStateService.onDidChangeSelector(
        (state) => state.nativeAgentActivityExpanded,
      )(() => this.update()),
    )
    void this.appStateService.ready.then(() => this.update())
    this.update()
  }

  async initialize(options: NativeAgentChatWidgetOptions): Promise<void> {
    this.id =
      options.instanceId ??
      `${NativeAgentChatWidget.ID}:${Math.random().toString(36).slice(2)}`
    this.provider = options.provider
    this.cwd = options.cwd
    this.session = await this.nativeAgentService.startSession(options)
    this.updateTitle()
    this.update()
  }

  protected updateTitle(): void {
    const label = `${this.provider === 'codex' ? 'Codex' : 'Claude'} Chat`
    this.title.label = label
    this.title.caption = `${label} - ${this.cwd}`
  }

  protected render(): React.ReactNode {
    return (
      <NativeAgentChatView
        provider={this.provider}
        cwd={this.cwd}
        session={this.session}
        activityExpanded={this.appStateService.nativeAgentActivityExpanded}
        onActivityExpandedChange={this.handleActivityExpandedChange}
        onCancel={this.handleCancel}
        onSend={this.handleSend}
        onError={this.handleError}
      />
    )
  }

  protected readonly handleActivityExpandedChange = (expanded: boolean): void => {
    this.appStateService.nativeAgentActivityExpanded = expanded
  }

  protected readonly handleCancel = (): void => {
    if (this.session) {
      void this.nativeAgentService.cancel(this.session.id)
    }
  }

  protected readonly handleSend = async (text: string): Promise<void> => {
    if (!this.session) {
      return
    }
    this.session = await this.nativeAgentService.sendMessage({
      sessionId: this.session.id,
      text,
      context: {
        selectedEntityId: this.appStateService.selectedEntityId,
        validationErrors: this.appStateService.validationErrors,
      },
    })
  }

  protected readonly handleError = (error: unknown): void => {
    this.messageService.error(error instanceof Error ? error.message : String(error))
  }
}

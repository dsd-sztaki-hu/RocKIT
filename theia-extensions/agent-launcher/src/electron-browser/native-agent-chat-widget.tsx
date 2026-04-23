import * as React from 'react'
import MarkdownIt = require('markdown-it')
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { MessageService } from '@theia/core/lib/common/message-service'
import { inject, injectable } from '@theia/core/shared/inversify'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import {
  NativeAgentProvider,
  NativeAgentMessage,
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
  protected draft = ''
  protected sending = false
  protected initialized = false
  protected readonly markdown = new MarkdownIt({
    breaks: true,
    html: false,
    linkify: true,
  })

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
    const session = this.session
    return (
      <div className="native-agent-chat-shell">
        <div className="native-agent-chat-header">
          <div>
            <div className="native-agent-chat-title">
              {this.provider === 'codex' ? 'Codex' : 'Claude'} in AROMA
            </div>
            <div className="native-agent-chat-cwd">{this.cwd}</div>
          </div>
          <div className={`native-agent-chat-status status-${session?.status ?? 'starting'}`}>
            {session?.status ?? 'starting'}
          </div>
        </div>
        <div className="native-agent-chat-messages">
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
            value={this.draft}
            placeholder="Ask about this RO-Crate..."
            onChange={this.handleDraftChange}
            onKeyDown={this.handleKeyDown}
            disabled={this.sending}
          />
          <div className="native-agent-chat-actions">
            <button
              type="button"
              disabled={!session || session.status !== 'running'}
              onClick={this.handleCancel}
            >
              Stop
            </button>
            <button type="submit" disabled={!this.draft.trim() || this.sending}>
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
        {this.renderActivityTrail(item.activities, streaming)}
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
    openByDefault: boolean,
  ): React.ReactNode {
    if (!activities.length) {
      return undefined
    }
    const errors = activities.filter((message) => message.role === 'error').length
    return (
      <details className="native-agent-activity-trail" open={openByDefault}>
        <summary>
          <span>Agent activity</span>
          <span className="native-agent-activity-count">
            {activities.length}
            {errors ? `, ${errors} error${errors === 1 ? '' : 's'}` : ''}
          </span>
        </summary>
        <div className="native-agent-activity-list">
          {activities.map((activity) => (
            <div
              key={activity.id}
              className={`native-agent-activity-row role-${activity.role}`}
            >
              <div className="native-agent-activity-title">{activity.text}</div>
              {this.renderDetails(activity)}
            </div>
          ))}
        </div>
      </details>
    )
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
    this.draft = event.target.value
    this.update()
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
    if (this.session) {
      void this.nativeAgentService.cancel(this.session.id)
    }
  }

  protected async submitDraft(): Promise<void> {
    const text = this.draft.trim()
    if (!text || !this.session || this.sending) {
      return
    }
    this.draft = ''
    this.sending = true
    this.update()
    try {
      this.session = await this.nativeAgentService.sendMessage({
        sessionId: this.session.id,
        text,
        context: {
          selectedEntityId: this.appStateService.selectedEntityId,
          validationErrors: this.appStateService.validationErrors,
        },
      })
    } catch (error) {
      this.messageService.error(error instanceof Error ? error.message : String(error))
    } finally {
      this.sending = false
      this.update()
    }
  }
}

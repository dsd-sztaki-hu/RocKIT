import * as React from 'react'
import MarkdownIt = require('markdown-it')
import { ApplicationShell, OpenerService, Widget, WidgetManager, open } from '@theia/core/lib/browser'
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs'
import { WebSocketConnectionSource } from '@theia/core/lib/browser/messaging/ws-connection-source'
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service'
import { QuickInputButton, QuickInputService, QuickPickItem } from '@theia/core/lib/browser/quick-input'
import { FileUri } from '@theia/core/lib/common/file-uri'
import { MessageService } from '@theia/core/lib/common/message-service'
import { nls } from '@theia/core/lib/common/nls'
import URI from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { writeUtf8TextFile } from 'rockit-common/lib/browser'
import { inject, injectable, optional } from '@theia/core/shared/inversify'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateEditorWidget } from 'ro-crate-editor/lib/browser/ro-crate-editor-widget'
import {
  NativeAgentProvider,
  NativeChatSessionIndex,
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

type DataverseUploadReplacementCandidate = {
  key: string
  pendingId: string
  tempPath: string
  cratePath?: string
  pid?: string
  dataverseUrl?: string
}

type NativeAgentChatViewProps = {
  provider: NativeAgentProvider
  cwd: string
  session: NativeAgentSession | undefined
  entityIds: string[]
  activityExpanded: boolean
  onActivityExpandedChange: (expanded: boolean) => void
  onSelectEntity: (entityId: string) => void
  onOpenLink: (href: string) => void
  onCopyChat: () => void
  onShowHistory: () => void
  onSearchPromptHistory: () => Promise<string | undefined>
  onCancel: () => void
  onSend: (text: string) => Promise<void>
  onError: (error: unknown) => void
  promptHistory: string[]
}

type NativeAgentChatViewState = {
  draft: string
  sending: boolean
}

type NativeChatHistoryPick = QuickPickItem & (
  | {
      kind: 'clear-all'
      sessions: NativeChatSessionIndex[]
    }
  | {
      kind: 'session'
      session: NativeChatSessionIndex
    }
)

function localizeNativeAgentServiceMessage(message: string): string {
  const normalized = message.trim()
  const exact: Record<string, string> = {
    'Cannot send to a closed Claude session.': nls.localize(
      'rockit/agentChat/closedClaudeSession',
      'Cannot send to a closed Claude session.',
    ),
    'Codex executable not found in PATH.': nls.localize(
      'rockit/agentChat/codexExecutableNotFound',
      'Codex executable not found in PATH.',
    ),
    'Codex app-server did not return a thread id.': nls.localize(
      'rockit/agentChat/codexThreadIdMissing',
      'Codex app-server did not return a thread id.',
    ),
    'Claude is still working on the previous message.': nls.localize(
      'rockit/agentChat/claudeStillWorking',
      'Claude is still working on the previous message.',
    ),
    'The native agent is still working on the previous message.': nls.localize(
      'rockit/agentChat/agentStillWorking',
      'The native agent is still working on the previous message.',
    ),
    'Stopped.': nls.localize('rockit/agentChat/stopped', 'Stopped.'),
    'Codex runtime error': nls.localize(
      'rockit/agentChat/codexRuntimeError',
      'Codex runtime error',
    ),
    'Claude turn failed.': nls.localize(
      'rockit/agentChat/claudeTurnFailed',
      'Claude turn failed.',
    ),
    'JSON-RPC process disposed': nls.localize(
      'rockit/agentChat/jsonRpcDisposed',
      'JSON-RPC process was disposed.',
    ),
  }
  if (exact[normalized]) {
    return exact[normalized]
  }

  const unknownSession = normalized.match(/^Unknown native agent session: (.+)$/)
  if (unknownSession) {
    return nls.localize(
      'rockit/agentChat/unknownSession',
      'Unknown native agent session: {0}',
      unknownSession[1],
    )
  }

  const codexExit = normalized.match(
    /^Codex app-server exited \(code=(.+), signal=(.+)\)\.$/,
  )
  if (codexExit) {
    return nls.localize(
      'rockit/agentChat/codexAppServerExited',
      'Codex app-server exited (code={0}, signal={1}).',
      codexExit[1],
      codexExit[2],
    )
  }

  const jsonRpcExit = normalized.match(
    /^JSON-RPC process exited \(code=(.+), signal=(.+)\)$/,
  )
  if (jsonRpcExit) {
    return nls.localize(
      'rockit/agentChat/jsonRpcExited',
      'JSON-RPC process exited (code={0}, signal={1}).',
      jsonRpcExit[1],
      jsonRpcExit[2],
    )
  }

  return message
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
  protected promptHistoryIndex: number | undefined
  protected draftBeforeHistory = ''
  protected readonly markdown = this.createMarkdownRenderer()

  protected createMarkdownRenderer(): MarkdownIt {
    const markdown = new MarkdownIt({
      breaks: true,
      html: false,
      linkify: true,
    })
    const defaultLinkOpen =
      markdown.renderer.rules.link_open ??
      ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
    markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
      const token = tokens[idx]
      token.attrSet('target', '_blank')
      token.attrSet('rel', 'noopener noreferrer')
      return defaultLinkOpen(tokens, idx, options, env, self)
    }
    return markdown
  }

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
    const workspaceLabel = this.getWorkspaceLabel(cwd)
    const providerLabel = provider === 'codex' ? 'Codex' : 'Claude'
    const timeline = session ? this.buildTimeline(session.messages) : []
    return (
      <div className="native-agent-chat-shell">
        <div className="native-agent-chat-header">
          <div className="native-agent-chat-header-main">
            <div className={`native-agent-provider-icon provider-${provider}`} aria-hidden="true">
              {this.renderProviderIcon(provider)}
            </div>
            <div className="native-agent-chat-title-group">
              <div className="native-agent-chat-title">{workspaceLabel}</div>
              <div className="native-agent-chat-cwd">
                {nls.localize(
                  'rockit/agentChat/providerSession',
                  '{0} session',
                  providerLabel,
                )}
              </div>
            </div>
          </div>
          <div className="native-agent-chat-header-actions">
            <button
              type="button"
              className="native-agent-copy-chat"
              title={nls.localize(
                'rockit/agentChat/showPreviousChats',
                'Show previous chats',
              )}
              onClick={this.handleShowHistory}
            >
              {nls.localize('rockit/agentChat/history', 'History')}
            </button>
            <button
              type="button"
              className="native-agent-copy-chat"
              title={nls.localize(
                'rockit/agentChat/copyTranscript',
                'Copy full chat transcript',
              )}
              disabled={!session?.messages.length}
              onClick={this.handleCopyChat}
            >
              {nls.localize('rockit/agentChat/copy', 'Copy')}
            </button>
            <div className={`native-agent-chat-status status-${session?.status ?? 'starting'}`}>
              {this.localizeSessionStatus(session?.status ?? 'starting')}
            </div>
          </div>
        </div>
        <div
          className="native-agent-chat-messages"
          ref={this.setMessagesElement}
          onScroll={this.handleMessagesScroll}
          onWheel={this.handleMessagesWheel}
        >
          {timeline.length ? (
            timeline.map((item) => this.renderTimelineItem(item))
          ) : (
            <div className="native-agent-chat-empty">
              {nls.localize(
                'rockit/agentChat/emptyPrompt',
                'Ask the agent to curate, validate, or explain this RO-Crate.',
              )}
            </div>
          )}
        </div>
        <form className="native-agent-chat-composer" onSubmit={this.handleSubmit}>
          <textarea
            value={draft}
            placeholder={nls.localize(
              'rockit/agentChat/promptPlaceholder',
              'Ask about this RO-Crate...',
            )}
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
              {nls.localize('rockit/agentChat/stop', 'Stop')}
            </button>
            <button
              type="submit"
              disabled={!draft.trim() || sending || session?.status === 'running'}
            >
              {nls.localize('rockit/agentChat/send', 'Send')}
            </button>
          </div>
        </form>
      </div>
    )
  }

  protected localizeSessionStatus(status: string): string {
    const labels: Record<string, string> = {
      starting: nls.localize('rockit/agentChat/statusStarting', 'starting'),
      ready: nls.localize('rockit/agentChat/statusReady', 'ready'),
      running: nls.localize('rockit/agentChat/statusRunning', 'running'),
      error: nls.localize('rockit/agentChat/statusError', 'error'),
      closed: nls.localize('rockit/agentChat/statusClosed', 'closed'),
    }
    return labels[status] ?? status
  }

  protected localizeMessageRole(role: string): string {
    const labels: Record<string, string> = {
      user: nls.localize('rockit/agentChat/roleUser', 'user'),
      assistant: nls.localize('rockit/agentChat/roleAssistant', 'assistant'),
      activity: nls.localize('rockit/agentChat/roleActivity', 'activity'),
      error: nls.localize('rockit/agentChat/roleError', 'error'),
    }
    return labels[role] ?? role
  }

  protected localizeActivityStatus(status: NativeAgentActivityStatus): string {
    const labels: Record<NativeAgentActivityStatus, string> = {
      running: nls.localize('rockit/agentChat/activityRunning', 'running'),
      done: nls.localize('rockit/agentChat/activityDone', 'done'),
      fail: nls.localize('rockit/agentChat/activityFailed', 'failed'),
    }
    return labels[status]
  }

  protected buildTimeline(messages: NativeAgentMessage[]): NativeAgentTimelineItem[] {
    const items: NativeAgentTimelineItem[] = []
    let activeAssistantTurn: Extract<NativeAgentTimelineItem, { type: 'assistant-turn' }> | undefined

    for (const message of messages) {
      if (message.role === 'system') {
        continue
      }
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
        <div className="native-agent-message-role">
          {this.localizeMessageRole('assistant')}
        </div>
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
        <div className="native-agent-message-role">
          {this.localizeMessageRole(message.role)}
        </div>
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
        <span>{nls.localize('rockit/agentChat/working', 'Working')}</span>
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
            <span>{nls.localize('rockit/agentChat/activity', 'Agent activity')}</span>
            <span className="native-agent-activity-latest">
              {latest.label}
            </span>
          </span>
          <span className="native-agent-activity-count">
            {displayActivities.length}
            {errors
              ? nls.localize('rockit/agentChat/errorCount', ', {0} errors', errors)
              : ''}
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
                    {this.localizeActivityStatus(activity.status)}
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
        const status = this.getToolActivityStatus(activity) ?? 'running'
        const display = {
          message: this.withToolIdentityDetails(activity, label, rawToolName),
          label,
          rawToolName,
          status,
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
        if (result.toolName) {
          const label = this.formatToolName(result.toolName)
          displayActivities.push({
            message: this.withToolIdentityDetails(activity, label, result.toolName),
            label,
            rawToolName: result.toolName,
            status: result.failed ? 'fail' : 'done',
          })
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
          title: nls.localize('rockit/agentChat/tool', 'Tool'),
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

  protected getToolResult(activity: NativeAgentMessage): {
    toolName?: string
    toolUseId?: string
    failed: boolean
  } {
    let failed = activity.text.includes('failed')
    let toolName: string | undefined
    let toolUseId: string | undefined
    for (const detail of activity.details ?? []) {
      const value = this.parseDetailJson(detail)
      if (typeof value?.toolName === 'string') {
        toolName = value.toolName
      }
      if (typeof value?.toolUseId === 'string') {
        toolUseId = value.toolUseId
      }
      if (typeof value?.isError === 'boolean') {
        failed = value.isError
      } else if (typeof value?.is_error === 'boolean') {
        failed = value.is_error
      }
    }
    return { toolName, toolUseId, failed }
  }

  protected getToolActivityStatus(
    activity: NativeAgentMessage,
  ): NativeAgentActivityStatus | undefined {
    for (const detail of activity.details ?? []) {
      const value = this.parseDetailJson(detail)
      const status = String(value?.status ?? value?.result?.status ?? '').toLowerCase()
      if (status === 'completed' || status === 'success' || status === 'succeeded') {
        return 'done'
      }
      if (status === 'failed' || status === 'error' || status === 'cancelled') {
        return 'fail'
      }
      if (status === 'running' || status === 'in_progress') {
        return 'running'
      }
    }
    return undefined
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
      return nls.localize(
        'rockit/agentChat/errorWithMessage',
        'Error: {0}',
        localizeNativeAgentServiceMessage(activity.text),
      )
    }
    const raw = activity.text.trim()
    const toolMatch = raw.match(/^Tool:\s*(.+)$/)
    if (toolMatch) {
      return this.formatToolName(toolMatch[1])
    }
    const commandMatch = raw.match(/^Command:\s*(.+)$/)
    if (commandMatch) {
      return nls.localize(
        'rockit/agentChat/commandWithName',
        'Command: {0}',
        commandMatch[1],
      )
    }
    const known: Record<string, string> = {
      'Codex runtime output': nls.localize(
        'rockit/agentChat/codexRuntimeOutput',
        'Codex runtime output',
      ),
      'Claude runtime output': nls.localize(
        'rockit/agentChat/claudeRuntimeOutput',
        'Claude runtime output',
      ),
      'Codex run stopped': nls.localize(
        'rockit/agentChat/codexRunStopped',
        'Codex run stopped',
      ),
      'Command output': nls.localize(
        'rockit/agentChat/commandOutput',
        'Command output',
      ),
      'Tool result': nls.localize('rockit/agentChat/toolResult', 'Tool result'),
      'Tool result failed': nls.localize(
        'rockit/agentChat/toolResultFailed',
        'Tool result failed',
      ),
      'Claude session initialized': nls.localize(
        'rockit/agentChat/claudeSessionInitialized',
        'Claude session initialized',
      ),
      'Claude run summary': nls.localize(
        'rockit/agentChat/claudeRunSummary',
        'Claude run summary',
      ),
    }
    if (known[raw]) {
      return known[raw]
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
      apply_changes: nls.localize('rockit/agentChat/toolApplyChanges', 'Apply RO-Crate changes'),
      get_rocrate_context: nls.localize('rockit/agentChat/toolReadContext', 'Read RO-Crate context'),
      download_url: nls.localize('rockit/agentChat/toolDownloadUrl', 'Download source URL'),
      read_crate: nls.localize('rockit/agentChat/toolReadCrate', 'Read RO-Crate'),
      search: nls.localize('rockit/agentChat/toolSearch', 'Search web evidence'),
      validate_crate: nls.localize('rockit/agentChat/toolValidate', 'Validate RO-Crate'),
      write_crate_atomic: nls.localize('rockit/agentChat/toolWrite', 'Write RO-Crate'),
      suggest_context_terms: nls.localize('rockit/agentChat/toolSuggestContext', 'Suggest context terms'),
      suggest_properties: nls.localize('rockit/agentChat/toolSuggestProperties', 'Suggest properties'),
      suggest_types: nls.localize('rockit/agentChat/toolSuggestTypes', 'Suggest types'),
      upload_rocrate_to_dataverse: nls.localize('rockit/agentChat/toolUploadDataverse', 'Upload RO-Crate to Dataverse'),
      adopt_pending_dataverse_rocrate: nls.localize('rockit/agentChat/toolUseDataverse', 'Use Dataverse-updated RO-Crate'),
      update_profile_conforms_to: nls.localize('rockit/agentChat/toolUpdateProfile', 'Update RO-Crate profile'),
      set_agent_session_context: nls.localize('rockit/agentChat/toolSetSessionContext', 'Set Agent Session Context'),
      read_agent_workflow_doc: nls.localize('rockit/agentChat/toolReadWorkflowDoc', 'Read Agent Workflow Doc'),
      open_aroma_for_local_file: nls.localize('rockit/agentChat/toolOpenLocalFile', 'Open Local File in AROMA'),
      list_well_known_schemas: nls.localize('rockit/agentChat/toolListKnownSchemas', 'List Well-Known Schemas'),
      list_remote_schema_tree: nls.localize('rockit/agentChat/toolListRemoteSchemas', 'List Remote Schema Tree'),
      import_well_known_schema: nls.localize('rockit/agentChat/toolImportKnownSchema', 'Import Well-Known Schema'),
      list_metadata_profiles: nls.localize('rockit/agentChat/toolListProfiles', 'List Metadata Profiles'),
      import_metadata_profile: nls.localize('rockit/agentChat/toolImportProfile', 'Import Metadata Profile'),
      delete_metadata_profile: nls.localize('rockit/agentChat/toolDeleteProfile', 'Delete Metadata Profile'),
      download_rocrate_from_dataverse: nls.localize('rockit/agentChat/toolDownloadDataverse', 'Download RO-Crate from Dataverse'),
      create_default_rocrate: nls.localize('rockit/agentChat/toolCreateDefaultCrate', 'Create Default RO-Crate'),
      list_schema_registry: nls.localize('rockit/agentChat/toolListSchemaRegistry', 'List Schema Registry'),
      register_schema: nls.localize('rockit/agentChat/toolRegisterSchema', 'Register Schema'),
      list_types: nls.localize('rockit/agentChat/toolListTypes', 'List Types'),
      get_type_details: nls.localize('rockit/agentChat/toolGetTypeDetails', 'Get Type Details'),
      list_properties_for_type: nls.localize('rockit/agentChat/toolListProperties', 'List Properties for Type'),
      get_property_details: nls.localize('rockit/agentChat/toolGetPropertyDetails', 'Get Property Details'),
      resolve_profile_schema: nls.localize('rockit/agentChat/toolResolveProfileSchema', 'Resolve Profile Schema'),
      prepare_remote_profile_payload: nls.localize('rockit/agentChat/toolPrepareProfilePayload', 'Prepare Remote Profile Payload'),
      create_profile_context: nls.localize('rockit/agentChat/toolCreateProfileContext', 'Create Profile Context'),
      get_profile_context_info: nls.localize('rockit/agentChat/toolGetProfileContext', 'Get Profile Context Info'),
      delete_profile_context: nls.localize('rockit/agentChat/toolDeleteProfileContext', 'Delete Profile Context'),
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
        onClick={this.handleMarkdownClick}
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
            <summary>{this.localizeDetailTitle(detail.title)}</summary>
            <pre className={detail.language ? `language-${detail.language}` : undefined}>
              {detail.text}
            </pre>
          </details>
        ))}
      </div>
    )
  }

  protected localizeDetailTitle(title: string): string {
    const known: Record<string, string> = {
      tool: nls.localize('rockit/agentChat/tool', 'Tool'),
      'tool output': nls.localize('rockit/agentChat/toolOutput', 'Tool output'),
      'tool call': nls.localize('rockit/agentChat/toolCall', 'Tool call'),
      'tool input': nls.localize('rockit/agentChat/toolInput', 'Tool input'),
      'command details': nls.localize(
        'rockit/agentChat/commandDetails',
        'Command details',
      ),
      'cancel details': nls.localize(
        'rockit/agentChat/cancelDetails',
        'Cancel details',
      ),
      output: nls.localize('rockit/agentChat/output', 'Output'),
      stderr: nls.localize('rockit/agentChat/stderr', 'stderr'),
      'session details': nls.localize(
        'rockit/agentChat/sessionDetails',
        'Session details',
      ),
      'run details': nls.localize('rockit/agentChat/runDetails', 'Run details'),
    }
    return known[title.trim().toLowerCase()] ?? title
  }

  protected formatMessageText(message: NativeAgentMessage): string {
    let text = message.text.replace(/\r\n/g, '\n').trim()
    if (message.role === 'activity') {
      return this.formatActivityTitle(message)
    }
    if (message.role === 'error' || text === 'Stopped.') {
      text = localizeNativeAgentServiceMessage(text)
    }
    if (message.role === 'assistant') {
      text = this.protectMarkdownTables(
        text.replace(/([^\n])(\s*)(\|[^\n]*\|\s*\n\|[-:\s|]+\|)/g, '$1\n\n$3'),
      )
    }
    return text
  }

  protected protectMarkdownTables(text: string): string {
    return text
      .split('\n')
      .map((line) => (this.isMarkdownTableLine(line) ? line : this.formatAssistantProse(line)))
      .join('\n')
  }

  protected isMarkdownTableLine(line: string): boolean {
    return /^\s*\|.*\|\s*$/.test(line) || /^\s*\|[-:\s|]+\|\s*$/.test(line)
  }

  protected formatAssistantProse(text: string): string {
    return text
      .replace(/([^\s])(\s*)(📖\s*STEP\s+\d+:)/g, '$1\n\n$3')
      .replace(/([.!?])(?=[A-Z])/g, '$1\n\n')
      .replace(/([^\s])([✓✔])/g, '$1\n\n$2')
      .replace(/([✓✔])\s*/g, '$1 ')
      .replace(/\s+(?=(?:Now|Next|Then|Finally)\b)/g, '\n\n')
  }

  protected formatRenderedHtml(html: string): string {
    const marked = html
      .replace(/(^|[>\s])(✓|✔)(?=\s|<|$)/g, '$1<span class="native-agent-check">$2</span>')
      .replace(/(^|[>\s])(✗|✘|✕|×)(?=\s|<|$)/g, '$1<span class="native-agent-cross">$2</span>')
    return this.linkEntityReferences(this.linkPlainUrls(marked))
  }

  protected linkPlainUrls(html: string): string {
    const template = document.createElement('template')
    template.innerHTML = html
    this.linkPlainUrlsInNode(template.content)
    return template.innerHTML
  }

  protected linkPlainUrlsInNode(node: Node): void {
    const children = Array.from(node.childNodes)
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        this.replaceUrlTextNode(child as Text)
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue
      }
      const element = child as Element
      if (element.closest('a, pre')) {
        continue
      }
      this.linkPlainUrlsInNode(element)
    }
  }

  protected replaceUrlTextNode(textNode: Text): void {
    const text = textNode.nodeValue ?? ''
    const urlPattern = /\bhttps?:\/\/[^\s<>"'`]+/gi
    const fragment = document.createDocumentFragment()
    let offset = 0
    let linked = false

    for (const match of text.matchAll(urlPattern)) {
      const rawUrl = match[0]
      const index = match.index ?? 0
      if (index > offset) {
        fragment.appendChild(document.createTextNode(text.slice(offset, index)))
      }

      const { href, suffix } = this.splitTrailingUrlPunctuation(rawUrl)
      if (href) {
        const link = document.createElement('a')
        link.href = href
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.textContent = href
        fragment.appendChild(link)
        linked = true
      }
      if (suffix) {
        fragment.appendChild(document.createTextNode(suffix))
      }
      offset = index + rawUrl.length
    }

    if (!linked) {
      return
    }
    if (offset < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(offset)))
    }
    textNode.replaceWith(fragment)
  }

  protected splitTrailingUrlPunctuation(url: string): { href: string; suffix: string } {
    let href = url
    let suffix = ''
    while (/[.,;:)\]}]$/.test(href)) {
      suffix = href[href.length - 1] + suffix
      href = href.slice(0, -1)
    }
    return { href, suffix }
  }

  protected linkEntityReferences(html: string): string {
    if (!this.props.entityIds.length) {
      return html
    }
    const template = document.createElement('template')
    template.innerHTML = html
    const sortedEntityIds = [...this.props.entityIds].sort((a, b) => b.length - a.length)
    this.linkEntityReferencesInNode(template.content, sortedEntityIds)
    return template.innerHTML
  }

  protected linkEntityReferencesInNode(node: Node, entityIds: string[]): void {
    const children = Array.from(node.childNodes)
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        this.replaceEntityTextNode(child as Text, entityIds)
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue
      }
      const element = child as Element
      if (element.closest('a')) {
        continue
      }
      this.linkEntityReferencesInNode(element, entityIds)
    }
  }

  protected replaceEntityTextNode(textNode: Text, entityIds: string[]): void {
    const text = textNode.nodeValue ?? ''
    const fragment = document.createDocumentFragment()
    let offset = 0
    let linked = false

    while (offset < text.length) {
      const match = this.findNextEntityReference(text, offset, entityIds)
      if (!match) {
        break
      }
      if (match.index > offset) {
        fragment.appendChild(document.createTextNode(text.slice(offset, match.index)))
      }
      const link = document.createElement('a')
      link.href = '#'
      link.className = 'native-agent-entity-link'
      link.dataset.rocrateEntityId = match.entityId
      link.textContent = match.entityId
      fragment.appendChild(link)
      offset = match.index + match.entityId.length
      linked = true
    }

    if (!linked) {
      return
    }
    if (offset < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(offset)))
    }
    textNode.replaceWith(fragment)
  }

  protected findNextEntityReference(
    text: string,
    offset: number,
    entityIds: string[],
  ): { entityId: string; index: number } | undefined {
    let best: { entityId: string; index: number } | undefined
    for (const entityId of entityIds) {
      const index = text.indexOf(entityId, offset)
      if (index < 0) {
        continue
      }
      if (entityId.length <= 2 && text.trim() !== entityId) {
        continue
      }
      if (!best || index < best.index || (index === best.index && entityId.length > best.entityId.length)) {
        best = { entityId, index }
      }
    }
    return best
  }

  protected readonly handleMarkdownClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented) {
      return
    }
    const target = event.target as HTMLElement | null
    const link = target?.closest<HTMLAnchorElement>('a')
    if (!link) {
      return
    }
    const entityId = link.dataset.rocrateEntityId
    if (entityId) {
      event.preventDefault()
      event.stopPropagation()
      this.props.onSelectEntity(entityId)
      return
    }
    const href = link.getAttribute('href')?.trim()
    if (!href || !this.isExternalLink(href)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    this.props.onOpenLink(href)
  }

  protected isExternalLink(href: string): boolean {
    return /^(https?:|mailto:)/i.test(href)
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
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r') {
      event.preventDefault()
      void this.searchPromptHistory()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void this.submitDraft()
      return
    }
    if (event.key === 'ArrowUp' && this.shouldNavigatePromptHistory(event.currentTarget, 'previous')) {
      event.preventDefault()
      this.navigatePromptHistory('previous')
      return
    }
    if (event.key === 'ArrowDown' && this.shouldNavigatePromptHistory(event.currentTarget, 'next')) {
      event.preventDefault()
      this.navigatePromptHistory('next')
    }
  }

  protected shouldNavigatePromptHistory(
    textarea: HTMLTextAreaElement,
    direction: 'previous' | 'next',
  ): boolean {
    if (!this.props.promptHistory.length) {
      return false
    }
    if (!this.state.draft.trim()) {
      return true
    }
    const cursor = textarea.selectionStart
    if (textarea.selectionStart !== textarea.selectionEnd) {
      return false
    }
    if (direction === 'previous') {
      return !textarea.value.slice(0, cursor).includes('\n')
    }
    return !textarea.value.slice(cursor).includes('\n')
  }

  protected navigatePromptHistory(direction: 'previous' | 'next'): void {
    const history = this.props.promptHistory
    if (!history.length) {
      return
    }
    if (this.promptHistoryIndex === undefined) {
      this.draftBeforeHistory = this.state.draft
      if (direction === 'next') {
        return
      }
      this.promptHistoryIndex = 0
      this.setState({ draft: history[0] })
      return
    }
    const nextIndex = direction === 'previous'
      ? Math.min(this.promptHistoryIndex + 1, history.length - 1)
      : this.promptHistoryIndex - 1
    if (nextIndex < 0) {
      this.promptHistoryIndex = undefined
      this.setState({ draft: this.draftBeforeHistory })
      return
    }
    this.promptHistoryIndex = nextIndex
    this.setState({ draft: history[nextIndex] })
  }

  protected readonly handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault()
    void this.submitDraft()
  }

  protected readonly handleCancel = (): void => {
    this.props.onCancel()
  }

  protected readonly handleCopyChat = (): void => {
    this.props.onCopyChat()
  }

  protected readonly handleShowHistory = (): void => {
    this.props.onShowHistory()
  }

  protected async searchPromptHistory(): Promise<void> {
    const selected = await this.props.onSearchPromptHistory()
    if (selected !== undefined) {
      this.promptHistoryIndex = undefined
      this.draftBeforeHistory = ''
      this.setState({ draft: selected })
    }
  }

  protected getWorkspaceLabel(cwd: string): string {
    const segments = cwd.split(/[\\/]/).filter(Boolean)
    return segments[segments.length - 1] ?? cwd
  }

  protected renderProviderIcon(provider: NativeAgentProvider): React.ReactNode {
    if (provider === 'claude') {
      return (
        <svg viewBox="0 0 16 16" className="native-agent-provider-icon-svg">
          <path
            d="M6.96 15.2L7.184 14.208L7.44 12.928L7.648 11.904L7.84 10.64L7.952 10.224L7.936 10.192L7.856 10.208L6.896 11.52L5.44 13.488L4.288 14.704L4.016 14.816L3.536 14.576L3.584 14.128L3.856 13.744L5.44 11.712L6.4 10.448L7.024 9.728L7.008 9.632H6.976L2.752 12.384L2 12.48L1.664 12.176L1.712 11.68L1.872 11.52L3.136 10.64L6.288 8.88L6.336 8.72L6.288 8.64H6.128L5.6 8.608L3.808 8.56L2.256 8.496L0.736 8.416L0.352 8.336L0 7.856L0.032 7.616L0.352 7.408L0.816 7.44L1.824 7.52L3.344 7.616L4.448 7.68L6.08 7.856H6.336L6.368 7.744L6.288 7.68L6.224 7.616L4.64 6.56L2.944 5.44L2.048 4.784L1.568 4.448L1.328 4.144L1.232 3.472L1.664 2.992L2.256 3.04L2.4 3.072L2.992 3.536L4.256 4.512L5.92 5.744L6.16 5.936L6.272 5.872V5.824L6.16 5.648L5.264 4.016L4.304 2.352L3.872 1.664L3.76 1.248C3.7176 1.104 3.696 0.944 3.696 0.768L4.192 0.096L4.464 0L5.136 0.096L5.408 0.336L5.824 1.28L6.48 2.768L7.52 4.784L7.824 5.392L7.984 5.936L8.048 6.112H8.16V6.016L8.24 4.864L8.4 3.472L8.56 1.68L8.608 1.168L8.864 0.56L9.36 0.24L9.744 0.416L10.064 0.88L10.016 1.168L9.84 2.4L9.456 4.336L9.216 5.648H9.36L9.52 5.472L10.176 4.608L11.28 3.232L11.76 2.688L12.336 2.08L12.704 1.792H13.392L13.888 2.544L13.664 3.328L12.96 4.224L12.368 4.976L11.52 6.112L11.008 7.024L11.056 7.088H11.168L13.072 6.672L14.112 6.496L15.328 6.288L15.888 6.544L15.952 6.8L15.728 7.344L14.416 7.664L12.88 7.968L10.592 8.512L10.56 8.528L10.592 8.576L11.616 8.672L12.064 8.704H13.152L15.168 8.848L15.696 9.2L16 9.616L15.952 9.952L15.136 10.352L14.048 10.096L11.488 9.488L10.624 9.28H10.496V9.344L11.232 10.064L12.56 11.264L14.24 12.816L14.32 13.2L14.112 13.52L13.888 13.488L12.416 12.368L11.84 11.872L10.56 10.8H10.48V10.912L10.768 11.344L12.336 13.696L12.416 14.416L12.304 14.64L11.888 14.784L11.456 14.704L10.528 13.424L9.584 11.968L8.816 10.672L8.736 10.736L8.272 15.568L8.064 15.808L7.584 16L7.184 15.696L6.96 15.2Z"
            fill="currentColor"
          />
        </svg>
      )
    }
    return (
      <svg viewBox="0 0 16 16" className="native-agent-provider-icon-svg">
        <path
          d="M6.13671 5.82399V4.30398C6.13671 4.17596 6.18431 4.07991 6.29527 4.01598L9.32406 2.256C9.73637 2.01602 10.228 1.90406 10.7353 1.90406C12.6382 1.90406 13.8434 3.3921 13.8434 4.97604C13.8434 5.088 13.8434 5.21602 13.8274 5.34404L10.6877 3.488C10.4975 3.37605 10.3071 3.37605 10.1168 3.488L6.13671 5.82399ZM13.209 11.7441V8.11195C13.209 7.88789 13.1138 7.72791 12.9236 7.61594L8.94344 5.27995L10.2437 4.5279C10.3547 4.46397 10.4499 4.46397 10.5609 4.5279L13.5896 6.28789C14.4619 6.79996 15.0484 7.88789 15.0484 8.94385C15.0484 10.1598 14.335 11.28 13.209 11.7441ZM5.20114 8.54404L3.90086 7.77608C3.78989 7.71215 3.7423 7.6161 3.7423 7.48808V3.96811C3.7423 2.25615 5.04259 0.960061 6.80278 0.960061C7.46883 0.960061 8.08714 1.18413 8.61056 1.58409L5.48672 3.40816C5.29649 3.52012 5.20129 3.68011 5.20129 3.90418L5.20114 8.54404ZM7.99999 10.176L6.13671 9.12005V6.8801L7.99999 5.82414L9.8631 6.8801V9.12005L7.99999 10.176ZM9.19719 15.0401C8.53113 15.0401 7.91282 14.816 7.3894 14.4161L10.5132 12.5919C10.7034 12.48 10.7987 12.3201 10.7987 12.096V7.45596L12.1149 8.22392C12.2258 8.28785 12.2734 8.3839 12.2734 8.51192V12.0319C12.2734 13.7438 10.9572 15.0401 9.19719 15.0401ZM5.43898 11.4721L2.41018 9.71211C1.53796 9.20003 0.95134 8.11211 0.95134 7.05615C0.95134 5.82414 1.68077 4.72016 2.80657 4.25611V7.9041C2.80657 8.12817 2.90177 8.28815 3.092 8.40012L7.05637 10.72L5.75609 11.4721C5.64513 11.5361 5.54993 11.5361 5.43898 11.4721ZM5.26465 14.0961C3.47278 14.0961 2.15658 12.736 2.15658 11.056C2.15658 10.928 2.17249 10.8 2.18826 10.672L5.3121 12.4961C5.50234 12.608 5.69273 12.608 5.88297 12.4961L9.8631 10.1762V11.6962C9.8631 11.8242 9.8155 11.9202 9.70454 11.9841L6.67574 13.7441C6.26344 13.9841 5.77199 14.0961 5.26465 14.0961ZM9.19719 16C11.1159 16 12.7174 14.624 13.0823 12.8C14.8582 12.3359 16 10.6559 16 8.944C16 7.82396 15.5243 6.73603 14.668 5.95201C14.7473 5.61598 14.7949 5.27995 14.7949 4.94407C14.7949 2.65612 12.9554 0.944002 10.8305 0.944002C10.4025 0.944002 9.99013 1.00794 9.57782 1.15201C8.86416 0.447988 7.88099 0 6.80278 0C4.88403 0 3.28254 1.37593 2.91768 3.19999C1.14173 3.66404 0 5.34404 0 7.056C0 8.17604 0.475669 9.26397 1.33197 10.048C1.25269 10.384 1.20509 10.72 1.20509 11.0559C1.20509 13.3438 3.04456 15.0559 5.16946 15.0559C5.59753 15.0559 6.00984 14.9921 6.42215 14.848C7.13565 15.552 8.11882 16 9.19719 16Z"
          fill="currentColor"
        />
      </svg>
    )
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

  @inject(ClipboardService)
  protected readonly clipboardService: ClipboardService

  @inject(QuickInputService) @optional()
  protected readonly quickInputService: QuickInputService | undefined

  @inject(OpenerService)
  protected readonly openerService: OpenerService

  @inject(WidgetManager)
  protected readonly widgetManager: WidgetManager

  @inject(FileService)
  protected readonly fileService: FileService

  @inject(WorkspaceService)
  protected readonly workspaceService: WorkspaceService

  @inject(ApplicationShell)
  protected readonly shell: ApplicationShell

  @inject(WebSocketConnectionSource)
  protected readonly connectionSource: WebSocketConnectionSource

  protected session: NativeAgentSession | undefined
  protected provider: NativeAgentProvider = 'codex'
  protected cwd = ''
  protected initialized = false
  protected readonly openingEntities = new Set<string>()
  protected readonly editorFocusOrder: string[] = []
  protected readonly promptedDataverseUploadKeys = new Set<string>()
  protected dataverseReplacementPrompt: Promise<void> | undefined
  protected backendCloseRequested = false
  protected promptHistory: string[] = []
  protected sessionRefreshTimer: number | undefined
  protected sessionRefreshUntil = 0
  protected readonly deleteChatSessionButton: QuickInputButton = {
    iconClass: 'codicon-trashcan',
    tooltip: nls.localize('rockit/agentChat/deleteChat', 'Delete chat'),
    alwaysVisible: true,
  }

  initWidget(): void {
    if (this.initialized) {
      return
    }
    this.initialized = true
    this.id = NativeAgentChatWidget.ID
    this.title.label = nls.localize('rockit/agentChat/assistantTitle', 'AI Assistant')
    this.title.caption = nls.localize('rockit/agentChat/assistantTitle', 'AI Assistant')
    this.title.closable = true
    this.addClass('native-agent-chat')
    this.toDispose.push(
      this.nativeAgentService.onDidChangeSession((event) => {
        if (event.sessionId === this.session?.id) {
          this.session = event.session
          this.updateTitle()
          this.update()
          if (event.session.status === 'running') {
            this.keepRefreshingRunningSession()
          }
          void this.maybePromptForDataverseCrateReplacement()
        }
      }),
    )
    this.toDispose.push(
      this.appStateService.onDidChangeSelector(
        (state) => state.nativeAgentActivityExpanded,
      )(() => this.update()),
    )
    this.toDispose.push(
      this.appStateService.onDidChangeSelector(
        (state) => state.roCrate,
      )(() => this.update()),
    )
    this.toDispose.push(
      this.shell.onDidChangeCurrentWidget(({ newValue }) => {
        if (newValue && this.isRoCrateEditorWidget(newValue)) {
          this.markEditorFocused(newValue.id)
        }
      }),
    )
    this.toDispose.push(
      this.connectionSource.onSocketDidOpen(() => {
        this.scheduleSessionRefresh(250)
      }),
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
    await this.refreshPromptHistory()
    this.updateTitle()
    this.update()
    void this.maybePromptForDataverseCrateReplacement()
  }

  override dispose(): void {
    if (!this.isDisposed) {
      void this.closeBackendSession()
    }
    this.clearRecoveryTimers()
    super.dispose()
  }

  protected clearRecoveryTimers(): void {
    if (this.sessionRefreshTimer !== undefined) {
      window.clearTimeout(this.sessionRefreshTimer)
      this.sessionRefreshTimer = undefined
    }
  }

  protected async closeBackendSession(): Promise<void> {
    if (this.backendCloseRequested || !this.session?.id) {
      return
    }
    this.backendCloseRequested = true
    try {
      await this.nativeAgentService.closeSession(this.session.id)
    } catch (error) {
      console.warn('Failed to close native agent session:', error)
    }
  }

  protected updateTitle(): void {
    const label = nls.localize(
      'rockit/agentChat/providerChat',
      '{0} Chat',
      this.provider === 'codex' ? 'Codex' : 'Claude',
    )
    this.title.label = label
    this.title.caption = `${label} - ${this.cwd}`
    this.title.iconClass = `native-agent-tab-icon provider-${this.provider}`
  }

  protected render(): React.ReactNode {
    return (
      <NativeAgentChatView
        provider={this.provider}
        cwd={this.cwd}
        session={this.session}
        entityIds={this.getEntityIds()}
        activityExpanded={this.appStateService.nativeAgentActivityExpanded}
        onActivityExpandedChange={this.handleActivityExpandedChange}
        onSelectEntity={this.handleSelectEntity}
        onOpenLink={this.handleOpenLink}
        onCopyChat={this.handleCopyChat}
        onShowHistory={this.handleShowHistory}
        onSearchPromptHistory={this.handleSearchPromptHistory}
        onCancel={this.handleCancel}
        onSend={this.handleSend}
        onError={this.handleError}
        promptHistory={this.promptHistory}
      />
    )
  }

  protected readonly handleActivityExpandedChange = (expanded: boolean): void => {
    this.appStateService.nativeAgentActivityExpanded = expanded
  }

  protected readonly handleSelectEntity = (entityId: string): void => {
    void this.openRoCrateEditorForEntity(entityId)
  }

  protected readonly handleOpenLink = (href: string): void => {
    void this.openExternalLink(href)
  }

  protected readonly handleCopyChat = (): void => {
    void this.copyFullChatTranscript()
  }

  protected readonly handleShowHistory = (): void => {
    void this.showChatHistory()
  }

  protected readonly handleSearchPromptHistory = async (): Promise<string | undefined> => {
    return this.showPromptHistorySearch()
  }

  protected async refreshPromptHistory(): Promise<void> {
    const entries = await this.nativeAgentService.listPromptHistory({
      cwd: this.cwd,
      provider: this.provider,
      limit: 200,
    })
    this.promptHistory = entries.map((entry) => entry.text)
  }

  protected async showPromptHistorySearch(): Promise<string | undefined> {
    if (!this.quickInputService) {
      return undefined
    }
    const entries = await this.nativeAgentService.listPromptHistory({
      cwd: this.cwd,
      provider: this.provider,
      limit: 200,
    })
    const picks = entries.map((entry): QuickPickItem & { text: string } => ({
      label: this.truncateForPick(entry.text, 80),
      description: new Date(entry.sentAt).toLocaleString(),
      detail: entry.text,
      text: entry.text,
    }))
    const selected = await this.quickInputService.showQuickPick(picks, {
      title: nls.localize(
        'rockit/agentChat/searchPromptHistory',
        'Search Prompt History',
      ),
      placeholder: nls.localize(
        'rockit/agentChat/searchPreviousPrompts',
        'Search previous prompts',
      ),
      matchOnDescription: true,
      matchOnDetail: true,
    })
    return selected?.text
  }

  protected async showChatHistory(): Promise<void> {
    if (!this.quickInputService) {
      return
    }
    const sessions = await this.nativeAgentService.listChatSessions({
      cwd: this.cwd,
      provider: this.provider,
    })
    const remainingSessions = new Map(sessions.map((entry) => [entry.id, entry]))
    const sessionPicks = sessions.map((entry): NativeChatHistoryPick => ({
      kind: 'session',
      label: entry.title,
      description: `${entry.provider} · ${new Date(entry.updatedAt).toLocaleString()}`,
      detail: entry.preview || nls.localize(
        'rockit/agentChat/messageCount',
        '{0} messages',
        entry.messageCount,
      ),
      buttons: [this.deleteChatSessionButton],
      session: entry,
    }))
    const picks: NativeChatHistoryPick[] = sessions.length
      ? [
          {
            kind: 'clear-all',
            label: nls.localize(
              'rockit/agentChat/clearAllHistory',
              'Clear all chat history',
            ),
            description: nls.localize(
              'rockit/agentChat/savedChatCount',
              '{0} saved chats',
              sessions.length,
            ),
            iconClasses: ['codicon', 'codicon-clear-all'],
            alwaysShow: true,
            sessions,
          },
          ...sessionPicks,
        ]
      : sessionPicks
    const selected = await this.quickInputService.showQuickPick(picks, {
      title: nls.localize('rockit/agentChat/chatHistory', 'Chat History'),
      placeholder: nls.localize(
        'rockit/agentChat/selectPreviousChat',
        'Select a previous chat to reopen',
      ),
      matchOnDescription: true,
      matchOnDetail: true,
      onDidTriggerItemButton: (context) => {
        if (context.button === this.deleteChatSessionButton) {
          const item = context.item as NativeChatHistoryPick
          if (item.kind === 'session') {
            void this.deleteChatHistoryItem(item.session, context.removeItem, remainingSessions)
          }
        }
      },
    })
    if (!selected) {
      return
    }
    if (selected.kind === 'clear-all') {
      await this.clearChatHistory(Array.from(remainingSessions.values()))
      return
    }
    await this.reopenChatSession(selected.session.id)
  }

  protected async deleteChatHistoryItem(
    session: NativeChatSessionIndex,
    removeItem: () => void,
    remainingSessions: Map<string, NativeChatSessionIndex>,
  ): Promise<void> {
    await this.nativeAgentService.deleteChatSession(session.id)
    remainingSessions.delete(session.id)
    removeItem()
    if (this.session?.id === session.id) {
      await this.startFreshChatSession()
    }
  }

  protected async clearChatHistory(sessions: NativeChatSessionIndex[]): Promise<void> {
    if (!sessions.length) {
      return
    }
    const accepted = await new ConfirmDialog({
      title: nls.localize('rockit/agentChat/clearHistoryTitle', 'Clear Chat History?'),
      msg: nls.localize(
        'rockit/agentChat/clearHistoryQuestion',
        'Delete {0} saved chats for this workspace?',
        sessions.length,
      ),
      ok: nls.localize('rockit/agentChat/clearAll', 'Clear All'),
      cancel: nls.localize('rockit/common/cancel', 'Cancel'),
    }).open()
    if (!accepted) {
      return
    }
    await this.nativeAgentService.clearChatSessions({
      cwd: this.cwd,
      provider: this.provider,
    })
    this.quickInputService?.hide()
    await this.startFreshChatSession()
  }

  protected async startFreshChatSession(): Promise<void> {
    this.session = await this.nativeAgentService.startSession({
      provider: this.provider,
      cwd: this.cwd,
    })
    await this.refreshPromptHistory()
    this.updateTitle()
    this.update()
  }

  protected async reopenChatSession(sessionId: string): Promise<void> {
    if (this.session?.id === sessionId) {
      return
    }
    this.session = await this.nativeAgentService.startSession({
      provider: this.provider,
      cwd: this.cwd,
      resumeSessionId: sessionId,
    })
    await this.refreshPromptHistory()
    this.updateTitle()
    this.update()
  }

  protected truncateForPick(text: string, maxLength: number): string {
    const normalized = text.replace(/\s+/g, ' ').trim()
    return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`
  }

  protected async copyFullChatTranscript(): Promise<void> {
    const transcript = this.serializeChatTranscript()
    if (!transcript.trim()) {
      return
    }
    await this.clipboardService.writeText(transcript)
    this.messageService.info(
      nls.localize('rockit/agentChat/transcriptCopied', 'Chat transcript copied.'),
    )
  }

  protected serializeChatTranscript(): string {
    const session = this.session
    if (!session) {
      return ''
    }
    const lines: string[] = [
      '# Native Agent Chat Transcript',
      '',
      `Session: ${session.id}`,
      `Provider: ${session.provider}`,
      `Workspace: ${session.cwd}`,
      `Status: ${session.status}`,
      `Created: ${session.createdAt}`,
      `Updated: ${session.updatedAt}`,
    ]
    if (session.lastError) {
      lines.push(`Last error: ${session.lastError}`)
    }
    lines.push('')

    for (const message of session.messages) {
      if (message.role === 'system') {
        continue
      }
      lines.push(`## ${message.role} (${message.createdAt})`)
      if (message.streaming) {
        lines.push('')
        lines.push('_streaming_')
      }
      if (message.text.trim()) {
        lines.push('')
        lines.push(message.text.trim())
      }
      if (message.details?.length) {
        lines.push('')
        lines.push('### Details')
        message.details.forEach((detail, index) => {
          lines.push('')
          lines.push(`#### ${index + 1}. ${detail.title}`)
          lines.push(this.formatTranscriptDetail(detail))
        })
      }
      lines.push('')
    }

    return `${lines.join('\n').trim()}\n`
  }

  protected formatTranscriptDetail(detail: NativeAgentMessageDetail): string {
    const text = detail.text ?? ''
    const language = detail.language?.trim() ?? ''
    const fence = this.transcriptFence(text)
    return `${fence}${language}\n${text}\n${fence}`
  }

  protected transcriptFence(text: string): string {
    let longest = 2
    for (const match of text.matchAll(/`+/g)) {
      longest = Math.max(longest, match[0].length)
    }
    return '`'.repeat(longest + 1)
  }

  protected async openExternalLink(href: string): Promise<void> {
    try {
      await open(this.openerService, new URI(href), { openExternalApp: true })
    } catch (error) {
      console.error('NativeAgentChatWidget: failed to open link', { href, error })
      this.messageService.error(error instanceof Error ? error.message : String(error))
    }
  }

  protected scheduleSessionRefresh(delay = 1000): void {
    if (!this.session?.id || this.isDisposed) {
      return
    }
    if (this.sessionRefreshTimer !== undefined) {
      window.clearTimeout(this.sessionRefreshTimer)
    }
    this.sessionRefreshTimer = window.setTimeout(() => {
      this.sessionRefreshTimer = undefined
      void this.refreshSessionFromBackend()
    }, delay)
  }

  protected keepRefreshingRunningSession(): void {
    this.sessionRefreshUntil = Date.now() + 10 * 60 * 1000
    this.scheduleSessionRefresh(1000)
  }

  protected async refreshSessionFromBackend(): Promise<void> {
    const sessionId = this.session?.id
    if (!sessionId || this.isDisposed) {
      return
    }
    try {
      const session = await this.nativeAgentService.getSession(sessionId)
      if (session) {
        this.session = session
        this.updateTitle()
        this.update()
        void this.maybePromptForDataverseCrateReplacement()
      }
      if (this.session?.status === 'running' && Date.now() < this.sessionRefreshUntil) {
        this.scheduleSessionRefresh(1000)
      }
    } catch (error) {
      if (Date.now() < this.sessionRefreshUntil) {
        this.scheduleSessionRefresh(1000)
      }
    }
  }

  protected maybePromptForDataverseCrateReplacement(): void {
    if (this.dataverseReplacementPrompt) {
      return
    }
    const candidate = this.findDataverseUploadReplacementCandidate()
    if (!candidate || this.promptedDataverseUploadKeys.has(candidate.key)) {
      return
    }
    this.promptedDataverseUploadKeys.add(candidate.key)
    this.dataverseReplacementPrompt = this.promptForDataverseCrateReplacement(candidate)
      .catch((error) => {
        console.error('NativeAgentChatWidget: failed to handle Dataverse RO-Crate prompt', error)
        this.messageService.error(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        this.dataverseReplacementPrompt = undefined
        queueMicrotask(() => this.maybePromptForDataverseCrateReplacement())
      })
  }

  protected async promptForDataverseCrateReplacement(
    candidate: DataverseUploadReplacementCandidate,
  ): Promise<void> {
    const pidLine = candidate.pid
      ? `\n\n${nls.localize('rockit/agentChat/datasetPid', 'Dataset PID')}: ${candidate.pid}`
      : ''
    const urlLine = candidate.dataverseUrl ? `\n${candidate.dataverseUrl}` : ''
    const accepted = await new ConfirmDialog({
      title: nls.localize(
        'rockit/agentChat/useDataverseTitle',
        'Use Dataverse-updated RO-Crate?',
      ),
      msg:
        nls.localize(
          'rockit/agentChat/useDataverseMessage',
          'Dataverse returned an updated RO-Crate with assigned dataset and file IDs.\n\nReplace the local ro-crate-metadata.json with the Dataverse-updated version?\n\nThis enables future editing and syncing against the Dataverse dataset.',
        ) +
        pidLine +
        urlLine,
      ok: nls.localize(
        'rockit/agentChat/useDataverseVersion',
        'Use Dataverse Version',
      ),
      cancel: nls.localize(
        'rockit/agentChat/keepLocalVersion',
        'Keep Local Version',
      ),
    }).open()
    if (!accepted) {
      return
    }
    await this.replaceLocalRoCrateWithDataverseCrate(candidate)
  }

  protected async replaceLocalRoCrateWithDataverseCrate(
    candidate: DataverseUploadReplacementCandidate,
  ): Promise<void> {
    const metadataUri = candidate.cratePath
      ? FileUri.create(candidate.cratePath)
      : this.workspaceService.tryGetRoots()?.[0]?.resource.resolve('ro-crate-metadata.json')
    if (!metadataUri) {
      throw new Error(nls.localize(
        'rockit/agentChat/noWorkspaceForReplacement',
        'Cannot replace RO-Crate metadata because no workspace is open.',
      ))
    }
    const pendingContent = await this.fileService.read(FileUri.create(candidate.tempPath))
    const crate = JSON.parse(pendingContent.value)
    await writeUtf8TextFile(this.fileService, metadataUri, JSON.stringify(crate, null, 2))
    this.appStateService.roCrate = crate
    this.appStateService.setRoCrateSnapshot(crate)
    this.appStateService.dirty = false
    this.messageService.info(nls.localize(
      'rockit/agentChat/dataverseVersionApplied',
      'Local ro-crate-metadata.json replaced with Dataverse-updated metadata.',
    ))
    this.update()
  }

  protected findDataverseUploadReplacementCandidate():
    | DataverseUploadReplacementCandidate
    | undefined {
    const messages = this.session?.messages ?? []
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const message = messages[messageIndex]
      const details = message.details ?? []
      for (let detailIndex = details.length - 1; detailIndex >= 0; detailIndex -= 1) {
        const detail = details[detailIndex]
        const values = this.expandJsonLikeValues(detail.text)
        for (const value of values) {
          const candidate = this.extractDataverseUploadReplacementCandidate(
            value,
            `${message.id}:${detailIndex}`,
          )
          if (candidate) {
            return candidate
          }
        }
      }
    }
    return undefined
  }

  protected expandJsonLikeValues(value: unknown, depth = 0): unknown[] {
    if (depth > 8) {
      return []
    }
    const values: unknown[] = [value]
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          values.push(...this.expandJsonLikeValues(JSON.parse(trimmed), depth + 1))
        } catch {
          // Keep the original string; not every tool output is JSON.
        }
      }
      return values
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        values.push(...this.expandJsonLikeValues(entry, depth + 1))
      }
      return values
    }
    if (value && typeof value === 'object') {
      for (const entry of Object.values(value as Record<string, unknown>)) {
        values.push(...this.expandJsonLikeValues(entry, depth + 1))
      }
    }
    return values
  }

  protected extractDataverseUploadReplacementCandidate(
    value: unknown,
    keyPrefix: string,
  ): DataverseUploadReplacementCandidate | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined
    }
    const record = value as Record<string, any>
    const pending = this.asPendingDataverseCrate(record.pendingDataverseCrate)
    if (!pending || !this.looksLikeDataverseUploadResult(record)) {
      return undefined
    }
    const dataverseUrl =
      typeof record.dataverseUrl === 'string'
        ? record.dataverseUrl
        : typeof record.datasetUrl === 'string'
          ? record.datasetUrl
          : typeof pending.dataverseUrl === 'string'
            ? pending.dataverseUrl
            : undefined
    const pid =
      typeof record.pid === 'string'
        ? record.pid
        : typeof pending.pid === 'string'
          ? pending.pid
          : undefined
    return {
      key: `${keyPrefix}:${pending.id}`,
      pendingId: pending.id,
      tempPath: pending.tempPath,
      cratePath: pending.cratePath,
      pid,
      dataverseUrl,
    }
  }

  protected looksLikeDataverseUploadResult(record: Record<string, any>): boolean {
    if (record.pendingDataverseCrate) {
      return true
    }
    const requestUrl = String(record.requestUrl ?? record.url ?? '')
    if (requestUrl.includes('/api/arp/uploadRoCrateZip') || requestUrl.includes('/api/arp/rocrate')) {
      return true
    }
    const toolName = String(record.toolName ?? record.name ?? record.tool ?? '')
    if (toolName.includes('upload_rocrate_to_dataverse')) {
      return true
    }
    return false
  }

  protected asPendingDataverseCrate(value: unknown):
    | {
        id: string
        tempPath: string
        cratePath?: string
        pid?: string
        dataverseUrl?: string
      }
    | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined
    }
    const record = value as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.tempPath !== 'string') {
      return undefined
    }
    return {
      id: record.id,
      tempPath: record.tempPath,
      cratePath: typeof record.cratePath === 'string' ? record.cratePath : undefined,
      pid: typeof record.pid === 'string' ? record.pid : undefined,
      dataverseUrl: typeof record.dataverseUrl === 'string' ? record.dataverseUrl : undefined,
    }
  }

  protected extractRootArpPid(crate: Record<string, any>): string | undefined {
    const root = this.findRootDataset(crate)
    return typeof root?.['@arpPid'] === 'string' ? root['@arpPid'] : undefined
  }

  protected extractRootTitle(crate: Record<string, any>): string | undefined {
    const root = this.findRootDataset(crate)
    return typeof root?.title === 'string'
      ? root.title
      : typeof root?.name === 'string'
        ? root.name
        : undefined
  }

  protected findRootDataset(crate: Record<string, any>): Record<string, any> | undefined {
    const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
    return graph.find(
      (entity): entity is Record<string, any> =>
        entity && typeof entity === 'object' && String(entity['@id']) === './',
    )
  }

  protected async openRoCrateEditorForEntity(entityId: string): Promise<void> {
    if (!entityId || this.openingEntities.has(entityId)) {
      return
    }
    this.openingEntities.add(entityId)
    const prevSelected = this.appStateService.selectedEntityId
    if (prevSelected !== entityId) {
      this.appStateService.selectedEntityId = entityId
    }

    try {
      const existingWidgetId = this.findWidgetIdForEntity(entityId)
      if (existingWidgetId) {
        this.appStateService.registerEntityEditor(existingWidgetId, entityId)
        await this.shell.activateWidget(existingWidgetId)
        this.markEditorFocused(existingWidgetId)
        return
      }

      const preferredEditor = this.getPreferredRoCrateEditorWidget()
      if (preferredEditor) {
        this.appStateService.registerEntityEditor(preferredEditor.id, entityId)
        await this.shell.activateWidget(preferredEditor.id)
        this.markEditorFocused(preferredEditor.id)
        return
      }

      const instanceId = `${RoCrateEditorWidget.ID}:${Math.random().toString(36).slice(2)}`
      const widget = await this.widgetManager.getOrCreateWidget(RoCrateEditorWidget.ID, {
        instanceId,
        entityId,
      })
      await this.shell.addWidget(widget, { area: 'main' })
      this.appStateService.registerEntityEditor(widget.id, entityId)
      await this.shell.activateWidget(widget.id)
      this.markEditorFocused(widget.id)
    } catch (error) {
      console.error('NativeAgentChatWidget: failed to open entity', { entityId, error })
      this.messageService.error(error instanceof Error ? error.message : String(error))
    } finally {
      this.openingEntities.delete(entityId)
    }
  }

  protected findWidgetIdForEntity(entityId: string): string | undefined {
    const mapping = this.appStateService.EIRCEIA ?? {}
    const matchingIds = Object.entries(mapping)
      .filter(([, mappedEntityId]) => mappedEntityId === entityId)
      .map(([widgetId]) => widgetId)
      .filter((widgetId) => Boolean(this.shell.getWidgetById(widgetId)))

    for (let index = this.editorFocusOrder.length - 1; index >= 0; index -= 1) {
      const widgetId = this.editorFocusOrder[index]
      if (matchingIds.includes(widgetId)) {
        return widgetId
      }
    }

    return matchingIds[0]
  }

  protected isRoCrateEditorWidget(widget: Widget): boolean {
    return widget.id.startsWith(RoCrateEditorWidget.ID)
  }

  protected markEditorFocused(widgetId: string): void {
    const index = this.editorFocusOrder.indexOf(widgetId)
    if (index >= 0) {
      this.editorFocusOrder.splice(index, 1)
    }
    this.editorFocusOrder.push(widgetId)
  }

  protected getPreferredRoCrateEditorWidget(): Widget | undefined {
    for (let index = this.editorFocusOrder.length - 1; index >= 0; index -= 1) {
      const widgetId = this.editorFocusOrder[index]
      const widget = this.shell.getWidgetById(widgetId)
      if (widget && this.isRoCrateEditorWidget(widget)) {
        return widget
      }
      this.editorFocusOrder.splice(index, 1)
    }

    const active = this.shell.activeWidget ?? this.shell.currentWidget
    if (active && this.isRoCrateEditorWidget(active)) {
      return active
    }

    for (const widget of this.shell.getWidgets('main')) {
      if (this.isRoCrateEditorWidget(widget)) {
        return widget
      }
    }

    return undefined
  }

  protected getEntityIds(): string[] {
    const graph = this.appStateService.roCrate?.['@graph']
    if (!Array.isArray(graph)) {
      return []
    }
    return graph
      .map((entity) => entity?.['@id'])
      .filter((entityId): entityId is string => typeof entityId === 'string' && entityId.length > 0)
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
    this.keepRefreshingRunningSession()
    this.session = await this.nativeAgentService.sendMessage({
      sessionId: this.session.id,
      text,
      context: {
        selectedEntityId: this.appStateService.selectedEntityId,
        validationErrors: this.appStateService.validationErrors,
      },
    })
    await this.refreshPromptHistory()
    this.update()
    this.scheduleSessionRefresh(750)
    void this.maybePromptForDataverseCrateReplacement()
  }

  protected readonly handleError = (error: unknown): void => {
    this.messageService.error(
      localizeNativeAgentServiceMessage(
        error instanceof Error ? error.message : String(error),
      ),
    )
  }
}

/**
 * In-memory telemetry collector for the RO-Crate MCP Dashboard
 * Bounded memory usage with automatic retention purging
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type {
  Session,
  ToolCall,
  ErrorEvent,
  DependencyUsage,
  HttpExchangeLog,
  ToolCallArtifact,
  TransportMode,
  CollectorConfig,
} from './types'
import {
  sanitizeToolName,
  sanitizeAndMeasureArgs,
  createSanitizedErrorEvent,
  truncateErrorMessage,
} from './sanitize'

/**
 * Default configuration for the collector
 */
const DEFAULT_CONFIG: CollectorConfig = {
  maxSessions: 100,
  maxToolCalls: 10000,
  maxErrors: 1000,
  retentionHours: 24,
  maxErrorMessageLength: 500,
  detailedToolCallLogging: true,
  maxDetailSizeBytes: 100 * 1024, // 100KB
}
const MAX_HTTP_LOGS_PER_TOOL_CALL = 20
const MAX_HTTP_DETAIL_CHARS = 16 * 1024
const MAX_ARTIFACTS_PER_TOOL_CALL = 20

type ToolCallContext = {
  toolCallId: string
}

/**
 * Telemetry collector with bounded memory and automatic retention
 */
export class TelemetryCollector {
  private readonly config: CollectorConfig
  private readonly sessions: Map<string, Session>
  private readonly toolCalls: Map<string, ToolCall>
  private readonly errors: Map<string, ErrorEvent>
  private readonly dependencyUsage: Map<string, DependencyUsage>
  private readonly sessionToolCalls: Map<string, Set<string>>
  private readonly sessionErrors: Map<string, Set<string>>
  private readonly sessionIdsByKey: Map<string, string>
  private readonly toolCallContext: AsyncLocalStorage<ToolCallContext>
  private serverStartTime: Date

  constructor(config: Partial<CollectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.sessions = new Map()
    this.toolCalls = new Map()
    this.errors = new Map()
    this.dependencyUsage = new Map()
    this.sessionToolCalls = new Map()
    this.sessionErrors = new Map()
    this.sessionIdsByKey = new Map()
    this.toolCallContext = new AsyncLocalStorage<ToolCallContext>()
    this.serverStartTime = new Date()
  }

  /**
   * Truncates a value to fit within the maximum detail size
   * Returns a truncated JSON string representation
   */
  private truncateValue(value: unknown): string | undefined {
    if (value === null || value === undefined) {
      return undefined
    }

    try {
      const json = JSON.stringify(value, null, 2)
      if (json.length > this.config.maxDetailSizeBytes) {
        return json.slice(0, this.config.maxDetailSizeBytes) + '\n... (truncated)'
      }
      return json
    } catch {
      return String(value).slice(0, this.config.maxDetailSizeBytes)
    }
  }

  /**
   * Truncates HTTP log detail to a bounded size.
   */
  private truncateHttpDetail(value: string | undefined): string | undefined {
    if (!value) {
      return undefined
    }
    if (value.length > MAX_HTTP_DETAIL_CHARS) {
      return value.slice(0, MAX_HTTP_DETAIL_CHARS) + '\n... (truncated)'
    }
    return value
  }

  /**
   * Updates the collector configuration
   * Used to set dashboard-specific settings after initialization
   */
  configure(updates: Partial<CollectorConfig>): void {
    Object.assign(this.config, updates)
  }

  /**
   * Runs work inside the current tool-call telemetry context.
   */
  runWithToolCallContext<T>(toolCallId: string, fn: () => T): T {
    return this.toolCallContext.run({ toolCallId }, fn)
  }

  /**
   * Returns the active tool-call telemetry ID for the current async context.
   */
  getCurrentToolCallId(): string | undefined {
    return this.toolCallContext.getStore()?.toolCallId
  }

  /**
   * Gets or creates the current session
   * @param transportMode - Transport mode for the session
   * @returns The current session
   */
  getOrCreateSession(
    transportMode: TransportMode,
    sessionKey = 'default',
  ): Session {
    const now = new Date().toISOString()
    const existingSessionId = this.sessionIdsByKey.get(sessionKey)
    if (existingSessionId) {
      const existing = this.sessions.get(existingSessionId)
      if (existing && existing.active) {
        existing.lastActivityAt = now
        return existing
      }
    }

    // Create new session
    const sessionId = randomUUID()
    const session: Session = {
      id: sessionId,
      startedAt: now,
      lastActivityAt: now,
      transportMode,
      requestCount: 0,
      errorCount: 0,
      active: true,
    }

    this.sessions.set(sessionId, session)
    this.sessionToolCalls.set(sessionId, new Set())
    this.sessionErrors.set(sessionId, new Set())
    this.sessionIdsByKey.set(sessionKey, sessionId)

    // Enforce session limit
    this.enforceSessionLimit()

    return session
  }

  /**
   * Records a tool call start
   * @param toolName - Name of the tool being called
   * @param args - Tool arguments (optionally stored if detailed logging enabled)
   * @returns The tool call ID
   */
  startToolCall(
    toolName: string,
    args: unknown,
    sessionKey = 'default',
    transportMode: TransportMode = 'content-length',
  ): string {
    const session = this.getOrCreateSession(transportMode, sessionKey)
    const toolCallId = randomUUID()
    const now = new Date().toISOString()

    const argsSize = sanitizeAndMeasureArgs(args)
    const toolCall: ToolCall = {
      id: toolCallId,
      sessionId: session.id,
      toolName: sanitizeToolName(toolName),
      startedAt: now,
      finishedAt: null,
      durationMs: null,
      status: 'started',
      argsSizeBytes: argsSize,
      params: this.config.detailedToolCallLogging ? this.truncateValue(args) : undefined,
    }

    this.toolCalls.set(toolCallId, toolCall)
    this.sessionToolCalls.get(session.id)?.add(toolCallId)
    session.requestCount++
    session.lastActivityAt = now

    // Enforce tool call limit
    this.enforceToolCallLimit()

    return toolCallId
  }

  /**
   * Marks a session inactive by its key when a connection ends
   * @param sessionKey - Stable key used to map a connection to a session
   */
  deactivateSession(sessionKey = 'default'): void {
    const sessionId = this.sessionIdsByKey.get(sessionKey)
    if (!sessionId) {
      return
    }
    const session = this.sessions.get(sessionId)
    if (!session) {
      this.sessionIdsByKey.delete(sessionKey)
      return
    }
    session.active = false
    session.lastActivityAt = new Date().toISOString()
    this.sessionIdsByKey.delete(sessionKey)
  }

  /**
   * Completes a tool call with success
   * @param toolCallId - ID of the tool call
   * @param result - Optional result (stored if detailed logging enabled)
   */
  completeToolCallSuccess(toolCallId: string, result?: unknown): void {
    const toolCall = this.toolCalls.get(toolCallId)
    if (!toolCall) {
      return
    }

    const now = new Date()
    toolCall.finishedAt = now.toISOString()
    toolCall.durationMs = now.getTime() - new Date(toolCall.startedAt).getTime()
    toolCall.status = 'success'

    if (this.config.detailedToolCallLogging && result !== undefined) {
      toolCall.result = this.truncateValue(result)
      toolCall.resultSizeBytes = sanitizeAndMeasureArgs(result)
    }
  }

  /**
   * Completes a tool call with an error
   * @param toolCallId - ID of the tool call
   * @param error - The error that occurred
   */
  completeToolCallError(toolCallId: string, error: unknown): void {
    const toolCall = this.toolCalls.get(toolCallId)
    if (!toolCall) {
      return
    }

    const now = new Date()
    const sanitized = createSanitizedErrorEvent(
      toolCall.sessionId,
      toolCall.toolName,
      error,
    )

    toolCall.finishedAt = now.toISOString()
    toolCall.durationMs = now.getTime() - new Date(toolCall.startedAt).getTime()
    toolCall.status = 'error'
    toolCall.errorCode = sanitized.errorCode
    toolCall.errorMessageShort = sanitized.messageShort

    // Store full error message if detailed logging is enabled
    if (this.config.detailedToolCallLogging) {
      const fullMessage = error instanceof Error ? error.stack || error.message : String(error)
      toolCall.errorMessageFull = truncateErrorMessage(fullMessage, this.config.maxErrorMessageLength * 10)
    }

    // Record as error event too
    this.recordError(sanitized)

    // Update session error count
    const session = this.sessions.get(toolCall.sessionId)
    if (session) {
      session.errorCount++
    }
  }

  /**
   * Records a standalone error event
   * @param errorEvent - The error event to record
   */
  recordError(errorEvent: Omit<ErrorEvent, 'id' | 'timestamp'>): void {
    const errorId = randomUUID()
    const now = new Date().toISOString()

    const error: ErrorEvent = {
      id: errorId,
      timestamp: now,
      ...errorEvent,
    }

    this.errors.set(errorId, error)
    this.sessionErrors.get(errorEvent.sessionId)?.add(errorId)

    // Enforce error limit
    this.enforceErrorLimit()
  }

  /**
   * Records a dependency API call
   * @param dependency - Name of the dependency (e.g., 'tavily')
   * @param success - Whether the call was successful
   * @param latencyMs - Call latency in milliseconds
   */
  recordDependencyCall(
    dependency: string,
    success: boolean,
    latencyMs: number,
  ): void {
    const key = dependency.toLowerCase()
    let usage = this.dependencyUsage.get(key)

    if (!usage) {
      usage = {
        dependency: key,
        callCount: 0,
        successCount: 0,
        failureCount: 0,
        avgLatencyMs: 0,
        lastCallAt: null,
      }
      this.dependencyUsage.set(key, usage)
    }

    usage.callCount++
    if (success) {
      usage.successCount++
    } else {
      usage.failureCount++
    }

    // Update rolling average
    usage.avgLatencyMs =
      (usage.avgLatencyMs * (usage.callCount - 1) + latencyMs) / usage.callCount
    usage.lastCallAt = new Date().toISOString()
  }

  /**
   * Appends a sanitized HTTP exchange to a tool call.
   */
  appendToolCallHttpLog(toolCallId: string, log: HttpExchangeLog): void {
    const toolCall = this.toolCalls.get(toolCallId)
    if (!toolCall) {
      return
    }
    const sanitized: HttpExchangeLog = {
      timestamp: log.timestamp,
      dependency: log.dependency,
      request: {
        method: log.request.method,
        url: log.request.url,
        headers: log.request.headers,
        body: this.truncateHttpDetail(log.request.body),
      },
      response: log.response
        ? {
            status: log.response.status,
            ok: log.response.ok,
            url: log.response.url,
            headers: log.response.headers,
            body: this.truncateHttpDetail(log.response.body),
          }
        : undefined,
      error: this.truncateHttpDetail(log.error),
    }
    const nextLogs = [...(toolCall.httpLogs ?? []), sanitized]
    if (nextLogs.length > MAX_HTTP_LOGS_PER_TOOL_CALL) {
      nextLogs.splice(0, nextLogs.length - MAX_HTTP_LOGS_PER_TOOL_CALL)
    }
    toolCall.httpLogs = nextLogs
  }

  addToolCallArtifact(toolCallId: string, artifact: ToolCallArtifact): void {
    const toolCall = this.toolCalls.get(toolCallId)
    if (!toolCall) {
      return
    }
    const sanitized: ToolCallArtifact = {
      label: artifact.label.slice(0, 120),
      path: artifact.path.slice(0, 4096),
    }
    const nextArtifacts = [...(toolCall.artifacts ?? []), sanitized]
    if (nextArtifacts.length > MAX_ARTIFACTS_PER_TOOL_CALL) {
      nextArtifacts.splice(0, nextArtifacts.length - MAX_ARTIFACTS_PER_TOOL_CALL)
    }
    toolCall.artifacts = nextArtifacts
  }

  /**
   * Gets all sessions
   */
  getSessions(): Session[] {
    return Array.from(this.sessions.values())
  }

  /**
   * Gets a session by ID
   */
  getSession(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  /**
   * Gets all tool calls
   */
  getToolCalls(): ToolCall[] {
    return Array.from(this.toolCalls.values())
  }

  /**
   * Gets tool calls for a specific session
   */
  getToolCallsForSession(sessionId: string): ToolCall[] {
    const callIds = this.sessionToolCalls.get(sessionId)
    if (!callIds) {
      return []
    }

    const calls: ToolCall[] = []
    for (const id of callIds) {
      const call = this.toolCalls.get(id)
      if (call) {
        calls.push(call)
      }
    }
    return calls
  }

  /**
   * Gets recent errors
   */
  getErrors(limit?: number): ErrorEvent[] {
    const errors = Array.from(this.errors.values())
    // Sort by timestamp descending
    errors.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    return limit ? errors.slice(0, limit) : errors
  }

  /**
   * Gets dependency usage stats
   */
  getDependencyUsage(): DependencyUsage[] {
    return Array.from(this.dependencyUsage.values())
  }

  /**
   * Gets server uptime in seconds
   */
  getUptimeSeconds(): number {
    return Math.floor((Date.now() - this.serverStartTime.getTime()) / 1000)
  }

  /**
   * Enforces session retention limits
   */
  private enforceSessionLimit(): void {
    if (this.sessions.size <= this.config.maxSessions) {
      return
    }

    // Sort by last activity, remove oldest inactive sessions first
    const sorted = Array.from(this.sessions.entries()).sort(
      (a, b) => a[1].lastActivityAt.localeCompare(b[1].lastActivityAt),
    )

    const toRemove = sorted.slice(0, sorted.length - this.config.maxSessions)
    for (const [id] of toRemove) {
      // Don't remove active sessions
      const session = this.sessions.get(id)
      if (session && !session.active) {
        this.removeSession(id)
      }
    }

    // Also purge by time
    this.purgeOldSessions()
  }

  /**
   * Enforces tool call retention limits
   */
  private enforceToolCallLimit(): void {
    if (this.toolCalls.size <= this.config.maxToolCalls) {
      return
    }

    // Sort by started time, remove oldest
    const sorted = Array.from(this.toolCalls.entries()).sort(
      (a, b) => a[1].startedAt.localeCompare(b[1].startedAt),
    )

    const toRemove = sorted.slice(0, sorted.length - this.config.maxToolCalls)
    for (const [id, call] of toRemove) {
      this.toolCalls.delete(id)
      this.sessionToolCalls.get(call.sessionId)?.delete(id)
    }
  }

  /**
   * Enforces error retention limits
   */
  private enforceErrorLimit(): void {
    if (this.errors.size <= this.config.maxErrors) {
      return
    }

    // Sort by timestamp, remove oldest
    const sorted = Array.from(this.errors.entries()).sort(
      (a, b) => a[1].timestamp.localeCompare(b[1].timestamp),
    )

    const toRemove = sorted.slice(0, sorted.length - this.config.maxErrors)
    for (const [id, error] of toRemove) {
      this.errors.delete(id)
      this.sessionErrors.get(error.sessionId)?.delete(id)
    }
  }

  /**
   * Purges sessions older than retention window
   */
  private purgeOldSessions(): void {
    const cutoff = new Date(
      Date.now() - this.config.retentionHours * 60 * 60 * 1000,
    ).toISOString()

    for (const [id, session] of this.sessions) {
      if (!session.active && session.lastActivityAt < cutoff) {
        this.removeSession(id)
      }
    }
  }

  /**
   * Removes a session and all its associated data
   */
  private removeSession(sessionId: string): void {
    this.sessions.delete(sessionId)
    for (const [key, id] of this.sessionIdsByKey.entries()) {
      if (id === sessionId) {
        this.sessionIdsByKey.delete(key)
      }
    }

    // Remove associated tool calls
    const callIds = this.sessionToolCalls.get(sessionId)
    if (callIds) {
      for (const id of callIds) {
        this.toolCalls.delete(id)
      }
      this.sessionToolCalls.delete(sessionId)
    }

    // Remove associated errors
    const errorIds = this.sessionErrors.get(sessionId)
    if (errorIds) {
      for (const id of errorIds) {
        this.errors.delete(id)
      }
      this.sessionErrors.delete(sessionId)
    }
  }

  /**
   * Runs periodic cleanup (should be called periodically)
   */
  performPeriodicCleanup(): void {
    this.purgeOldSessions()
  }

  /**
   * Gets collector stats for debugging
   */
  getStats(): {
    sessionCount: number
    toolCallCount: number
    errorCount: number
    dependencyCount: number
    uptimeSeconds: number
  } {
    return {
      sessionCount: this.sessions.size,
      toolCallCount: this.toolCalls.size,
      errorCount: this.errors.size,
      dependencyCount: this.dependencyUsage.size,
      uptimeSeconds: this.getUptimeSeconds(),
    }
  }
}

/**
 * Global singleton instance (initialized on first import)
 */
let globalCollector: TelemetryCollector | null = null

/**
 * Gets or creates the global telemetry collector
 */
export function getGlobalCollector(): TelemetryCollector {
  if (!globalCollector) {
    globalCollector = new TelemetryCollector()
  }
  return globalCollector
}

/**
 * Resets the global collector (useful for testing)
 */
export function resetGlobalCollector(): void {
  globalCollector = null
}

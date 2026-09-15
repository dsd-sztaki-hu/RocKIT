// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

/**
 * Telemetry types for the RO-Crate MCP Dashboard
 * All types are designed for bounded memory usage and safe defaults
 */

/**
 * Transport mode indicates how the MCP client communicates with the server
 */
export type TransportMode = 'content-length' | 'jsonl'

/**
 * Status of a tool call execution
 */
export type ToolCallStatus = 'started' | 'success' | 'error' | 'timeout'

/**
 * A sanitized HTTP request/response exchange captured during a tool call.
 */
export interface HttpExchangeLog {
  /** ISO timestamp when the exchange completed */
  timestamp: string
  /** Dependency name (e.g. dataverse) */
  dependency: string
  /** Request details */
  request: {
    method: string
    url: string
    headers?: Record<string, string>
    body?: string
  }
  /** Response details, if one was received */
  response?: {
    status: number
    ok: boolean
    url: string
    headers?: Record<string, string>
    body?: string
  }
  /** Error message if the request failed before a response was available */
  error?: string
}

export interface ToolCallArtifact {
  label: string
  path: string
}

/**
 * A session represents a single MCP server connection/run
 * Sessions are created on first request and tracked until server shutdown
 */
export interface Session {
  /** Unique session identifier (UUID) */
  id: string
  /** ISO timestamp when session was created */
  startedAt: string
  /** ISO timestamp of last activity in this session */
  lastActivityAt: string
  /** Transport mode used by the client */
  transportMode: TransportMode
  /** Number of requests processed in this session */
  requestCount: number
  /** Number of errors encountered in this session */
  errorCount: number
  /** Whether the session is still active */
  active: boolean
}

/**
 * A tool call represents a single invocation of an MCP tool
 */
export interface ToolCall {
  /** Unique call identifier (UUID) */
  id: string
  /** Session this call belongs to */
  sessionId: string
  /** Name of the tool that was called */
  toolName: string
  /** ISO timestamp when the call started */
  startedAt: string
  /** ISO timestamp when the call finished (null if still running) */
  finishedAt: string | null
  /** Duration in milliseconds (null if still running) */
  durationMs: number | null
  /** Status of the call */
  status: ToolCallStatus
  /** Error code if status is 'error' */
  errorCode?: string
  /** Short error message (truncated for safety) */
  errorMessageShort?: string
  /** Full error message/stack (optional, stored if enabled) */
  errorMessageFull?: string
  /** Size of arguments in bytes */
  argsSizeBytes: number
  /** Tool call parameters (optional, stored if detailed logging enabled) */
  params?: unknown
  /** Tool call result (optional, stored if detailed logging enabled) */
  result?: unknown
  /** Size of result in bytes */
  resultSizeBytes?: number
  /** Captured HTTP exchanges for this tool call */
  httpLogs?: HttpExchangeLog[]
  /** Local artifacts produced during this tool call */
  artifacts?: ToolCallArtifact[]
}

/**
 * An error event represents an error that occurred during server operation
 */
export interface ErrorEvent {
  /** Unique error identifier (UUID) */
  id: string
  /** Session this error belongs to */
  sessionId: string
  /** Tool name if error occurred during tool call */
  toolName?: string
  /** ISO timestamp when the error occurred */
  timestamp: string
  /** Error code/category */
  errorCode: string
  /** Short error message (truncated for safety) */
  messageShort: string
}

/**
 * Dependency usage tracking (e.g., external APIs like Tavily)
 */
export interface DependencyUsage {
  /** Dependency name (e.g., 'tavily', 'dataverse') */
  dependency: string
  /** Total number of calls to this dependency */
  callCount: number
  /** Number of successful calls */
  successCount: number
  /** Number of failed calls */
  failureCount: number
  /** Average latency in milliseconds */
  avgLatencyMs: number
  /** ISO timestamp of the last call */
  lastCallAt: string | null
}

/**
 * Aggregate window for time-based statistics
 */
export interface AggregateWindow {
  /** Start of the window (ISO timestamp) */
  windowStart: string
  /** End of the window (ISO timestamp) */
  windowEnd: string
  /** Total number of tool calls in the window */
  totalCalls: number
  /** Number of failed calls in the window */
  failedCalls: number
  /** Number of active sessions in the window */
  activeSessions: number
  /** 50th percentile latency in milliseconds */
  p50Ms: number | null
  /** 95th percentile latency in milliseconds */
  p95Ms: number | null
}

/**
 * Configuration for the telemetry collector
 */
export interface CollectorConfig {
  /** Maximum number of sessions to retain */
  maxSessions: number
  /** Maximum number of tool calls to retain */
  maxToolCalls: number
  /** Maximum number of error events to retain */
  maxErrors: number
  /** Retention window in hours (events older than this are purged) */
  retentionHours: number
  /** Maximum length of error messages (truncated for safety) */
  maxErrorMessageLength: number
  /** Whether to store full tool call parameters and results */
  detailedToolCallLogging: boolean
  /** Maximum size of parameters/results to store in bytes */
  maxDetailSizeBytes: number
}

/**
 * Summary statistics for the dashboard overview
 */
export interface SummaryStats {
  /** Total number of tool calls */
  totalCalls: number
  /** Number of failed tool calls */
  failedCalls: number
  /** Error rate as percentage (0-100) */
  errorRate: number
  /** Number of currently active sessions */
  activeSessions: number
  /** Average latency in milliseconds */
  avgLatencyMs: number
  /** 95th percentile latency in milliseconds */
  p95LatencyMs: number | null
  /** Uptime in seconds */
  uptimeSeconds: number
}

/**
 * Tool-specific statistics for the tools table
 */
export interface ToolStats {
  /** Name of the tool */
  toolName: string
  /** Number of calls to this tool */
  callCount: number
  /** Number of failed calls */
  failedCalls: number
  /** Failure rate as percentage (0-100) */
  failureRate: number
  /** Average latency in milliseconds */
  avgLatencyMs: number
  /** 95th percentile latency in milliseconds */
  p95LatencyMs: number | null
  /** Timestamp of the last call */
  lastCallAt: string | null
  /** Error code of the last error (if any) */
  lastError?: string
}

/**
 * Dashboard configuration from environment variables
 */
export interface DashboardConfig {
  /** Whether the dashboard is enabled */
  enabled: boolean
  /** Host to bind the dashboard server to */
  host: string
  /** Port to bind the dashboard server to */
  port: number
  /** UI locale inherited from RocKIT when the MCP server was launched */
  locale: 'en' | 'hu'
  /** Optional bearer token for authentication */
  authToken?: string
  /** Retention window in hours */
  retentionHours: number
  /** Whether to store full tool call parameters and results */
  detailedToolCallLogging: boolean
  /** Whether successful Dataverse uploads should keep generated RO-Crate ZIPs */
  keepDataverseUploadZips: boolean
}

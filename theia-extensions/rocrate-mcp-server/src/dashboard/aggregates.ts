// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

/**
 * Aggregation helpers for computing statistics from telemetry data
 */

import type {
  ToolCall,
  Session,
  DependencyUsage,
  SummaryStats,
  ToolStats,
} from './types'

/**
 * Calculates a percentile from an array of numbers
 * @param values - Array of numeric values
 * @param percentile - Percentile to calculate (0-100)
 * @returns The percentile value
 */
export function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) {
    return 0
  }

  const sorted = [...values].sort((a, b) => a - b)
  const index = (percentile / 100) * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)

  if (lower === upper) {
    return sorted[lower]
  }

  return sorted[lower] * (upper - index) + sorted[upper] * (index - lower)
}

/**
 * Calculates summary statistics from tool calls
 * @param toolCalls - All tool calls
 * @param sessions - All sessions
 * @param uptimeSeconds - Server uptime in seconds
 * @returns Summary statistics
 */
export function calculateSummaryStats(
  toolCalls: ToolCall[],
  sessions: Session[],
  uptimeSeconds: number,
): SummaryStats {
  const totalCalls = toolCalls.length
  const failedCalls = toolCalls.filter((tc) => tc.status === 'error').length
  const activeSessions = sessions.filter((s) => s.active).length

  // Calculate latencies for completed calls
  const completedCalls = toolCalls.filter(
    (tc) => tc.durationMs !== null && tc.durationMs >= 0,
  )
  const latencies = completedCalls.map((tc) => tc.durationMs!)

  const avgLatencyMs =
    latencies.length > 0
      ? latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length
      : 0

  const p95LatencyMs = latencies.length > 0 ? calculatePercentile(latencies, 95) : null

  const errorRate = totalCalls > 0 ? (failedCalls / totalCalls) * 100 : 0

  return {
    totalCalls,
    failedCalls,
    errorRate: Math.round(errorRate * 100) / 100,
    activeSessions,
    avgLatencyMs: Math.round(avgLatencyMs),
    p95LatencyMs: p95LatencyMs !== null ? Math.round(p95LatencyMs) : null,
    uptimeSeconds,
  }
}

/**
 * Groups tool calls by tool name and calculates per-tool statistics
 * @param toolCalls - All tool calls
 * @returns Map of tool name to stats
 */
export function calculateToolStats(toolCalls: ToolCall[]): Map<string, ToolStats> {
  const byTool = new Map<string, ToolCall[]>()

  // Group by tool name
  for (const call of toolCalls) {
    const existing = byTool.get(call.toolName) || []
    existing.push(call)
    byTool.set(call.toolName, existing)
  }

  const result = new Map<string, ToolStats>()

  for (const [toolName, calls] of byTool) {
    const callCount = calls.length
    const failedCalls = calls.filter((c) => c.status === 'error').length

    // Get completed calls with latencies
    const completedCalls = calls.filter(
      (c) => c.durationMs !== null && c.durationMs >= 0,
    )
    const latencies = completedCalls.map((c) => c.durationMs!)

    const avgLatencyMs =
      latencies.length > 0
        ? latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length
        : 0

    const p95LatencyMs = latencies.length > 0 ? calculatePercentile(latencies, 95) : null

    // Find the most recent call
    const lastCall = calls
      .filter((c) => c.finishedAt !== null)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]

    // Find the most recent error
    const lastError = calls
      .filter((c) => c.status === 'error')
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]

    const failureRate = callCount > 0 ? (failedCalls / callCount) * 100 : 0

    result.set(toolName, {
      toolName,
      callCount,
      failedCalls,
      failureRate: Math.round(failureRate * 100) / 100,
      avgLatencyMs: Math.round(avgLatencyMs),
      p95LatencyMs: p95LatencyMs !== null ? Math.round(p95LatencyMs) : null,
      lastCallAt: lastCall?.finishedAt || null,
      lastError: lastError?.errorCode,
    })
  }

  return result
}

/**
 * Formats a duration in seconds to a human-readable string
 * @param seconds - Duration in seconds
 * @returns Formatted duration string
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

/**
 * Formats a latency in milliseconds to a human-readable string
 * @param ms - Latency in milliseconds
 * @returns Formatted latency string
 */
export function formatLatency(ms: number | null): string {
  if (ms === null || ms === undefined) {
    return 'N/A'
  }

  if (ms < 1000) {
    return `${ms}ms`
  }

  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Formats an ISO timestamp to a relative time string
 * @param isoTimestamp - ISO timestamp string
 * @returns Relative time string (e.g., "5m ago", "2h ago")
 */
export function formatRelativeTime(isoTimestamp: string | null): string {
  if (!isoTimestamp) {
    return 'Never'
  }

  const now = Date.now()
  const then = new Date(isoTimestamp).getTime()
  const diffMs = now - then
  const diffSec = Math.floor(diffMs / 1000)

  if (diffSec < 60) {
    return `${diffSec}s ago`
  }

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) {
    return `${diffMin}m ago`
  }

  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) {
    return `${diffHour}h ago`
  }

  const diffDay = Math.floor(diffHour / 24)
  return `${diffDay}d ago`
}

/**
 * Formats a percentage with appropriate precision
 * @param value - Percentage value (0-100)
 * @returns Formatted percentage string
 */
export function formatPercentage(value: number): string {
  if (value < 0.1 && value > 0) {
    return '<0.1%'
  }

  if (value === 0) {
    return '0%'
  }

  if (value < 10) {
    return `${value.toFixed(2)}%`
  }

  return `${value.toFixed(1)}%`
}

/**
 * Converts dependency usage to a summary object
 * @param usage - Dependency usage stats
 * @returns Summary object for JSON serialization
 */
export function summarizeDependencyUsage(usage: DependencyUsage): Record<
  string,
  unknown
> {
  return {
    dependency: usage.dependency,
    callCount: usage.callCount,
    successRate:
      usage.callCount > 0
        ? ((usage.successCount / usage.callCount) * 100).toFixed(1) + '%'
        : 'N/A',
    avgLatency: formatLatency(usage.avgLatencyMs),
    lastCall: formatRelativeTime(usage.lastCallAt),
  }
}

/**
 * Filters tool calls by time window
 * @param toolCalls - All tool calls
 * @param minutesAgo - Filter to calls within this many minutes
 * @returns Filtered tool calls
 */
export function filterByTimeWindow(
  toolCalls: ToolCall[],
  minutesAgo: number,
): ToolCall[] {
  const cutoff = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString()

  return toolCalls.filter((tc) => tc.startedAt >= cutoff)
}

/**
 * Computes time-series data for a chart
 * @param toolCalls - All tool calls
 * @param intervalMinutes - Bucket interval in minutes
 * @returns Array of time-bucketed data points
 */
export interface TimeSeriesDataPoint {
  timestamp: string
  count: number
  errorCount: number
  avgLatencyMs: number
}

export function computeTimeSeries(
  toolCalls: ToolCall[],
  intervalMinutes: number = 5,
): TimeSeriesDataPoint[] {
  const buckets = new Map<string, { count: number; errorCount: number; totalLatency: number }>()

  for (const call of toolCalls) {
    // Round timestamp down to interval
    const date = new Date(call.startedAt)
    const minutes = Math.floor(date.getMinutes() / intervalMinutes) * intervalMinutes
    date.setMinutes(minutes, 0, 0)
    const bucketKey = date.toISOString()

    const bucket = buckets.get(bucketKey) || { count: 0, errorCount: 0, totalLatency: 0 }
    bucket.count++
    if (call.status === 'error') {
      bucket.errorCount++
    }
    if (call.durationMs !== null) {
      bucket.totalLatency += call.durationMs
    }
    buckets.set(bucketKey, bucket)
  }

  // Convert to array and sort
  const result: TimeSeriesDataPoint[] = []
  for (const [timestamp, data] of buckets) {
    result.push({
      timestamp,
      count: data.count,
      errorCount: data.errorCount,
      avgLatencyMs: data.count > 0 ? Math.round(data.totalLatency / data.count) : 0,
    })
  }

  return result.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

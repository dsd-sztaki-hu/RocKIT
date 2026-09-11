/**
 * Sanitization and redaction helpers for telemetry data
 * Ensures sensitive data is not stored and data size is bounded
 */

import type { ErrorEvent } from './types'

/**
 * Maximum length for error messages
 */
const DEFAULT_MAX_ERROR_MESSAGE_LENGTH = 500

/**
 * Patterns that might indicate sensitive data in error messages
 */
const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /authorization/i,
  /bearer/i,
  /session/i,
  /cookie/i,
]

function isSensitiveFieldName(key: string): boolean {
  const normalized = key.replace(/[-_]/g, '').toLowerCase()
  return (
    normalized === 'apikey' ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('token') ||
    normalized.endsWith('password') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('authorization') ||
    normalized.endsWith('cookie')
  )
}

/**
 * Redacts sensitive values in JSON-like tool arguments before detailed
 * telemetry stores them. This keeps direct API-key overrides out of the
 * dashboard while leaving the live request untouched.
 */
export function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValues(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        isSensitiveFieldName(key) ? '[REDACTED]' : redactSensitiveValues(nested),
      ]),
    )
  }
  return value
}

/**
 * Truncates an error message to a maximum length
 * @param message - The error message to truncate
 * @param maxLength - Maximum length (default: 500)
 * @returns Truncated message with ellipsis if needed
 */
export function truncateErrorMessage(
  message: string,
  maxLength: number = DEFAULT_MAX_ERROR_MESSAGE_LENGTH,
): string {
  if (!message || typeof message !== 'string') {
    return ''
  }

  // Remove common stack trace indicators
  const lines = message.split('\n')
  const messageLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    // Stop at stack trace
    if (trimmed.startsWith('at ') || /^\s+[\w./]+$/.test(trimmed)) {
      break
    }

    messageLines.push(trimmed)

    // Limit to first few lines of the actual message
    if (messageLines.length >= 3) {
      break
    }
  }

  let result = messageLines.join(' ').slice(0, maxLength)

  // Redact potential sensitive values
  for (const pattern of SENSITIVE_PATTERNS) {
    // Look for patterns like "password: value" or "secret=value"
    result = result.replace(
      new RegExp(`(${pattern.source}\\s*[:=]\\s*)([^\\s,}]+)`, 'gi'),
      '$1[REDACTED]',
    )
  }

  if (message.length > maxLength || messageLines.join(' ').length > maxLength) {
    result += '...'
  }

  return result
}

/**
 * Calculates the size of a value in bytes (for JSON payload size tracking)
 * We don't store the actual payload, just its size
 * @param value - The value to measure
 * @returns Size in bytes
 */
export function calculateSizeBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value || {}), 'utf8')
  } catch {
    return 0
  }
}

/**
 * Sanitizes a tool name to prevent injection attacks
 * @param toolName - The tool name to sanitize
 * @returns Sanitized tool name
 */
export function sanitizeToolName(toolName: string): string {
  if (!toolName || typeof toolName !== 'string') {
    return 'unknown'
  }

  // Only allow alphanumeric, underscore, dash, and dot
  return toolName.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

/**
 * Sanitizes an error code for safe storage
 * @param errorCode - The error code to sanitize
 * @returns Sanitized error code
 */
export function sanitizeErrorCode(errorCode: string | number | unknown): string {
  if (typeof errorCode === 'number') {
    return `ERR_${errorCode}`
  }

  if (typeof errorCode === 'string') {
    // Remove any non-alphanumeric characters except underscore and dash
    return errorCode.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50)
  }

  return 'UNKNOWN_ERROR'
}

/**
 * Redacts a URL query string for safe logging
 * @param url - The URL to redact
 * @returns URL with query parameters redacted
 */
export function redactUrlQuery(url: string): string {
  try {
    const urlObj = new URL(url)
    urlObj.search = '?[REDACTED]'
    return urlObj.toString()
  } catch {
    // If URL parsing fails, just return a placeholder
    return '[URL]'
  }
}

/**
 * Creates a sanitized error event
 * @param sessionId - Session ID
 * @param toolName - Tool name (optional)
 * @param error - The error object
 * @returns Sanitized error event
 */
export function createSanitizedErrorEvent(
  sessionId: string,
  toolName: string | undefined,
  error: unknown,
): Omit<ErrorEvent, 'id' | 'timestamp'> {
  let errorCode = 'UNKNOWN_ERROR'
  let messageShort = 'An unknown error occurred'

  if (error instanceof Error) {
    errorCode = sanitizeErrorCode(error.name || 'Error')
    messageShort = truncateErrorMessage(error.message)
  } else if (typeof error === 'string') {
    messageShort = truncateErrorMessage(error)
  } else if (error && typeof error === 'object') {
    // Try to extract code and message from object
    const err = error as Record<string, unknown>
    errorCode = sanitizeErrorCode(err.code || err.errorCode || 'ERROR')
    messageShort = truncateErrorMessage(
      String(err.message || err.errorMessage || err.error || 'Unknown error'),
    )
  }

  return {
    sessionId,
    toolName: toolName ? sanitizeToolName(toolName) : undefined,
    errorCode,
    messageShort,
  }
}

/**
 * Validates and sanitizes tool call arguments for size tracking
 * @param args - Tool call arguments
 * @returns Size in bytes
 */
export function sanitizeAndMeasureArgs(args: unknown): number {
  const size = calculateSizeBytes(args)

  // Cap at a reasonable maximum (10MB)
  return Math.min(size, 10 * 1024 * 1024)
}

/**
 * Creates a safe summary string from any value
 * @param value - The value to summarize
 * @param maxLength - Maximum length
 * @returns Safe summary string
 */
export function createSafeSummary(value: unknown, maxLength = 200): string {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value.slice(0, maxLength)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return `[Array(${value.length})]`
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value as object).slice(0, 5)
    return `{Object: ${keys.join(', ')}}`
  }

  return String(value).slice(0, maxLength)
}

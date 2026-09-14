// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

/**
 * Tests for the dashboard telemetry collector
 */

const assert = require('node:assert/strict')

// Mock the dashboard module for testing
async function testCollector() {
  console.log('Testing dashboard telemetry collector...')

  // Import the collector module
  const { TelemetryCollector, resetGlobalCollector, getGlobalCollector } = await import(
    '../lib/dashboard/collector.js'
  )

  // Reset to ensure clean state
  resetGlobalCollector()

  // Create a new collector
  const collector = new TelemetryCollector({
    maxSessions: 10,
    maxToolCalls: 100,
    maxErrors: 50,
    retentionHours: 1,
  })

  // Test session creation
  console.log('  Testing session creation...')
  const session1 = collector.getOrCreateSession('content-length')
  assert.strictEqual(typeof session1.id, 'string')
  assert.strictEqual(session1.transportMode, 'content-length')
  assert.strictEqual(session1.active, true)
  assert.strictEqual(session1.requestCount, 0)

  // Test session reuse
  const session2 = collector.getOrCreateSession('content-length')
  assert.strictEqual(session2.id, session1.id, 'Should reuse active session')

  // Test tool call tracking
  console.log('  Testing tool call tracking...')
  const testArgs = { arg1: 'value1', apiKey: 'super-secret' }
  const toolCallId = collector.startToolCall('test_tool', testArgs)
  assert.strictEqual(typeof toolCallId, 'string')

  const toolCalls = collector.getToolCalls()
  assert.strictEqual(toolCalls.length, 1)
  assert.strictEqual(toolCalls[0].toolName, 'test_tool')
  assert.strictEqual(toolCalls[0].status, 'started')
  assert.strictEqual(toolCalls[0].argsSizeBytes, JSON.stringify(testArgs).length)
  assert.strictEqual(toolCalls[0].params.includes('super-secret'), false)
  assert.strictEqual(toolCalls[0].params.includes('[REDACTED]'), true)

  // Test tool call completion - success
  console.log('  Testing tool call completion (success)...')

  // Wait a bit to get a measurable duration
  await new Promise((resolve) => setTimeout(resolve, 10))

  collector.completeToolCallSuccess(toolCallId)
  const completedCall = collector.getToolCalls()[0]
  assert.strictEqual(completedCall.status, 'success')
  assert.strictEqual(completedCall.finishedAt !== null, true)
  assert.strictEqual(completedCall.durationMs !== null, true)

  // Test tool call completion - error
  console.log('  Testing tool call completion (error)...')
  const errorCallId = collector.startToolCall('error_tool', {})
  collector.completeToolCallError(errorCallId, new Error('Test error'))

  const errorCall = collector.getToolCalls().find((tc) => tc.id === errorCallId)
  assert.strictEqual(errorCall.status, 'error')
  assert.strictEqual(errorCall.errorCode, 'Error')

  const errors = collector.getErrors()
  assert.strictEqual(errors.length >= 1, true)
  assert.strictEqual(errors[0].errorCode, 'Error')

  // Test dependency usage tracking
  console.log('  Testing dependency usage tracking...')
  collector.recordDependencyCall('tavily', true, 150)
  collector.recordDependencyCall('tavily', false, 200)
  collector.recordDependencyCall('dataverse', true, 300)

  const deps = collector.getDependencyUsage()
  assert.strictEqual(deps.length, 2)

  const tavily = deps.find((d) => d.dependency === 'tavily')
  assert.strictEqual(tavily.callCount, 2)
  assert.strictEqual(tavily.successCount, 1)
  assert.strictEqual(tavily.failureCount, 1)
  assert.strictEqual(tavily.lastCallAt !== null, true)

  // Test tool call HTTP logging and async-scoped context
  console.log('  Testing HTTP exchange logging...')
  const httpCallId = collector.startToolCall('upload_rocrate_to_dataverse', { pid: 'doi:test' })
  await collector.runWithToolCallContext(httpCallId, async () => {
    assert.strictEqual(collector.getCurrentToolCallId(), httpCallId)
    collector.appendToolCallHttpLog(httpCallId, {
      timestamp: new Date().toISOString(),
      dependency: 'dataverse',
      request: {
        method: 'POST',
        url: 'https://example.test/api/arp/uploadRoCrateZip',
        headers: { 'x-dataverse-key': '[REDACTED]' },
        body: 'multipart/form-data upload: temp-zip-path=/tmp/rocrate-dataverse-upload-123/rocrate.zip; content omitted',
      },
      response: {
        status: 200,
        ok: true,
        url: 'https://example.test/api/arp/uploadRoCrateZip',
        headers: { 'content-type': 'application/json' },
        body: '{"status":"ok"}',
      },
    })
  })
  collector.completeToolCallSuccess(httpCallId)
  const httpCall = collector.getToolCalls().find((tc) => tc.id === httpCallId)
  assert.strictEqual(Array.isArray(httpCall.httpLogs), true)
  assert.strictEqual(httpCall.httpLogs.length, 1)
  assert.strictEqual(httpCall.httpLogs[0].dependency, 'dataverse')
  assert.strictEqual(httpCall.httpLogs[0].request.body.includes('content omitted'), true)
  assert.strictEqual(httpCall.httpLogs[0].request.body.includes('temp-zip-path='), true)
  assert.strictEqual(collector.getCurrentToolCallId(), undefined)

  // Test session stats
  console.log('  Testing session stats...')
  const stats = collector.getStats()
  assert.strictEqual(stats.sessionCount, 1)
  assert.strictEqual(stats.toolCallCount, 3) // 2 success, 1 error
  assert.strictEqual(stats.errorCount, 1)
  assert.strictEqual(stats.dependencyCount, 2)

  // Test tool calls for session
  console.log('  Testing session tool calls...')
  const sessionCalls = collector.getToolCallsForSession(session1.id)
  assert.strictEqual(sessionCalls.length, 3)

  // Test per-connection session keys
  console.log('  Testing session keys...')
  const callA = collector.startToolCall('tool_a', {}, 'conn-a', 'content-length')
  collector.completeToolCallSuccess(callA)
  const callB = collector.startToolCall('tool_b', {}, 'conn-b', 'content-length')
  collector.completeToolCallSuccess(callB)
  assert.notStrictEqual(
    collector.getToolCalls().find((tc) => tc.id === callA)?.sessionId,
    collector.getToolCalls().find((tc) => tc.id === callB)?.sessionId,
    'Different session keys should map to different sessions',
  )
  collector.deactivateSession('conn-a')
  const callC = collector.startToolCall('tool_c', {}, 'conn-a', 'content-length')
  assert.notStrictEqual(
    collector.getToolCalls().find((tc) => tc.id === callA)?.sessionId,
    collector.getToolCalls().find((tc) => tc.id === callC)?.sessionId,
    'Deactivated session key should create a new session',
  )

  // Test cleanup
  console.log('  Testing cleanup...')
  collector.performPeriodicCleanup()

  // Test global collector
  console.log('  Testing global collector...')
  const global = getGlobalCollector()
  assert.strictEqual(global instanceof TelemetryCollector, true)

  console.log('✓ All collector tests passed')
}

async function testSanitize() {
  console.log('Testing dashboard sanitize helpers...')

  const {
    truncateErrorMessage,
    calculateSizeBytes,
    sanitizeToolName,
    sanitizeErrorCode,
    createSanitizedErrorEvent,
    redactSensitiveValues,
  } = await import('../lib/dashboard/sanitize.js')

  // Test truncateErrorMessage
  console.log('  Testing truncateErrorMessage...')
  const longMessage = 'x'.repeat(1000)
  const truncated = truncateErrorMessage(longMessage, 100)
  assert.strictEqual(truncated.length, 103) // 100 + '...'

  const withSensitive = 'password=secret123 token=abc123'
  const redacted = truncateErrorMessage(withSensitive, 100)
  assert.strictEqual(redacted.includes('secret123'), false)
  assert.strictEqual(redacted.includes('[REDACTED]'), true)

  // Test calculateSizeBytes
  console.log('  Testing calculateSizeBytes...')
  const size = calculateSizeBytes({ foo: 'bar', baz: [1, 2, 3] })
  assert.strictEqual(typeof size, 'number')
  assert.strictEqual(size > 0, true)

  // Test sanitizeToolName
  console.log('  Testing sanitizeToolName...')
  assert.strictEqual(sanitizeToolName('test_tool'), 'test_tool')
  assert.strictEqual(sanitizeToolName('test tool'), 'test_tool')
  assert.strictEqual(sanitizeToolName('test<script>'), 'test_script_')

  // Test sanitizeErrorCode
  console.log('  Testing sanitizeErrorCode...')
  assert.strictEqual(sanitizeErrorCode('ERROR_CODE'), 'ERROR_CODE')
  assert.strictEqual(sanitizeErrorCode(404), 'ERR_404')
  assert.strictEqual(sanitizeErrorCode('test/code'), 'test_code')
  assert.deepStrictEqual(
    redactSensitiveValues({
      apiKey: 'hidden',
      apiKeyProvided: true,
      nested: { token: 'also-hidden' },
    }),
    { apiKey: '[REDACTED]', apiKeyProvided: true, nested: { token: '[REDACTED]' } },
  )

  // Test createSanitizedErrorEvent
  console.log('  Testing createSanitizedErrorEvent...')
  const error = new Error('Test error with password=secret')
  const sanitized = createSanitizedErrorEvent('session-1', 'test_tool', error)
  assert.strictEqual(sanitized.sessionId, 'session-1')
  assert.strictEqual(sanitized.toolName, 'test_tool')
  assert.strictEqual(sanitized.errorCode, 'Error')
  assert.strictEqual(sanitized.messageShort.includes('secret'), false)

  console.log('✓ All sanitize tests passed')
}

async function testAggregates() {
  console.log('Testing dashboard aggregates...')

  const {
    calculatePercentile,
    calculateSummaryStats,
    calculateToolStats,
    formatDuration,
    formatLatency,
    formatRelativeTime,
  } = await import('../lib/dashboard/aggregates.js')

  // Test calculatePercentile
  console.log('  Testing calculatePercentile...')
  assert.strictEqual(calculatePercentile([], 50), 0)
  assert.strictEqual(calculatePercentile([1, 2, 3, 4, 5], 50), 3)
  assert.strictEqual(calculatePercentile([1, 2, 3, 4, 5], 95), 4.8)

  // Test calculateSummaryStats
  console.log('  Testing calculateSummaryStats...')
  const toolCalls = [
    {
      id: '1',
      sessionId: 's1',
      toolName: 'tool1',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 100,
      status: 'success',
      argsSizeBytes: 100,
    },
    {
      id: '2',
      sessionId: 's1',
      toolName: 'tool1',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 200,
      status: 'error',
      argsSizeBytes: 100,
    },
  ]

  const sessions = [
    {
      id: 's1',
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      transportMode: 'content-length',
      requestCount: 2,
      errorCount: 1,
      active: true,
    },
  ]

  const stats = calculateSummaryStats(toolCalls, sessions, 60)
  assert.strictEqual(stats.totalCalls, 2)
  assert.strictEqual(stats.failedCalls, 1)
  assert.strictEqual(stats.errorRate, 50)
  assert.strictEqual(stats.activeSessions, 1)

  // Test calculateToolStats
  console.log('  Testing calculateToolStats...')
  const toolStats = calculateToolStats(toolCalls)
  assert.strictEqual(toolStats.size, 1)
  const tool1Stats = toolStats.get('tool1')
  assert.strictEqual(tool1Stats.callCount, 2)
  assert.strictEqual(tool1Stats.failedCalls, 1)
  assert.strictEqual(tool1Stats.failureRate, 50)

  // Test formatters
  console.log('  Testing formatters...')
  assert.strictEqual(formatDuration(30), '30s')
  assert.strictEqual(formatDuration(90), '1m 30s')
  assert.strictEqual(formatDuration(3661), '1h 1m')

  assert.strictEqual(formatLatency(100), '100ms')
  assert.strictEqual(formatLatency(1500), '1.5s')
  assert.strictEqual(formatLatency(null), 'N/A')

  console.log('✓ All aggregates tests passed')
}

async function main() {
  try {
    await testCollector()
    await testSanitize()
    await testAggregates()
    console.log('\n✅ All dashboard tests passed!')
    process.exit(0)
  } catch (err) {
    console.error('\n❌ Test failed:', err)
    process.exit(1)
  }
}

main()

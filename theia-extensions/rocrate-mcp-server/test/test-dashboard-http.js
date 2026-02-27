/**
 * Tests for the dashboard HTTP server
 */

const assert = require('node:assert/strict')
const http = require('node:http')

async function testHttpServer() {
  console.log('Testing dashboard HTTP server...')

  // Import modules
  const { TelemetryCollector } = await import('../lib/dashboard/collector.js')
  const { DashboardHttpServer } = await import('../lib/dashboard/http-server.js')

  // Create a collector with some test data
  const collector = new TelemetryCollector({
    maxSessions: 10,
    maxToolCalls: 100,
    maxErrors: 50,
    retentionHours: 1,
  })

  // Add some test data
  const session = collector.getOrCreateSession('content-length')
  const toolCallId = collector.startToolCall('test_tool', { arg1: 'value1' })
  collector.completeToolCallSuccess(toolCallId)
  collector.recordDependencyCall('tavily', true, 150)

  // Find an available port
  const getPort = () =>
    new Promise((resolve) => {
      const server = http.createServer()
      server.listen(0, () => {
        const port = server.address().port
        server.close(() => resolve(port))
      })
    })

  const port = await getPort()

  // Create and start the HTTP server
  const dashboard = new DashboardHttpServer(collector, {
    enabled: true,
    host: '127.0.0.1',
    port,
    retentionHours: 1,
  })

  await dashboard.start()

  console.log(`  Dashboard server listening on port ${port}`)

  // Helper to make HTTP requests
  const get = (path) =>
    new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
      }

      const req = http.get(options, (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, data })
        })
      })

      req.on('error', reject)
      req.setTimeout(5000, () => {
        req.destroy()
        reject(new Error('Request timeout'))
      })
    })

  try {
    // Test /health endpoint
    console.log('  Testing /health endpoint...')
    const healthResp = await get('/health')
    assert.strictEqual(healthResp.status, 200)
    assert.strictEqual(healthResp.headers['content-type'], 'application/json')
    const healthData = JSON.parse(healthResp.data)
    assert.strictEqual(healthData.status, 'ok')
    assert.strictEqual(typeof healthData.uptime, 'number')

    // Test /metrics/summary endpoint
    console.log('  Testing /metrics/summary endpoint...')
    const summaryResp = await get('/metrics/summary')
    assert.strictEqual(summaryResp.status, 200)
    const summaryData = JSON.parse(summaryResp.data)
    assert.strictEqual(typeof summaryData.totalCalls, 'number')
    assert.strictEqual(typeof summaryData.errorRate, 'number')
    assert.strictEqual(typeof summaryData.activeSessions, 'number')

    // Test /metrics/tools endpoint
    console.log('  Testing /metrics/tools endpoint...')
    const toolsResp = await get('/metrics/tools')
    assert.strictEqual(toolsResp.status, 200)
    const toolsData = JSON.parse(toolsResp.data)
    assert.strictEqual(Array.isArray(toolsData.tools), true)

    // Test /sessions endpoint
    console.log('  Testing /sessions endpoint...')
    const sessionsResp = await get('/sessions')
    assert.strictEqual(sessionsResp.status, 200)
    const sessionsData = JSON.parse(sessionsResp.data)
    assert.strictEqual(Array.isArray(sessionsData.sessions), true)
    assert.strictEqual(sessionsData.sessions.length >= 1, true)

    // Test /sessions/:id endpoint
    if (sessionsData.sessions.length > 0) {
      const sessionId = sessionsData.sessions[0].id
      const sessionDetailResp = await get(`/sessions/${sessionId}`)
      assert.strictEqual(sessionDetailResp.status, 200)
      const sessionDetailData = JSON.parse(sessionDetailResp.data)
      assert.strictEqual(sessionDetailData.session.id, sessionId)
    }

    // Test /errors/recent endpoint
    console.log('  Testing /errors/recent endpoint...')
    const errorsResp = await get('/errors/recent?limit=10')
    assert.strictEqual(errorsResp.status, 200)
    const errorsData = JSON.parse(errorsResp.data)
    assert.strictEqual(Array.isArray(errorsData.errors), true)

    // Test /dependencies endpoint
    console.log('  Testing /dependencies endpoint...')
    const depsResp = await get('/dependencies')
    assert.strictEqual(depsResp.status, 200)
    const depsData = JSON.parse(depsResp.data)
    assert.strictEqual(Array.isArray(depsData.dependencies), true)
    assert.strictEqual(depsData.dependencies.length >= 1, true)

    const tavily = depsData.dependencies.find((d) => d.dependency === 'tavily')
    assert.strictEqual(tavily !== undefined, true)

    // Test CORS headers
    console.log('  Testing CORS headers...')
    const corsResp = await get('/health')
    assert.strictEqual(corsResp.headers['access-control-allow-origin'], '*')

    // Test OPTIONS method
    console.log('  Testing OPTIONS method...')
    const optionsResp = await new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port,
        path: '/health',
        method: 'OPTIONS',
      }

      const req = http.request(options, (res) => {
        resolve({ status: res.statusCode, headers: res.headers })
      })

      req.on('error', reject)
      req.setTimeout(5000, () => {
        req.destroy()
        reject(new Error('Request timeout'))
      })
      req.end()
    })
    assert.strictEqual(optionsResp.status, 200)

    // Test 404 for unknown endpoint
    console.log('  Testing 404 for unknown endpoint...')
    const notFoundResp = await get('/unknown')
    assert.strictEqual(notFoundResp.status, 404)

    console.log('✓ All HTTP server tests passed')
  } finally {
    // Stop the dashboard server
    await dashboard.stop()
  }
}

async function testAuth() {
  console.log('Testing dashboard authentication...')

  const { TelemetryCollector } = await import('../lib/dashboard/collector.js')
  const { DashboardHttpServer } = await import('../lib/dashboard/http-server.js')

  const collector = new TelemetryCollector()

  const getPort = () =>
    new Promise((resolve) => {
      const server = http.createServer()
      server.listen(0, () => {
        const port = server.address().port
        server.close(() => resolve(port))
      })
    })

  const port = await getPort()

  // Create server with auth token
  const dashboard = new DashboardHttpServer(collector, {
    enabled: true,
    host: '127.0.0.1',
    port,
    authToken: 'test-token-123',
    retentionHours: 1,
  })

  await dashboard.start()

  // Helper to make HTTP requests with auth
  const get = (path, token = null) =>
    new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: {},
      }

      if (token) {
        options.headers['Authorization'] = `Bearer ${token}`
      }

      const req = http.get(options, (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          resolve({ status: res.statusCode, data })
        })
      })

      req.on('error', reject)
      req.setTimeout(5000, () => {
        req.destroy()
        reject(new Error('Request timeout'))
      })
    })

  try {
    // Test without auth - should fail
    console.log('  Testing without auth token...')
    const noAuthResp = await get('/health')
    assert.strictEqual(noAuthResp.status, 401)

    // Test with wrong auth - should fail
    console.log('  Testing with wrong auth token...')
    const wrongAuthResp = await get('/health', 'wrong-token')
    assert.strictEqual(wrongAuthResp.status, 401)

    // Test with correct auth - should succeed
    console.log('  Testing with correct auth token...')
    const correctAuthResp = await get('/health', 'test-token-123')
    assert.strictEqual(correctAuthResp.status, 200)

    console.log('✓ All auth tests passed')
  } finally {
    await dashboard.stop()
  }
}

async function main() {
  try {
    await testHttpServer()
    await testAuth()
    console.log('\n✅ All dashboard HTTP tests passed!')
    process.exit(0)
  } catch (err) {
    console.error('\n❌ Test failed:', err)
    process.exit(1)
  }
}

main()

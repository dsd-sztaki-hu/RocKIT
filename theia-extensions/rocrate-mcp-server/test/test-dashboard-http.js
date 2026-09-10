/**
 * Tests for the dashboard HTTP server
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

async function testHttpServer() {
  console.log('Testing dashboard HTTP server...')

  const originalDataverseBaseUrl = process.env.DATAVERSE_BASE_URL
  const originalDataverseApiKey = process.env.DATAVERSE_API_KEY
  const originalKeepUploadZips = process.env.ROCRATE_DATAVERSE_KEEP_UPLOAD_ZIPS
  const originalDashboardPort = process.env.ROCRATE_DASHBOARD_PORT
  const originalDashboardEnabled = process.env.ROCRATE_DASHBOARD_ENABLED
  const originalBridgeEnabled = process.env.ROCRATE_LOCAL_FILE_BRIDGE_ENABLED
  const originalAllowedOrigins = process.env.ROCRATE_LOCAL_FILE_BRIDGE_ALLOWED_ORIGINS
  const originalRockitRootPath = process.env.ROCKIT_ROOT_PATH
  const originalAromaRootPath = process.env.AROMA_ROOT_PATH
  const originalRockitProviderConfigFile = process.env.ROCKIT_REMOTE_SCHEMA_PROVIDER_CONFIG_FILE
  const originalAromaProviderConfigFile = process.env.AROMA_REMOTE_SCHEMA_PROVIDER_CONFIG_FILE
  const originalRockitProviderKeytarService = process.env.ROCKIT_REMOTE_SCHEMA_PROVIDER_KEYTAR_SERVICE
  const originalAromaProviderKeytarService = process.env.AROMA_REMOTE_SCHEMA_PROVIDER_KEYTAR_SERVICE
  process.env.DATAVERSE_BASE_URL = 'https://dataverse.example.test/'
  process.env.DATAVERSE_API_KEY = 'test-dataverse-key'
  delete process.env.ROCRATE_DATAVERSE_KEEP_UPLOAD_ZIPS
  delete process.env.ROCRATE_DASHBOARD_ENABLED
  delete process.env.ROCRATE_LOCAL_FILE_BRIDGE_ENABLED

  // Import modules
  const { TelemetryCollector } = await import('../lib/dashboard/collector.js')
  const { DashboardHttpServer } = await import('../lib/dashboard/http-server.js')
  const { registerLocalFileForAroma } = await import('../lib/dashboard/local-file-bridge.js')

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
  collector.appendToolCallHttpLog(toolCallId, {
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
  collector.addToolCallArtifact(toolCallId, {
    label: 'Dataverse upload ZIP',
    path: '/tmp/rocrate-dataverse-upload-test/rocrate.zip',
  })
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
  process.env.ROCRATE_DASHBOARD_PORT = String(port)
  const profileRootPath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rocrate-dashboard-rockit-'),
  )
  process.env.ROCKIT_ROOT_PATH = profileRootPath
  process.env.ROCKIT_REMOTE_SCHEMA_PROVIDER_CONFIG_FILE = 'remote-schema-providers.json'
  process.env.ROCKIT_REMOTE_SCHEMA_PROVIDER_KEYTAR_SERVICE = 'RocKIT.RemoteSchemaProvider'
  delete process.env.AROMA_ROOT_PATH
  delete process.env.AROMA_REMOTE_SCHEMA_PROVIDER_CONFIG_FILE
  delete process.env.AROMA_REMOTE_SCHEMA_PROVIDER_KEYTAR_SERVICE

  let shutdownRequested = false

  // Create and start the HTTP server
  const dashboard = new DashboardHttpServer(collector, {
    enabled: true,
    host: '127.0.0.1',
    port,
    retentionHours: 1,
  }, {
    _schemas: [],
    _storage: { mode: 'local', directory: '/tmp/test', filePath: '/tmp/test/registry.json' },
    list() {
      return { storage: this._storage, schemas: [...this._schemas] }
    },
    register(mode, input) {
      this._schemas = this._schemas.filter((entry) => entry.id !== input.id)
      this._schemas.push({
        id: input.id,
        displayName: input.displayName,
        matchesUrls: input.matchesUrls,
        schemaUrl: input.schemaUrl,
        activeOnSpec: input.activeOnSpec || ['v1.1.3', 'v1.2.0'],
      })
      return { storage: this._storage, schemas: [...this._schemas] }
    },
    update(mode, input) {
      const idx = this._schemas.findIndex((entry) => entry.id === input.id)
      if (idx < 0) throw new Error('Schema not found')
      this._schemas[idx] = { ...this._schemas[idx], ...input }
      return { storage: this._storage, schemas: [...this._schemas] }
    },
    remove(mode, id) {
      this._schemas = this._schemas.filter((entry) => entry.id !== id)
      return { storage: this._storage, schemas: [...this._schemas] }
    },
  }, () => {
    shutdownRequested = true
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

  const requestWithBody = (method, reqPath, bodyObj, extraHeaders = {}) =>
    new Promise((resolve, reject) => {
      const body = bodyObj ? JSON.stringify(bodyObj) : ''
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: reqPath,
          method,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            ...extraHeaders,
          },
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => {
            data += chunk
          })
          res.on('end', () => {
            resolve({ status: res.statusCode, headers: res.headers, data })
          })
        },
      )
      req.on('error', reject)
      req.setTimeout(5000, () => {
        req.destroy()
        reject(new Error('Request timeout'))
      })
      req.write(body)
      req.end()
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

    // Test the protected graceful-shutdown request endpoint without stopping
    // this test process; the injected handler records the request instead.
    console.log('  Testing /daemon/shutdown endpoint...')
    const shutdownResp = await requestWithBody('POST', '/daemon/shutdown', null)
    assert.strictEqual(shutdownResp.status, 202)
    const shutdownData = JSON.parse(shutdownResp.data)
    assert.strictEqual(shutdownData.success, true)
    assert.strictEqual(shutdownData.status, 'shutting-down')
    await new Promise((resolve) => setImmediate(resolve))
    assert.strictEqual(shutdownRequested, true)

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

    // Test /tool-calls/:id endpoint includes HTTP logs
    console.log('  Testing /tool-calls/:id endpoint...')
    const toolCallResp = await get(`/tool-calls/${toolCallId}`)
    assert.strictEqual(toolCallResp.status, 200)
    const toolCallData = JSON.parse(toolCallResp.data)
    assert.strictEqual(toolCallData.toolCall.id, toolCallId)
    assert.strictEqual(Array.isArray(toolCallData.toolCall.httpLogs), true)
    assert.strictEqual(toolCallData.toolCall.httpLogs.length, 1)
    assert.strictEqual(toolCallData.toolCall.httpLogs[0].dependency, 'dataverse')
    assert.strictEqual(toolCallData.toolCall.artifacts.length, 1)
    assert.strictEqual(
      toolCallData.toolCall.artifacts[0].path,
      '/tmp/rocrate-dataverse-upload-test/rocrate.zip',
    )
    assert.strictEqual(
      toolCallData.toolCall.httpLogs[0].request.body.includes('content omitted'),
      true,
    )
    assert.strictEqual(
      toolCallData.toolCall.httpLogs[0].request.body.includes('temp-zip-path='),
      true,
    )

    // Test /config endpoint includes Dataverse upload tool configuration
    console.log('  Testing /config Dataverse settings...')
    const configResp = await get('/config')
    assert.strictEqual(configResp.status, 200)
    const configData = JSON.parse(configResp.data)
    assert.strictEqual(
      configData.dataverse.baseUrl,
      'https://dataverse.example.test',
    )
    assert.strictEqual(configData.dataverse.baseUrlSource, 'env')
    assert.strictEqual(configData.dataverse.apiKey, 'test-dataverse-key')
    assert.strictEqual(configData.dataverse.apiKeySource, 'env')
    assert.strictEqual(configData.keepDataverseUploadZips, false)
    const configUpdateResp = await requestWithBody('POST', '/config', {
      detailedToolCallLogging: true,
      keepDataverseUploadZips: true,
      retentionHours: 2,
    })
    assert.strictEqual(configUpdateResp.status, 200)
    const configUpdateData = JSON.parse(configUpdateResp.data)
    assert.strictEqual(configUpdateData.config.keepDataverseUploadZips, true)
    assert.strictEqual(process.env.ROCRATE_DATAVERSE_KEEP_UPLOAD_ZIPS, 'true')

    // Test metadata profile endpoints
    console.log('  Testing /metadata-profiles endpoints...')
    const profileStatusResp = await get('/metadata-profiles/storage-status')
    assert.strictEqual(profileStatusResp.status, 200)
    const profileStatus = JSON.parse(profileStatusResp.data)
    assert.strictEqual(profileStatus.storage.rootPath, profileRootPath)

    const profilesResp = await get('/metadata-profiles')
    assert.strictEqual(profilesResp.status, 200)
    const profilesData = JSON.parse(profilesResp.data)
    assert.strictEqual(Array.isArray(profilesData.profiles), true)

    const providersResp = await get('/metadata-profiles/providers')
    assert.strictEqual(providersResp.status, 200)
    const providersData = JSON.parse(providersResp.data)
    assert.strictEqual(Array.isArray(providersData.providers), true)
    assert.strictEqual(providersData.providers[0].id, 'arp-prod')
    assert.strictEqual(
      fs.existsSync(path.join(profileRootPath, 'remote-schema-providers.json')),
      true,
    )
    assert.strictEqual(
      JSON.parse(
        fs.readFileSync(path.join(profileRootPath, 'remote-schema-providers.json'), 'utf8'),
      )[0].id,
      'arp-prod',
    )

    const saveProviderResp = await requestWithBody('POST', '/metadata-profiles/providers', {
      id: 'saved-provider',
      title: 'Saved Provider',
      baseUrl: 'https://saved.example.test/',
      domainBase: 'saved.example.test',
      apiKey: 'must-not-leak',
    })
    assert.strictEqual(saveProviderResp.status, 200)
    const savedProviderData = JSON.parse(saveProviderResp.data)
    assert.strictEqual(
      savedProviderData.providers.some((provider) => provider.id === 'saved-provider'),
      true,
    )
    assert.strictEqual(
      savedProviderData.providers.some((provider) => provider.apiKey === 'must-not-leak'),
      false,
    )

    const deleteProviderResp = await requestWithBody(
      'DELETE',
      '/metadata-profiles/providers/saved-provider',
      {},
    )
    assert.strictEqual(deleteProviderResp.status, 200)
    const deletedProviderData = JSON.parse(deleteProviderResp.data)
    assert.strictEqual(deletedProviderData.deleted, true)

    const remoteFolderResp = await get('/metadata-profiles/remote-folder?providerId=missing-provider')
    assert.strictEqual(remoteFolderResp.status, 400)
    assert.strictEqual(
      JSON.parse(remoteFolderResp.data).error.includes('Unknown CEDAR provider'),
      true,
    )

    // Test schema registry endpoints
    console.log('  Testing /schema-registry endpoints...')
    const listBefore = await get('/schema-registry')
    assert.strictEqual(listBefore.status, 200)
    const listBeforeData = JSON.parse(listBefore.data)
    assert.strictEqual(Array.isArray(listBeforeData.schemas), true)

    const registerResp = await requestWithBody('POST', '/schema-registry', {
      mode: 'local',
      id: 'example',
      displayName: 'Example Schema',
      matchesUrls: ['https://example.org/'],
      schemaUrl: 'https://example.org/schema.jsonld',
    })
    assert.strictEqual(registerResp.status, 200)

    const updateResp = await requestWithBody('PUT', '/schema-registry/example', {
      mode: 'local',
      displayName: 'Example Schema Updated',
    })
    assert.strictEqual(updateResp.status, 200)

    const deleteResp = await requestWithBody(
      'DELETE',
      '/schema-registry/example?mode=local',
      {},
    )
    assert.strictEqual(deleteResp.status, 200)

    // Test local-file bridge endpoints used by online AROMA
    console.log('  Testing /local-file bridge endpoints...')
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rocrate-local-file-'))
    const cratePath = path.join(tmpDir, 'ro-crate-metadata.json')
    const initialCrate = {
      '@context': 'https://w3id.org/ro/crate/1.1/context',
      '@graph': [
        {
          '@id': './',
          '@type': 'Dataset',
          name: 'Initial crate',
        },
      ],
    }
    fs.writeFileSync(cratePath, `${JSON.stringify(initialCrate, null, 2)}\n`, 'utf8')

    process.env.ROCRATE_LOCAL_FILE_BRIDGE_ALLOWED_ORIGINS = 'https://repo.researchdata.hu'
    const registration = registerLocalFileForAroma({ path: cratePath })
    assert.strictEqual(
      registration.aromaUrl.startsWith('https://repo.researchdata.hu/aroma?localFile='),
      true,
    )
    assert.strictEqual(
      registration.localFileUrl.startsWith(`http://127.0.0.1:${port}/local-file?id=`),
      true,
    )

    const originalCwd = process.cwd()
    let defaultRegistration
    let expectedDefaultPath
    try {
      process.chdir(tmpDir)
      expectedDefaultPath = path.join(process.cwd(), 'ro-crate-metadata.json')
      defaultRegistration = registerLocalFileForAroma({})
    } finally {
      process.chdir(originalCwd)
    }
    assert.strictEqual(defaultRegistration.path, expectedDefaultPath)

    const bridgePath = new URL(registration.localFileUrl).pathname
      + new URL(registration.localFileUrl).search
    const getBridgeResp = await get(bridgePath)
    assert.strictEqual(getBridgeResp.status, 200)
    assert.strictEqual(
      getBridgeResp.headers['access-control-allow-origin'],
      'https://repo.researchdata.hu',
    )
    const bridgeData = JSON.parse(getBridgeResp.data)
    assert.strictEqual(bridgeData.path, cratePath)
    assert.strictEqual(bridgeData.content['@graph'][0].name, 'Initial crate')
    assert.strictEqual(typeof bridgeData.etag, 'string')

    const missingIfMatchResp = await requestWithBody(
      'PUT',
      bridgePath,
      initialCrate,
    )
    assert.strictEqual(missingIfMatchResp.status, 428)

    const updatedCrate = {
      ...initialCrate,
      '@graph': [{ ...initialCrate['@graph'][0], name: 'Updated crate' }],
    }
    const saveResp = await requestWithBody('PUT', bridgePath, updatedCrate, {
      'if-match': bridgeData.etag,
    })
    assert.strictEqual(saveResp.status, 200)
    const saveData = JSON.parse(saveResp.data)
    assert.strictEqual(saveData.ok, true)
    assert.notStrictEqual(saveData.etag, bridgeData.etag)
    const written = JSON.parse(fs.readFileSync(cratePath, 'utf8'))
    assert.strictEqual(written['@graph'][0].name, 'Updated crate')

    const staleResp = await requestWithBody('PUT', bridgePath, initialCrate, {
      'if-match': bridgeData.etag,
    })
    assert.strictEqual(staleResp.status, 412)

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
    if (originalDataverseBaseUrl === undefined) {
      delete process.env.DATAVERSE_BASE_URL
    } else {
      process.env.DATAVERSE_BASE_URL = originalDataverseBaseUrl
    }
    if (originalDataverseApiKey === undefined) {
      delete process.env.DATAVERSE_API_KEY
    } else {
      process.env.DATAVERSE_API_KEY = originalDataverseApiKey
    }
    if (originalKeepUploadZips === undefined) {
      delete process.env.ROCRATE_DATAVERSE_KEEP_UPLOAD_ZIPS
    } else {
      process.env.ROCRATE_DATAVERSE_KEEP_UPLOAD_ZIPS = originalKeepUploadZips
    }
    if (originalDashboardPort === undefined) {
      delete process.env.ROCRATE_DASHBOARD_PORT
    } else {
      process.env.ROCRATE_DASHBOARD_PORT = originalDashboardPort
    }
    if (originalDashboardEnabled === undefined) {
      delete process.env.ROCRATE_DASHBOARD_ENABLED
    } else {
      process.env.ROCRATE_DASHBOARD_ENABLED = originalDashboardEnabled
    }
    if (originalBridgeEnabled === undefined) {
      delete process.env.ROCRATE_LOCAL_FILE_BRIDGE_ENABLED
    } else {
      process.env.ROCRATE_LOCAL_FILE_BRIDGE_ENABLED = originalBridgeEnabled
    }
    if (originalAllowedOrigins === undefined) {
      delete process.env.ROCRATE_LOCAL_FILE_BRIDGE_ALLOWED_ORIGINS
    } else {
      process.env.ROCRATE_LOCAL_FILE_BRIDGE_ALLOWED_ORIGINS = originalAllowedOrigins
    }
    if (originalRockitRootPath === undefined) {
      delete process.env.ROCKIT_ROOT_PATH
    } else {
      process.env.ROCKIT_ROOT_PATH = originalRockitRootPath
    }
    if (originalAromaRootPath === undefined) {
      delete process.env.AROMA_ROOT_PATH
    } else {
      process.env.AROMA_ROOT_PATH = originalAromaRootPath
    }
    if (originalRockitProviderConfigFile === undefined) {
      delete process.env.ROCKIT_REMOTE_SCHEMA_PROVIDER_CONFIG_FILE
    } else {
      process.env.ROCKIT_REMOTE_SCHEMA_PROVIDER_CONFIG_FILE = originalRockitProviderConfigFile
    }
    if (originalAromaProviderConfigFile === undefined) {
      delete process.env.AROMA_REMOTE_SCHEMA_PROVIDER_CONFIG_FILE
    } else {
      process.env.AROMA_REMOTE_SCHEMA_PROVIDER_CONFIG_FILE = originalAromaProviderConfigFile
    }
    if (originalRockitProviderKeytarService === undefined) {
      delete process.env.ROCKIT_REMOTE_SCHEMA_PROVIDER_KEYTAR_SERVICE
    } else {
      process.env.ROCKIT_REMOTE_SCHEMA_PROVIDER_KEYTAR_SERVICE = originalRockitProviderKeytarService
    }
    if (originalAromaProviderKeytarService === undefined) {
      delete process.env.AROMA_REMOTE_SCHEMA_PROVIDER_KEYTAR_SERVICE
    } else {
      process.env.AROMA_REMOTE_SCHEMA_PROVIDER_KEYTAR_SERVICE = originalAromaProviderKeytarService
    }
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
  }, {
    list: () => ({ storage: {}, schemas: [] }),
    register: () => ({ storage: {}, schemas: [] }),
    update: () => ({ storage: {}, schemas: [] }),
    remove: () => ({ storage: {}, schemas: [] }),
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

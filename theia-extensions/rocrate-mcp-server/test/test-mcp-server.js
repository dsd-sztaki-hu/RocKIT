const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')

function getUnusedPort() {
  return new Promise((resolve) => {
    const server = http.createServer()
    server.listen(0, () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function encodeMessage(message, mode = 'lf') {
  if (mode === 'jsonl') {
    return Buffer.from(`${JSON.stringify(message)}\n`, 'utf8')
  }
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  const delimiter = mode === 'lf' ? '\n\n' : '\r\n\r\n'
  const header = Buffer.from(`Content-Length: ${body.length}${delimiter}`, 'utf8')
  return Buffer.concat([header, body])
}

function parseMessages(onMessage) {
  let buffer = Buffer.alloc(0)
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (true) {
      const preview = buffer.toString('utf8', 0, Math.min(buffer.length, 64)).trimStart()
      const isHeaderFramed = /^content-length:/i.test(preview)

      if (isHeaderFramed) {
        let headerTerminator = buffer.indexOf('\r\n\r\n')
        let delimiterSize = 4
        if (headerTerminator < 0) {
          headerTerminator = buffer.indexOf('\n\n')
          delimiterSize = 2
        }
        if (headerTerminator < 0) {
          break
        }
        const headerText = buffer.slice(0, headerTerminator).toString('utf8')
        const match = headerText.match(/Content-Length:\s*(\d+)/i)
        if (!match) {
          buffer = buffer.slice(headerTerminator + delimiterSize)
          continue
        }
        const contentLength = Number(match[1])
        const bodyStart = headerTerminator + delimiterSize
        const total = bodyStart + contentLength
        if (buffer.length < total) {
          break
        }
        const body = buffer.slice(bodyStart, total).toString('utf8')
        buffer = buffer.slice(total)
        onMessage(JSON.parse(body))
        continue
      }

      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex < 0) {
        break
      }
      const line = buffer.slice(0, newlineIndex).toString('utf8').trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (line === '') {
        continue
      }
      onMessage(JSON.parse(line))
    }
  }
}

function listStoredZipEntries(zipPath) {
  return Array.from(readStoredZipEntries(zipPath).keys())
}

function readStoredZipEntries(zipPath) {
  const data = fs.readFileSync(zipPath)
  const entries = new Map()
  let offset = 0
  while (offset + 30 <= data.length) {
    const signature = data.readUInt32LE(offset)
    if (signature !== 0x04034b50) {
      break
    }
    const compressedSize = data.readUInt32LE(offset + 18)
    const fileNameLength = data.readUInt16LE(offset + 26)
    const extraLength = data.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const nameEnd = nameStart + fileNameLength
    const dataStart = nameEnd + extraLength
    const dataEnd = dataStart + compressedSize
    entries.set(
      data.slice(nameStart, nameEnd).toString('utf8'),
      data.slice(dataStart, dataEnd),
    )
    offset = nameEnd + extraLength + compressedSize
  }
  return entries
}

async function startMockWebToolsServer(profileUrl) {
  const dataverseState = {
    lastUploaded: null,
  }
  const defaultContextKnownTerms = new Set([
    'name',
    'title',
    'description',
    'hasPart',
    'about',
    'conformsTo',
    'author',
    'identifier',
    'url',
    'encodingFormat',
    'contentSize',
    'datePublished',
    'dateModified',
    'subject',
  ])
  const externalCoverageContextUrls = new Set([
    'https://w3id.org/ro/crate/1.1/context',
  ])

  function collectUsedTerms(crate) {
    const used = new Set()
    const graph = Array.isArray(crate && crate['@graph']) ? crate['@graph'] : []
    for (const entity of graph) {
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
        continue
      }
      for (const key of Object.keys(entity)) {
        if (!key.startsWith('@')) {
          used.add(key)
        }
      }
    }
    return used
  }

  function collectDeclaredTerms(crate) {
    const declared = new Set()
    const ctx = crate ? crate['@context'] : undefined
    const collect = (item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return
      }
      for (const key of Object.keys(item)) {
        declared.add(key)
      }
    }
    if (Array.isArray(ctx)) {
      for (const item of ctx) {
        collect(item)
      }
      return declared
    }
    collect(ctx)
    return declared
  }

  function collectContextUrls(crate) {
    const urls = new Set()
    const ctx = crate ? crate['@context'] : undefined
    const collect = (item) => {
      if (typeof item === 'string' && item.trim() !== '') {
        urls.add(item.trim())
      }
    }
    if (Array.isArray(ctx)) {
      for (const item of ctx) {
        collect(item)
      }
      return urls
    }
    collect(ctx)
    return urls
  }

  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)

    if (parsedUrl.pathname === '/page') {
      res.statusCode = 200
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(
        '<html><head><title>Test Page</title><style>.x{color:red;}</style></head><body><h1>Hello</h1><script>window.x=1</script><p>World</p></body></html>',
      )
      return
    }
    if (parsedUrl.pathname === '/search' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString('utf8')
      })
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}')
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            query: parsed.query || '',
            results: [
              {
                title: 'Mock result',
                url: 'https://example.org/mock',
                content: 'Mocked search result content',
              },
            ],
          }),
        )
      })
      return
    }
    if (parsedUrl.pathname === '/api/arp/validateRoCrate' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString('utf8')
      })
      req.on('end', () => {
        let crate = {}
        try {
          crate = JSON.parse(body || '{}')
        } catch {
          res.statusCode = 400
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ status: 'ERROR', message: 'Invalid JSON payload.' }))
          return
        }
        const used = collectUsedTerms(crate)
        const declared = collectDeclaredTerms(crate)
        const contextUrls = collectContextUrls(crate)
        const hasExternalCoverage = Array.from(contextUrls).some((url) =>
          externalCoverageContextUrls.has(url),
        )
        const missing = Array.from(used).filter(
          (term) =>
            !hasExternalCoverage &&
            !declared.has(term) &&
            !defaultContextKnownTerms.has(term),
        )
        if (missing.length > 0) {
          const details = {
            strict: true,
            warnings: [],
            errors: [
              {
                errorEntity: 'RO-Crate',
                errors: missing.map((term) => ({
                  errorField: '@context',
                  errorMessage: `Missing mapping for term: ${term}`,
                  errorSuggestion: `Add ${term} to @context.`,
                })),
              },
            ],
          }
          res.statusCode = 400
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ status: 'ERROR', details, message: JSON.stringify(details) }))
          return
        }
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ status: 'OK', details: { strict: true, warnings: [], errors: [] } }))
      })
      return
    }
    if (parsedUrl.pathname === '/api/arp/uploadRoCrateZip' && req.method === 'POST') {
      req.on('data', () => {})
      req.on('end', () => {
        if (parsedUrl.searchParams.get('ownerId') === 'fail-upload') {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ status: 'ERROR', message: 'Mock upload failure' }))
          return
        }
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            status: 'OK',
            data: {
              message: 'RO-Crate uploaded',
              roCrate: {
                '@context': 'https://w3id.org/ro/crate/1.1/context',
                '@graph': [
                  {
                    '@id': './',
                    '@type': 'Dataset',
                    name: 'Uploaded Root',
                    '@arpPid': 'doi:10.5072/FK2/MOCKPID',
                  },
                  {
                    '@id': 'https://example.org/arp/file/created',
                    '@type': 'File',
                    name: 'created.txt',
                    directoryLabel: 'folder',
                    '@arpPid': 'doi:10.5072/FK2/MOCKPID/FILE1',
                  },
                ],
              },
            },
          }),
        )
      })
      return
    }
    if (parsedUrl.pathname.startsWith('/api/arp/rocrate/') && req.method === 'POST') {
      const pid = decodeURIComponent(parsedUrl.pathname.slice('/api/arp/rocrate/'.length))
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString('utf8')
      })
      req.on('end', () => {
        const inputCrate = JSON.parse(body || '{}')
        const nextCrate = JSON.parse(JSON.stringify(inputCrate))
        dataverseState.lastUploaded = nextCrate
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ status: 'OK', pid, data: nextCrate }))
      })
      return
    }
    if (parsedUrl.pathname.startsWith('/api/arp/rocrate/') && req.method === 'GET') {
      const pid = decodeURIComponent(parsedUrl.pathname.slice('/api/arp/rocrate/'.length))
      const downloaded = dataverseState.lastUploaded
        ? JSON.parse(JSON.stringify(dataverseState.lastUploaded))
        : {
            '@context': 'https://w3id.org/ro/crate/1.1/context',
            '@graph': [
              {
                '@id': './',
                '@type': 'Dataset',
                name: 'Downloaded crate',
                title: 'Downloaded crate title',
                author: 'Downloaded Author',
                conformsTo: [{ '@id': profileUrl }],
              },
              {
                '@id': 'ro-crate-metadata.json',
                '@type': 'CreativeWork',
                conformsTo: { '@id': 'https://w3id.org/ro/crate/1.1' },
                about: { '@id': './' },
              },
            ],
          }
      const graph = Array.isArray(downloaded['@graph']) ? downloaded['@graph'] : []
      const root = graph.find((entity) => entity && entity['@id'] === './')
      if (root && typeof root === 'object') {
        root.name = `Downloaded ${pid}`
      }
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ status: 'OK', pid, data: downloaded }))
      return
    }
    res.statusCode = 404
    res.end('not found')
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to get mock server address')
  }
  const baseUrl = `http://127.0.0.1:${address.port}`
  return {
    baseUrl,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      }),
  }
}

async function run() {
  const profileUrl = 'https://w3id.org/arp/schema/33677b82-7973-3e4c-b09d-b5189e095627'
  const webToolsMock = await startMockWebToolsServer(profileUrl)
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rocrate-mcp-test-'))
  const aromaRoot = path.join(tempRoot, 'aroma-root')
  fs.mkdirSync(path.join(aromaRoot, 'metadata-schemas', 'ro-crate'), { recursive: true })
  const extraProfileUrl = 'https://w3id.org/arp/schema/example-profile'
  const convertedRelativePath = 'metadata-schemas/ro-crate/citation_profile.json'
  fs.writeFileSync(
    path.join(aromaRoot, convertedRelativePath),
    JSON.stringify(
      {
        metadata: { name: 'Citation Metadata', version: 1 },
        classes: {
          Dataset: {
            inputs: [
              { name: 'title', id: 'http://purl.org/dc/terms/title', required: true },
              { name: 'author', id: 'http://purl.org/dc/terms/creator', required: true },
              {
                name: 'datasetContact',
                id: 'https://dataverse.org/schema/citation/datasetContact',
                type: ['datasetContact'],
                required: true,
              },
              {
                name: 'subject',
                id: 'http://purl.org/dc/terms/subject',
                values: ['Computer and Information Science'],
              },
              { name: 'customTerm', id: 'https://example.org/vocab/customTerm' },
            ],
          },
          datasetContact: {
            inputs: [
              { name: 'datasetContactName', id: 'https://dataverse.org/schema/citation/datasetContactName' },
              {
                name: 'datasetContactEmail',
                id: 'https://dataverse.org/schema/citation/datasetContactEmail',
                required: true,
              },
            ],
          },
          File: {
            inputs: [{ name: 'description' }],
          },
        },
        enabledClasses: ['Dataset', 'File'],
      },
      null,
      2,
    ),
    'utf8',
  )
  fs.writeFileSync(
    path.join(aromaRoot, 'metadata-schema-index.json'),
    JSON.stringify(
      {
        profiles: [
          {
            id: 'b060794f-1a81-41fc-ab35-f51569fa1188',
            name: 'Citation Metadata',
            version: '0.0.1',
            source: 'remote',
            type: 'cedar',
            files: {
              sourcePath: 'metadata-schemas/cedar/citation_metadata.json',
              convertedPath: convertedRelativePath,
            },
            conformsTo: profileUrl,
          },
          {
            id: 'f1b4cf4c-63b4-4d8f-8b66-a357975f0a30',
            name: 'Example Profile',
            version: '0.0.1',
            source: 'remote',
            type: 'cedar',
            files: {
              sourcePath: 'metadata-schemas/cedar/example_profile.json',
              convertedPath: convertedRelativePath,
            },
            conformsTo: extraProfileUrl,
          },
        ],
        conformsToIndex: {
          [profileUrl]: ['b060794f-1a81-41fc-ab35-f51569fa1188'],
          [extraProfileUrl]: ['f1b4cf4c-63b4-4d8f-8b66-a357975f0a30'],
        },
      },
      null,
      2,
    ),
    'utf8',
  )

  const cratePath = path.join(tempRoot, 'ro-crate-metadata.json')
  fs.writeFileSync(
    cratePath,
    `${JSON.stringify(
      {
        '@context': 'https://w3id.org/ro/crate/1.1/context',
        '@graph': [
          {
            '@id': './',
            '@type': 'Dataset',
            name: 'Root',
            title: 'Root dataset title',
            author: 'Example Author',
            datasetContact: [{ '@id': '#dataset-contact-hun-ren-arp' }],
            hasPart: [],
            conformsTo: [{ '@id': profileUrl }],
          },
          {
            '@id': '#dataset-contact-hun-ren-arp',
            '@type': 'datasetContact',
            name: 'HUN-REN ARP contact',
            datasetContactName: 'HUN-REN ARP',
            datasetContactEmail: 'contact@example.org',
          },
          {
            '@id': 'ro-crate-metadata.json',
            '@type': 'CreativeWork',
            name: 'RO-Crate Metadata',
            conformsTo: { '@id': 'https://w3id.org/ro/crate/1.1' },
            about: { '@id': './' },
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  fs.mkdirSync(path.join(tempRoot, 'folder'))
  fs.writeFileSync(path.join(tempRoot, 'folder', 'x.txt'), 'hello\n', 'utf8')
  fs.writeFileSync(path.join(tempRoot, 'folder', 'bare.txt'), 'bare\n', 'utf8')
  fs.mkdirSync(path.join(tempRoot, 'folder', 'nested'))
  fs.writeFileSync(path.join(tempRoot, 'folder', 'nested', 'inside.txt'), 'inside\n', 'utf8')
  fs.writeFileSync(path.join(tempRoot, 'folder', 'nested', 'arp.txt'), 'arp\n', 'utf8')

  const dashboardPort = await getUnusedPort()
  const serverPath = path.resolve(__dirname, '../lib/server.js')
  const child = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TAVILY_API_KEY: 'test-key',
      TAVILY_API_URL: `${webToolsMock.baseUrl}/search`,
      AROMA_ROOT_PATH: aromaRoot,
      ROCRATE_DASHBOARD_PORT: String(dashboardPort),
    },
  })

  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk)
  })

  const responses = new Map()
  const onData = parseMessages((message) => {
    if (message && message.id !== undefined) {
      responses.set(message.id, message)
    }
  })
  child.stdout.on('data', onData)

  let nextId = 1
  function rawRequest(method, params, mode = 'lf') {
    const id = nextId++
    const payload = { jsonrpc: '2.0', id, method, params }
    child.stdin.write(encodeMessage(payload, mode))
    return new Promise((resolve, reject) => {
      const start = Date.now()
      const timer = setInterval(() => {
        if (responses.has(id)) {
          const value = responses.get(id)
          responses.delete(id)
          clearInterval(timer)
          resolve(value)
          return
        }
        if (Date.now() - start > 5000) {
          clearInterval(timer)
          reject(new Error(`Timeout waiting for response: ${method}`))
        }
      }, 20)
    })
  }

  async function request(method, params, mode = 'lf') {
    return rawRequest(method, params, mode)
  }

  try {
    const initialize = await request(
      'initialize',
      {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'rocrate-test', version: '0.0.0' },
      },
      'jsonl',
    )
    assert.ok(initialize.result, 'initialize should return result')

    const list = await request('tools/list', {}, 'crlf')
    const toolNames = (list.result.tools || []).map((tool) => tool.name)
    console.log('Discovered MCP tools:', toolNames.join(', '))
    assert.ok(toolNames.includes('search'), 'search tool should exist')
    assert.ok(toolNames.includes('download_url'), 'download_url tool should exist')
    assert.ok(
      toolNames.includes('list_well_known_schemas'),
      'list_well_known_schemas tool should exist',
    )
    assert.ok(
      toolNames.includes('list_remote_schema_tree'),
      'list_remote_schema_tree tool should exist',
    )
    assert.ok(
      toolNames.includes('import_well_known_schema'),
      'import_well_known_schema tool should exist',
    )
    assert.ok(
      toolNames.includes('list_metadata_profiles'),
      'list_metadata_profiles tool should exist',
    )
    assert.ok(
      toolNames.includes('import_metadata_profile'),
      'import_metadata_profile tool should exist',
    )
    assert.ok(
      toolNames.includes('delete_metadata_profile'),
      'delete_metadata_profile tool should exist',
    )
    assert.ok(
      toolNames.includes('read_agent_workflow_doc'),
      'read_agent_workflow_doc tool should exist',
    )
    assert.ok(
      toolNames.includes('set_agent_session_context'),
      'set_agent_session_context tool should exist',
    )
    assert.ok(
      toolNames.includes('open_aroma_for_local_file'),
      'open_aroma_for_local_file tool should exist',
    )
    assert.ok(
      toolNames.includes('upload_rocrate_to_dataverse'),
      'upload_rocrate_to_dataverse tool should exist',
    )
    assert.ok(
      toolNames.includes('adopt_pending_dataverse_rocrate'),
      'adopt_pending_dataverse_rocrate tool should exist',
    )
    assert.ok(
      toolNames.includes('download_rocrate_from_dataverse'),
      'download_rocrate_from_dataverse tool should exist',
    )
    assert.ok(
      toolNames.includes('create_default_rocrate'),
      'create_default_rocrate tool should exist',
    )
    assert.ok(toolNames.includes('get_rocrate_context'), 'get_rocrate_context tool should exist')
    assert.ok(toolNames.includes('suggest_context_terms'), 'suggest_context_terms tool should exist')
    assert.ok(toolNames.includes('resolve_profile_schema'), 'resolve_profile_schema tool should exist')
    assert.ok(
      toolNames.includes('prepare_remote_profile_payload'),
      'prepare_remote_profile_payload tool should exist',
    )
    assert.ok(toolNames.includes('create_profile_context'), 'create_profile_context tool should exist')
    assert.ok(
      toolNames.includes('get_profile_context_info'),
      'get_profile_context_info tool should exist',
    )
    assert.ok(toolNames.includes('delete_profile_context'), 'delete_profile_context tool should exist')
    assert.ok(toolNames.includes('apply_changes'), 'apply_changes tool should exist')
    assert.ok(
      toolNames.includes('update_profile_conforms_to'),
      'update_profile_conforms_to tool should exist',
    )
    assert.match(
      initialize.result.instructions,
      /read_agent_workflow_doc.*rocrate_workflow\.md/,
      'initialize instructions should direct agents to the MCP workflow doc',
    )
    assert.match(
      initialize.result.instructions,
      /outside AROMA, call open_aroma_for_local_file and include the returned aromaUrl/,
      'initialize instructions should require AROMA URL generation outside AROMA',
    )
    assert.match(
      initialize.result.instructions,
      /offer create_default_rocrate/,
      'initialize instructions should offer default RO-Crate creation when metadata is missing',
    )

    const workflowDocResponse = await request('tools/call', {
      name: 'read_agent_workflow_doc',
      arguments: {},
    })
    const workflowDocPayload = JSON.parse(workflowDocResponse.result.content[0].text)
    assert.equal(workflowDocPayload.name, 'rocrate_workflow.md')
    assert.match(workflowDocPayload.content, /# RO-Crate Agent Workflow/)
    assert.match(
      workflowDocPayload.content,
      /create_default_rocrate/,
      'workflow doc should mention default RO-Crate creation for directories without metadata',
    )
    assert.match(
      workflowDocPayload.content,
      /call\s+`open_aroma_for_local_file`[\s\S]*returned `aromaUrl`/,
      'workflow doc should require generating the AROMA review URL',
    )
    assert.doesNotMatch(
      workflowDocPayload.content,
      /must ask whether the user wants to open the crate/,
      'workflow doc should not tell outside-AROMA agents to only ask about AROMA review',
    )
    assert.ok(
      workflowDocPayload.availableDocs.includes('profile-first-workflow.md'),
      'workflow doc response should list available step docs',
    )

    const profileWorkflowResponse = await request('tools/call', {
      name: 'read_agent_workflow_doc',
      arguments: {
        name: 'profile-first-workflow.md',
      },
    })
    const profileWorkflowPayload = JSON.parse(
      profileWorkflowResponse.result.content[0].text,
    )
    assert.equal(profileWorkflowPayload.name, 'profile-first-workflow.md')
    assert.match(profileWorkflowPayload.content, /# Profile-First Workflow/)

    const unknownWorkflowDocResponse = await request('tools/call', {
      name: 'read_agent_workflow_doc',
      arguments: {
        name: 'missing.md',
      },
    })
    assert.ok(unknownWorkflowDocResponse.error, 'unknown workflow doc should fail')
    assert.match(unknownWorkflowDocResponse.error.message, /Unknown workflow doc: missing\.md/)
    assert.match(unknownWorkflowDocResponse.error.message, /rocrate_workflow\.md/)

    const sessionContextResponse = await request('tools/call', {
      name: 'set_agent_session_context',
      arguments: {
        launchContext: 'inside_aroma',
        aromaAlreadyOpen: true,
      },
    })
    const sessionContextPayload = JSON.parse(sessionContextResponse.result.content[0].text)
    assert.equal(sessionContextPayload.launchContext, 'inside_aroma')
    assert.equal(sessionContextPayload.aromaAlreadyOpen, true)

    const workflowDocWithContextResponse = await request('tools/call', {
      name: 'read_agent_workflow_doc',
      arguments: {},
    })
    const workflowDocWithContextPayload = JSON.parse(
      workflowDocWithContextResponse.result.content[0].text,
    )
    assert.equal(
      workflowDocWithContextPayload.sessionContext.launchContext,
      'inside_aroma',
    )
    assert.match(
      workflowDocWithContextPayload.content,
      /Do not suggest opening AROMA after edits/,
    )

    const aromaBridgeResponse = await request('tools/call', {
      name: 'open_aroma_for_local_file',
      arguments: {
        path: cratePath,
      },
    })
    assert.ok(aromaBridgeResponse.result, 'open_aroma_for_local_file should return URLs')
    const aromaBridgePayload = JSON.parse(aromaBridgeResponse.result.content[0].text)
    assert.equal(aromaBridgePayload.path, cratePath)
    assert.ok(
      aromaBridgePayload.aromaUrl.startsWith(
        'https://repo.researchdata.hu/aroma?localFile=',
      ),
      'open_aroma_for_local_file should default to the production AROMA URL',
    )
    assert.ok(
      aromaBridgePayload.localFileUrl.startsWith(
        `http://127.0.0.1:${dashboardPort}/local-file?id=`,
      ),
      'open_aroma_for_local_file should point localFileUrl at the dashboard HTTP server',
    )
    assert.ok(
      aromaBridgePayload.eventsUrl.startsWith(
        `http://127.0.0.1:${dashboardPort}/local-file/events?id=`,
      ),
      'open_aroma_for_local_file should include the matching SSE URL',
    )

    const defaultCrateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rocrate-mcp-default-'))
    fs.mkdirSync(path.join(defaultCrateRoot, 'data'))
    fs.writeFileSync(path.join(defaultCrateRoot, 'data', 'example.txt'), 'hello\n', 'utf8')
    fs.writeFileSync(path.join(defaultCrateRoot, 'ro-crate-preview.html'), '<html></html>', 'utf8')
    const defaultCrateResponse = await request('tools/call', {
      name: 'create_default_rocrate',
      arguments: {
        directoryPath: defaultCrateRoot,
      },
    })
    assert.ok(defaultCrateResponse.result, 'create_default_rocrate should succeed')
    const defaultCratePayload = JSON.parse(defaultCrateResponse.result.content[0].text)
    const defaultCratePath = path.join(defaultCrateRoot, 'ro-crate-metadata.json')
    const defaultIgnoredPath = path.join(defaultCrateRoot, '.aroma', 'ignored.txt')
    assert.equal(defaultCratePayload.writeApplied, true)
    assert.equal(defaultCratePayload.cratePath, defaultCratePath)
    assert.equal(defaultCratePayload.ignoredFilePath, defaultIgnoredPath)
    assert.ok(fs.existsSync(defaultCratePath), 'Default crate metadata should be written')
    assert.ok(fs.existsSync(defaultIgnoredPath), 'Default ignored.txt should be written')
    const defaultCrate = JSON.parse(fs.readFileSync(defaultCratePath, 'utf8'))
    assert.ok(
      defaultCrate['@graph'].some((entity) => entity['@id'] === 'data/example.txt'),
      'Default crate should include scanned file entity',
    )
    assert.ok(
      !defaultCrate['@graph'].some((entity) => entity['@id'] === 'ro-crate-preview.html'),
      'Default crate should omit technical preview file',
    )
    const defaultValidateResponse = await request('tools/call', {
      name: 'validate_crate',
      arguments: {
        cratePath: defaultCratePath,
        strict: true,
      },
    })
    const defaultValidatePayload = JSON.parse(defaultValidateResponse.result.content[0].text)
    assert.equal(
      defaultValidatePayload.summary.errors,
      0,
      'Generated default crate should validate cleanly',
    )
    const defaultCrateOverwriteResponse = await request('tools/call', {
      name: 'create_default_rocrate',
      arguments: {
        directoryPath: defaultCrateRoot,
      },
    })
    assert.ok(
      defaultCrateOverwriteResponse.error,
      'create_default_rocrate should refuse overwrite by default',
    )

    const localReadSummaryResponse = await request('tools/call', {
      name: 'read_crate',
      arguments: {
        cratePath,
      },
    })
    const localReadSummaryPayload = JSON.parse(localReadSummaryResponse.result.content[0].text)
    assert.equal(localReadSummaryPayload.mode, 'local')
    assert.equal(typeof localReadSummaryPayload.graphEntityCount, 'number')
    assert.ok(!('@graph' in localReadSummaryPayload), 'local read default should be summary')

    const localReadSummaryByDirResponse = await request('tools/call', {
      name: 'read_crate',
      arguments: {
        cratePath: tempRoot,
      },
    })
    const localReadSummaryByDirPayload = JSON.parse(
      localReadSummaryByDirResponse.result.content[0].text,
    )
    assert.equal(localReadSummaryByDirPayload.mode, 'local')
    assert.equal(localReadSummaryByDirPayload.metadataPath, cratePath)

    const localApplySummaryResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        changeSet: {
          updateEntities: [{ '@id': './', merge: { name: 'Updated By MCP Test' } }],
        },
      },
    })
    const localApplySummaryPayload = JSON.parse(
      localApplySummaryResponse.result.content[0].text,
    )
    assert.equal(localApplySummaryPayload.mode, 'local')
    assert.equal(localApplySummaryPayload.writeApplied, true)
    assert.ok(!('crate' in localApplySummaryPayload), 'local apply default should be summary')

    const localAddProfileResponse = await request('tools/call', {
      name: 'update_profile_conforms_to',
      arguments: {
        cratePath,
        write: true,
        add: [extraProfileUrl],
      },
    })
    const localAddProfilePayload = JSON.parse(
      localAddProfileResponse.result.content[0].text,
    )
    assert.equal(localAddProfilePayload.mode, 'local')
    assert.equal(localAddProfilePayload.writeApplied, true)
    assert.equal(localAddProfilePayload.entityId, './')
    assert.ok(localAddProfilePayload.addedProfileUrls.includes(extraProfileUrl))
    const localAddProfileCrate = JSON.parse(fs.readFileSync(cratePath, 'utf8'))
    const localAddProfileRoot = localAddProfileCrate['@graph'].find(
      (entity) => entity['@id'] === './',
    )
    const localAddProfileUrls = (localAddProfileRoot.conformsTo || []).map(
      (entry) => entry['@id'],
    )
    assert.ok(localAddProfileUrls.includes(profileUrl))
    assert.ok(localAddProfileUrls.includes(extraProfileUrl))

    const blockedProfileChangeResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        changeSet: {
          updateEntities: [{ '@id': './', unset: ['conformsTo'] }],
        },
      },
    })
    assert.ok(blockedProfileChangeResponse.error, 'conformsTo edits should be blocked by default')
    assert.match(blockedProfileChangeResponse.error.message, /conformsTo update blocked in apply_changes/)

    const allowedProfileChangeResponse = await request('tools/call', {
      name: 'update_profile_conforms_to',
      arguments: {
        cratePath,
        write: true,
        remove: [profileUrl, extraProfileUrl],
      },
    })
    assert.ok(
      allowedProfileChangeResponse.result,
      'conformsTo edits should be allowed with explicit update_profile_conforms_to',
    )

    await request('tools/call', {
      name: 'update_profile_conforms_to',
      arguments: {
        cratePath,
        write: true,
        add: [profileUrl],
      },
    })
    await request('tools/call', {
      name: 'update_profile_conforms_to',
      arguments: {
        cratePath,
        write: true,
        add: [extraProfileUrl],
      },
    })

    await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        changeSet: {
          addEntities: [
            {
              '@id': 'file://./unprofiled/',
              '@type': 'Dataset',
              name: 'Unprofiled Dataset',
              hasPart: [],
            },
          ],
        },
      },
    })

    await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        changeSet: {
          updateEntities: [{ '@id': './', merge: { temporaryField: 'to-remove' } }],
        },
      },
    })
    await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        confirmDestructive: true,
        changeSet: {
          updateEntities: [{ '@id': './', unset: ['temporaryField'] }],
        },
      },
    })
    const crateAfterUnset = JSON.parse(fs.readFileSync(cratePath, 'utf8'))
    const rootAfterUnset = crateAfterUnset['@graph'].find((entity) => entity['@id'] === './')
    assert.equal(
      Object.prototype.hasOwnProperty.call(rootAfterUnset, 'temporaryField'),
      false,
      'temporaryField should be removed by unset',
    )

    const unprofiledTargetUpdateResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        changeSet: {
          updateEntities: [
            {
              '@id': 'file://./unprofiled/',
              merge: { title: 'Should require confirmation' },
            },
          ],
        },
      },
    })
    assert.ok(
      unprofiledTargetUpdateResponse.result,
      'unprofiled Dataset/File should allow @context-defined properties',
    )

    const unprofiledUnknownPropertyResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        contextMode: 'strict',
        changeSet: {
          updateEntities: [
            {
              '@id': 'file://./unprofiled/',
              merge: { unlistedProperty: 'should fail without context definition' },
            },
          ],
        },
      },
    })
    assert.ok(
      unprofiledUnknownPropertyResponse.result,
      'unprofiled Dataset/File should allow properties covered by external @context URLs',
    )

    const legacyAliasChangeSetResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        changeSet: {
          entityChanges: [{ '@id': './', upsert: { name: 'Updated By Alias' } }],
        },
      },
    })
    assert.ok(
      legacyAliasChangeSetResponse.error,
      'legacy alias keys should be rejected',
    )
    assert.match(legacyAliasChangeSetResponse.error.message, /unsupported keys/)

    const invalidChangeSetResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        changeSet: {
          totallyUnsupportedKey: true,
        },
      },
    })
    assert.ok(invalidChangeSetResponse.error, 'unsupported changeset key should fail')
    assert.match(invalidChangeSetResponse.error.message, /unsupported keys/)

    const invalidNestedGraphMutationResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        changeSet: {
          setRootFields: {
            '@graph': [
              {
                '@id': './',
                author: [{ '@id': '#author-1' }],
              },
            ],
          },
        },
      },
    })
    assert.ok(
      invalidNestedGraphMutationResponse.error,
      'setRootFields.@graph should be rejected to prevent malformed nested graph writes',
    )
    assert.match(
      invalidNestedGraphMutationResponse.error.message,
      /Invalid @graph mutation blocked/,
    )

    const misplacedTopLevelArgsInChangeSetResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        changeSet: {
          mode: 'local',
          responseMode: 'summary',
        },
      },
    })
    assert.ok(
      misplacedTopLevelArgsInChangeSetResponse.error,
      'misplaced top-level args inside changeSet should fail',
    )
    assert.match(
      misplacedTopLevelArgsInChangeSetResponse.error.message,
      /You likely nested top-level params inside changeSet; move them to tool arguments\./,
    )

    const missingUpdateTargetResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        changeSet: {
          updateEntities: [{ '@id': '#entity-does-not-exist', merge: { name: 'No-op' } }],
        },
      },
    })
    assert.ok(
      missingUpdateTargetResponse.error,
      'apply_changes should fail when updateEntities target does not exist',
    )
    assert.match(
      missingUpdateTargetResponse.error.message,
      /updateEntities target\(s\) not found in @graph/,
    )

    const destructiveWithoutConfirmResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        changeSet: {
          removeEntities: ['file://./unprofiled/'],
        },
      },
    })
    assert.ok(
      destructiveWithoutConfirmResponse.error,
      'destructive apply_changes should require explicit confirmation flag',
    )
    assert.match(
      destructiveWithoutConfirmResponse.error.message,
      /Destructive apply_changes blocked/,
    )

    const destructiveWithConfirmResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        confirmDestructive: true,
        changeSet: {
          removeEntities: ['file://./unprofiled/'],
        },
      },
    })
    assert.ok(
      destructiveWithConfirmResponse.result,
      'destructive apply_changes should succeed when explicitly confirmed',
    )

    const noWriteResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        changeSet: {
          updateEntities: [{ '@id': './', merge: { name: 'No-write default should persist' } }],
        },
      },
    })
    assert.ok(noWriteResponse.result, 'apply_changes without write should succeed')
    const noWritePayload = JSON.parse(noWriteResponse.result.content[0].text)
    assert.equal(noWritePayload.writeApplied, true, 'default local apply should persist')

    const beforeDryRunCrate = JSON.parse(fs.readFileSync(cratePath, 'utf8'))
    const beforeDryRunRoot = beforeDryRunCrate['@graph'].find((entity) => entity['@id'] === './')
    const beforeDryRunName = beforeDryRunRoot?.name

    const dryRunResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        dryRun: true,
        changeSet: {
          updateEntities: [{ '@id': './', merge: { name: 'Dry run should not persist' } }],
        },
      },
    })
    assert.ok(dryRunResponse.result, 'dryRun apply_changes should succeed')
    const dryRunPayload = JSON.parse(dryRunResponse.result.content[0].text)
    assert.equal(dryRunPayload.writeApplied, false, 'dryRun must not persist local changes')

    const afterDryRunCrate = JSON.parse(fs.readFileSync(cratePath, 'utf8'))
    const afterDryRunRoot = afterDryRunCrate['@graph'].find((entity) => entity['@id'] === './')
    assert.equal(
      afterDryRunRoot?.name,
      beforeDryRunName,
      'dryRun must leave on-disk crate unchanged',
    )

    const downloadResponse = await request('tools/call', {
      name: 'download_url',
      arguments: {
        url: `${webToolsMock.baseUrl}/page`,
        raw_html: false,
      },
    })
    const downloadPayload = JSON.parse(downloadResponse.result.content[0].text)
    assert.equal(downloadPayload.status, 200)
    assert.match(downloadPayload.content, /Hello/)
    assert.match(downloadPayload.content, /World/)
    assert.doesNotMatch(downloadPayload.content, /window\.x=1/)

    const searchResponse = await request('tools/call', {
      name: 'search',
      arguments: {
        query: 'rocrate',
        max_results: 3,
      },
    })
    const searchPayload = JSON.parse(searchResponse.result.content[0].text)
    assert.equal(searchPayload.query, 'rocrate')
    assert.ok(Array.isArray(searchPayload.results), 'search should return results array')
    assert.equal(searchPayload.results[0].url, 'https://example.org/mock')

    const crateBeforeDataverseUpload = JSON.parse(fs.readFileSync(cratePath, 'utf8'))
    const rootBeforeDataverseUpload = crateBeforeDataverseUpload['@graph'].find(
      (entity) => entity['@id'] === './',
    )
    rootBeforeDataverseUpload.hasPart = [
      ...(Array.isArray(rootBeforeDataverseUpload.hasPart)
        ? rootBeforeDataverseUpload.hasPart
        : []),
      { '@id': './folder/x.txt' },
      { '@id': 'folder/bare.txt' },
      { '@id': 'https://example.org/arp/file/arp.txt' },
      { '@id': 'folder/' },
    ]
    crateBeforeDataverseUpload['@graph'].push(
      {
        '@id': './folder/x.txt',
        '@type': 'File',
        name: 'x.txt',
      },
      {
        '@id': 'folder/bare.txt',
        '@type': 'File',
        name: 'bare.txt',
      },
      {
        '@id': 'https://example.org/arp/file/arp.txt',
        '@type': 'File',
        name: 'arp.txt',
        directoryLabel: 'folder/nested',
      },
      {
        '@id': 'folder/',
        '@type': 'Dataset',
        name: 'Folder dataset',
      },
    )
    fs.writeFileSync(
      cratePath,
      `${JSON.stringify(crateBeforeDataverseUpload, null, 2)}\n`,
      'utf8',
    )

    const tempUploadPrefix = 'rocrate-dataverse-upload-'
    const tempEntriesBeforeUpload = fs
      .readdirSync(os.tmpdir(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(tempUploadPrefix))
      .map((entry) => entry.name)
      .sort()

    const uploadDataverseResponse = await request('tools/call', {
      name: 'upload_rocrate_to_dataverse',
      arguments: {
        cratePath,
        write: true,
        baseUrl: webToolsMock.baseUrl,
        ownerId: 'root',
      },
    })
    assert.ok(
      uploadDataverseResponse.result,
      `upload_rocrate_to_dataverse failed unexpectedly: ${JSON.stringify(uploadDataverseResponse)}`,
    )
    const uploadDataversePayload = JSON.parse(uploadDataverseResponse.result.content[0].text)
    assert.equal(uploadDataversePayload.mode, 'local')
    assert.equal(uploadDataversePayload.writeApplied, false)
    assert.equal(uploadDataversePayload.status, 200)
    assert.equal(uploadDataversePayload.endpoint, 'create')
    assert.equal(uploadDataversePayload.pid, 'doi:10.5072/FK2/MOCKPID')
    assert.ok(uploadDataversePayload.pendingDataverseCrate, 'upload should return pending Dataverse crate metadata')
    assert.ok(uploadDataversePayload.pendingDataverseCrate.id, 'pending Dataverse crate should include id')
    assert.ok(
      fs.existsSync(uploadDataversePayload.pendingDataverseCrate.tempPath),
      'pending Dataverse crate temp file should exist',
    )
    assert.equal(uploadDataversePayload.pendingDataverseCrate.cratePath, cratePath)
    assert.equal(
      JSON.parse(fs.readFileSync(cratePath, 'utf8'))['@graph'][0].name,
      crateBeforeDataverseUpload['@graph'][0].name,
      'Dataverse upload should not replace local RO-Crate metadata without user confirmation',
    )
    assert.equal(
      uploadDataversePayload.dataverseUrl,
      `${webToolsMock.baseUrl}/dataset.xhtml?persistentId=doi%3A10.5072%2FFK2%2FMOCKPID`,
    )
    assert.equal(uploadDataversePayload.fileLinks.length, 1)
    assert.equal(uploadDataversePayload.fileLinks[0].path, 'folder/created.txt')
    assert.equal(
      uploadDataversePayload.fileLinks[0].url,
      `${webToolsMock.baseUrl}/file.xhtml?persistentId=doi%3A10.5072%2FFK2%2FMOCKPID%2FFILE1&datasetPid=doi%3A10.5072%2FFK2%2FMOCKPID`,
    )
    const tempEntriesAfterUpload = fs
      .readdirSync(os.tmpdir(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(tempUploadPrefix))
      .map((entry) => entry.name)
      .sort()
    assert.deepEqual(
      tempEntriesAfterUpload,
      tempEntriesBeforeUpload,
      'Dataverse ZIP temp directory should be cleaned up after upload',
    )
    const adoptDataverseResponse = await request('tools/call', {
      name: 'adopt_pending_dataverse_rocrate',
      arguments: {
        pendingId: uploadDataversePayload.pendingDataverseCrate.id,
        write: true,
      },
    })
    assert.ok(
      adoptDataverseResponse.result,
      `adopt_pending_dataverse_rocrate failed unexpectedly: ${JSON.stringify(adoptDataverseResponse)}`,
    )
    const adoptDataversePayload = JSON.parse(adoptDataverseResponse.result.content[0].text)
    assert.equal(adoptDataversePayload.writeApplied, true)
    assert.equal(adoptDataversePayload.cratePath, cratePath)
    assert.equal(
      JSON.parse(fs.readFileSync(cratePath, 'utf8'))['@graph'][0]['@arpPid'],
      'doi:10.5072/FK2/MOCKPID',
      'adopting pending Dataverse crate should replace local metadata with Dataverse-updated version',
    )
    fs.writeFileSync(
      cratePath,
      `${JSON.stringify(crateBeforeDataverseUpload, null, 2)}\n`,
      'utf8',
    )

    const failedUploadResponse = await request('tools/call', {
      name: 'upload_rocrate_to_dataverse',
      arguments: {
        cratePath,
        write: true,
        baseUrl: webToolsMock.baseUrl,
        ownerId: 'fail-upload',
      },
    })
    assert.ok(failedUploadResponse.error, 'failed upload should return an error')
    const failedUploadMessage = failedUploadResponse.error.message
    assert.match(failedUploadMessage, /Dataverse upload failed \(500\)/)
    assert.match(failedUploadMessage, /ZIP preserved at /)
    const preservedZipPath = failedUploadMessage.match(/ZIP preserved at (.+)$/)?.[1]
    assert.ok(preservedZipPath, 'failed upload error should include preserved ZIP path')
    assert.ok(fs.existsSync(preservedZipPath), 'failed upload should keep ZIP on disk')
    const preservedZipMap = readStoredZipEntries(preservedZipPath)
    const preservedZipEntries = Array.from(preservedZipMap.keys())
    assert.ok(
      preservedZipEntries.includes('folder/x.txt'),
      'Dataverse ZIP should include ./-prefixed file entity paths',
    )
    assert.ok(
      preservedZipEntries.includes('folder/bare.txt'),
      'Dataverse ZIP should include bare relative file entity paths',
    )
    assert.equal(
      preservedZipEntries.includes('folder/'),
      false,
      'Dataverse ZIP should not include directory entries as empty files',
    )
    assert.ok(
      preservedZipEntries.includes('folder/nested/inside.txt'),
      'Dataverse ZIP should recursively include files from referenced directories',
    )
    assert.ok(
      preservedZipEntries.includes('folder/nested/arp.txt'),
      'Dataverse ZIP should include Dataverse-style file entities from directoryLabel/name',
    )
    const zippedCrate = JSON.parse(
      preservedZipMap.get('ro-crate-metadata.json').toString('utf8'),
    )
    const zippedArpFile = zippedCrate['@graph'].find(
      (entity) => entity['@id'] === 'https://example.org/arp/file/arp.txt',
    )
    assert.equal(zippedArpFile.hash, '52ba4854ce5aa6ffc83fe901c7006426')
    assert.equal(zippedArpFile.contentSize, '4')
    assert.equal(zippedArpFile.encodingFormat, 'text/plain')
    assert.equal(zippedArpFile.directoryLabel, 'folder/nested')
    const zippedContext = Array.isArray(zippedCrate['@context'])
      ? zippedCrate['@context'].find(
          (entry) => entry && typeof entry === 'object' && !Array.isArray(entry),
        )
      : undefined
    assert.equal(
      zippedContext.directoryLabel,
      'https://dataverse.org/schema/file/directoryLabel',
    )
    assert.equal(zippedContext.hash, 'https://dataverse.org/schema/file/hash')
    fs.rmSync(path.dirname(preservedZipPath), { recursive: true, force: true })

    const crateWithArpPid = JSON.parse(fs.readFileSync(cratePath, 'utf8'))
    const crateWithArpPidRoot = crateWithArpPid['@graph'].find((entity) => entity['@id'] === './')
    crateWithArpPidRoot['@arpPid'] = 'hdl:21.T15999/DSDDEV/EXISTING'
    fs.writeFileSync(cratePath, `${JSON.stringify(crateWithArpPid, null, 2)}\n`, 'utf8')

    const createWithArpPidResponse = await request('tools/call', {
      name: 'upload_rocrate_to_dataverse',
      arguments: {
        cratePath,
        write: true,
        baseUrl: webToolsMock.baseUrl,
        ownerId: 'root',
      },
    })
    assert.ok(createWithArpPidResponse.error, 'create upload should fail when crate has @arpPid')
    assert.match(createWithArpPidResponse.error.message, /Create upload blocked: crate already contains @arpPid/)

    const updatePidMismatchResponse = await request('tools/call', {
      name: 'upload_rocrate_to_dataverse',
      arguments: {
        cratePath,
        write: true,
        baseUrl: webToolsMock.baseUrl,
        pid: 'hdl:21.T15999/DSDDEV/OTHER',
      },
    })
    assert.ok(updatePidMismatchResponse.error, 'update upload should fail on pid mismatch')
    assert.match(updatePidMismatchResponse.error.message, /Update upload blocked: pid mismatch/)

    const downloadDataverseResponse = await request('tools/call', {
      name: 'download_rocrate_from_dataverse',
      arguments: {
        cratePath,
        pid: 'hdl:21.T15999/DSDDEV/DOWNLOADED',
        write: true,
        baseUrl: webToolsMock.baseUrl,
      },
    })
    const downloadDataversePayload = JSON.parse(downloadDataverseResponse.result.content[0].text)
    assert.equal(downloadDataversePayload.mode, 'local')
    assert.equal(downloadDataversePayload.writeApplied, true)
    assert.equal(downloadDataversePayload.status, 200)
    assert.equal(downloadDataversePayload.pid, 'hdl:21.T15999/DSDDEV/DOWNLOADED')

    const crateAfterDownload = JSON.parse(fs.readFileSync(cratePath, 'utf8'))
    const rootAfterDownload = crateAfterDownload['@graph'].find((entity) => entity['@id'] === './')
    assert.equal(rootAfterDownload.name, 'Downloaded hdl:21.T15999/DSDDEV/DOWNLOADED')

    const localResolveProfileResponse = await request('tools/call', {
      name: 'resolve_profile_schema',
      arguments: {
        profileUrl,
      },
    })
    const localResolveProfilePayload = JSON.parse(localResolveProfileResponse.result.content[0].text)
    assert.equal(localResolveProfilePayload.mode, 'local')
    assert.equal(localResolveProfilePayload.profileUrls[0], profileUrl)
    assert.equal(localResolveProfilePayload.unresolvedUrls.length, 0)
    assert.equal(localResolveProfilePayload.profiles.length, 1)
    assert.equal(localResolveProfilePayload.profiles[0].loaded, true)
    assert.equal(localResolveProfilePayload.profiles[0].convertedPath, convertedRelativePath)

    const localContextResponse = await request('tools/call', {
      name: 'get_rocrate_context',
      arguments: {
        cratePath,
      },
    })
    const localContextPayload = JSON.parse(localContextResponse.result.content[0].text)
    assert.equal(localContextPayload.mode, 'local')
    assert.equal(localContextPayload.profileResolution.profileUrls[0], profileUrl)
    assert.equal(localContextPayload.profileResolution.unresolvedUrls.length, 0)
    assert.equal(localContextPayload.profileResolution.profiles[0].loaded, true)
    assert.equal(localContextPayload.conformance.valid, true)
    assert.ok(
      localContextPayload.profileRules?.valueSetsByClass?.Dataset?.subject?.values?.includes(
        'Computer and Information Science',
      ),
      'get_rocrate_context summary should include Dataset.subject value-set hints',
    )

    const suggestContextResponse = await request('tools/call', {
      name: 'suggest_context_terms',
      arguments: {
        cratePath,
      },
    })
    const suggestContextPayload = JSON.parse(suggestContextResponse.result.content[0].text)
    assert.equal(suggestContextPayload.mode, 'local')
    assert.ok(Array.isArray(suggestContextPayload.missingTerms))
    assert.ok(typeof suggestContextPayload.mergeContext === 'object')

    const profileValidationCratePath = path.join(tempRoot, 'profile-validation-crate.json')
    fs.writeFileSync(
      profileValidationCratePath,
      `${JSON.stringify(
        {
          '@context': [
            'https://w3id.org/ro/crate/1.1/context',
            {
              datasetContact: 'https://dataverse.org/schema/citation/datasetContact',
              datasetContactEmail: 'https://dataverse.org/schema/citation/datasetContactEmail',
              datasetContactName: 'https://dataverse.org/schema/citation/datasetContactName',
            },
          ],
          '@graph': [
            {
              '@id': './',
              '@type': 'Dataset',
              name: 'Research data package',
              title: 'Root dataset title',
              author: 'Example Author',
              datasetContact: [{ '@id': '#dataset-contact-hun-ren-arp' }],
              hasPart: [],
              conformsTo: [{ '@id': profileUrl }],
              subject: ['Computer and Information Science'],
            },
            {
              '@id': '#dataset-contact-hun-ren-arp',
              '@type': 'datasetContact',
              name: 'HUN-REN ARP contact',
              datasetContactName: 'HUN-REN ARP',
              datasetContactEmail: 'contact@example.org',
            },
            {
              '@id': 'ro-crate-metadata.json',
              '@type': 'CreativeWork',
              name: 'RO-Crate metadata descriptor',
              conformsTo: { '@id': 'https://w3id.org/ro/crate/1.1' },
              about: { '@id': './' },
            },
          ],
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const strictValidateResponse = await request('tools/call', {
      name: 'validate_crate',
      arguments: {
        cratePath: profileValidationCratePath,
        strict: true,
      },
    })
    const strictValidatePayload = JSON.parse(strictValidateResponse.result.content[0].text)
    assert.equal(typeof strictValidatePayload.valid, 'boolean')
    assert.ok(Array.isArray(strictValidatePayload.errors))
    assert.ok(Array.isArray(strictValidatePayload.warnings))
    assert.equal(strictValidatePayload.valid, true, 'baseline profiled crate should validate')

    const crateMissingRootRequired = JSON.parse(
      fs.readFileSync(profileValidationCratePath, 'utf8'),
    )
    const rootMissingTitle = crateMissingRootRequired['@graph'].find(
      (entity) => entity['@id'] === './',
    )
    delete rootMissingTitle.title
    fs.writeFileSync(
      profileValidationCratePath,
      `${JSON.stringify(crateMissingRootRequired, null, 2)}\n`,
      'utf8',
    )
    const missingRootRequiredResponse = await request('tools/call', {
      name: 'validate_crate',
      arguments: {
        cratePath: profileValidationCratePath,
        strict: true,
      },
    })
    const missingRootRequiredPayload = JSON.parse(
      missingRootRequiredResponse.result.content[0].text,
    )
    assert.equal(missingRootRequiredPayload.valid, false)
    assert.ok(
      missingRootRequiredPayload.errors.some(
        (message) =>
          typeof message === 'string' &&
          message.includes('Entity ./ is missing required property: title'),
      ),
      'validate_crate should honor input-level required fields on root profiled entities',
    )

    const crateMissingContactEmail = JSON.parse(
      fs.readFileSync(profileValidationCratePath, 'utf8'),
    )
    const rootRestoredTitle = crateMissingContactEmail['@graph'].find(
      (entity) => entity['@id'] === './',
    )
    rootRestoredTitle.title = 'Root dataset title'
    const contactMissingEmail = crateMissingContactEmail['@graph'].find(
      (entity) => entity['@id'] === '#dataset-contact-hun-ren-arp',
    )
    delete contactMissingEmail.datasetContactEmail
    fs.writeFileSync(
      profileValidationCratePath,
      `${JSON.stringify(crateMissingContactEmail, null, 2)}\n`,
      'utf8',
    )
    const missingContactStrictResponse = await request('tools/call', {
      name: 'validate_crate',
      arguments: {
        cratePath: profileValidationCratePath,
        strict: true,
      },
    })
    const missingContactStrictPayload = JSON.parse(
      missingContactStrictResponse.result.content[0].text,
    )
    assert.equal(missingContactStrictPayload.valid, false)
    assert.ok(
      missingContactStrictPayload.errors.some(
        (message) =>
          typeof message === 'string' &&
          message.includes('Entity #dataset-contact-hun-ren-arp is missing required property: datasetContactEmail'),
      ),
      'validate_crate should enforce required fields on referenced compound entities',
    )

    const missingContactAllowMissingResponse = await request('tools/call', {
      name: 'validate_crate',
      arguments: {
        cratePath: profileValidationCratePath,
        profileRequiredMode: 'allow_missing',
      },
    })
    const missingContactAllowMissingPayload = JSON.parse(
      missingContactAllowMissingResponse.result.content[0].text,
    )
    assert.equal(missingContactAllowMissingPayload.valid, true)
    assert.ok(
      missingContactAllowMissingPayload.warnings.some(
        (message) =>
          typeof message === 'string' &&
          message.includes('Entity #dataset-contact-hun-ren-arp is missing required property: datasetContactEmail'),
      ),
      'allow_missing should report referenced compound required fields as warnings',
    )

    contactMissingEmail.datasetContactEmail = 'contact@example.org'
    fs.writeFileSync(
      profileValidationCratePath,
      `${JSON.stringify(crateMissingContactEmail, null, 2)}\n`,
      'utf8',
    )
    const restoredContactStrictResponse = await request('tools/call', {
      name: 'validate_crate',
      arguments: {
        cratePath: profileValidationCratePath,
        strict: true,
      },
    })
    const restoredContactStrictPayload = JSON.parse(
      restoredContactStrictResponse.result.content[0].text,
    )
    assert.equal(restoredContactStrictPayload.valid, true)

    const crateWithInvalidSubject = JSON.parse(fs.readFileSync(cratePath, 'utf8'))
    const rootWithInvalidSubject = crateWithInvalidSubject['@graph'].find(
      (entity) => entity['@id'] === './',
    )
    rootWithInvalidSubject.subject = ['research data management']
    fs.writeFileSync(cratePath, `${JSON.stringify(crateWithInvalidSubject, null, 2)}\n`, 'utf8')
    const invalidSubjectValidateResponse = await request('tools/call', {
      name: 'validate_crate',
      arguments: {
        cratePath,
        strict: true,
      },
    })
    const invalidSubjectValidatePayload = JSON.parse(
      invalidSubjectValidateResponse.result.content[0].text,
    )
    assert.equal(invalidSubjectValidatePayload.valid, false)
    assert.ok(
      invalidSubjectValidatePayload.errors.some(
        (message) =>
          typeof message === 'string' &&
          message.includes('invalid value(s) for subject') &&
          message.includes('research data management'),
      ),
      'validate_crate should report invalid subject values for profile value-sets',
    )
    assert.ok(
      invalidSubjectValidatePayload.valueSetHints?.['Dataset.subject']?.includes(
        'Computer and Information Science',
      ),
      'validate_crate should expose allowed values for Dataset.subject',
    )
    assert.ok(
      Array.isArray(invalidSubjectValidatePayload.valueSetViolations) &&
        invalidSubjectValidatePayload.valueSetViolations.some(
          (violation) =>
            violation?.property === 'subject' &&
            Array.isArray(violation.invalidValues) &&
            violation.invalidValues.includes('research data management'),
        ),
      'validate_crate should return structured value-set violations',
    )

    rootWithInvalidSubject.subject = ['Computer and Information Science']
    fs.writeFileSync(cratePath, `${JSON.stringify(crateWithInvalidSubject, null, 2)}\n`, 'utf8')

    const localCrateBeforeScoped = JSON.parse(fs.readFileSync(cratePath, 'utf8'))
    const localRoot = localCrateBeforeScoped['@graph'].find((entity) => entity['@id'] === './')
    localRoot.forbiddenExisting = 'legacy'
    fs.writeFileSync(cratePath, `${JSON.stringify(localCrateBeforeScoped, null, 2)}\n`, 'utf8')
    const scopedApplyResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        changeSet: {
          updateEntities: [{ '@id': './', merge: { name: 'Root scoped update' } }],
        },
      },
    })
    assert.ok(
      scopedApplyResponse.error,
      'scoped apply should fail when an existing custom property lacks @context mapping',
    )
    assert.match(scopedApplyResponse.error.message, /custom property without @context mapping|Missing @context mapping/)

    const scopedCleanupResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        confirmDestructive: true,
        changeSet: {
          updateEntities: [{ '@id': './', unset: ['forbiddenExisting'] }],
        },
      },
    })
    assert.ok(scopedCleanupResponse.result, 'cleanup of legacy forbidden field should succeed')

    const disallowedEditResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        changeSet: {
          mergeContext: {
            forbiddenField: 'https://example.org/vocab/forbiddenField',
          },
          updateEntities: [{ '@id': './', merge: { forbiddenField: 'x' } }],
        },
      },
    })
    assert.ok(
      disallowedEditResponse.result,
      'custom profile property edit should be advisory, not a hard failure',
    )

    const strictContextModeResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        contextMode: 'strict',
        changeSet: {
          updateEntities: [{ '@id': './', merge: { customTerm: 'strict mode should fail' } }],
        },
      },
    })
    assert.ok(
      strictContextModeResponse.error,
      'strict context mode should fail on custom terms without @context mappings',
    )
    assert.match(strictContextModeResponse.error.message, /Missing @context mapping for custom term: customTerm/)

    const autoReconcileContextModeResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        changeSet: {
          updateEntities: [{ '@id': './', merge: { customTerm: 'auto reconcile adds mapping' } }],
        },
      },
    })
    const autoReconcileContextModePayload = JSON.parse(
      autoReconcileContextModeResponse.result.content[0].text,
    )
    assert.equal(autoReconcileContextModePayload.contextMode, 'auto_reconcile')
    assert.ok(autoReconcileContextModePayload.contextPatch.addedTerms.includes('customTerm'))

    const crateAfterContextAutoReconcile = JSON.parse(fs.readFileSync(cratePath, 'utf8'))
    const rootAfterContextAutoReconcile = crateAfterContextAutoReconcile['@graph'].find(
      (entity) => entity['@id'] === './',
    )
    assert.equal(rootAfterContextAutoReconcile.customTerm, 'auto reconcile adds mapping')
    const contextObjects = Array.isArray(crateAfterContextAutoReconcile['@context'])
      ? crateAfterContextAutoReconcile['@context'].filter(
          (item) => item && typeof item === 'object' && !Array.isArray(item),
        )
      : []
    const hasCustomTermMapping = contextObjects.some(
      (ctx) => ctx.customTerm === 'https://example.org/vocab/customTerm',
    )
    assert.equal(hasCustomTermMapping, true, 'auto_reconcile should add missing context mappings')

    await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        contextMode: 'strict',
        changeSet: {
          mergeContext: {
            customTerm: 'https://example.org/vocab/customTerm-wrong',
          },
        },
      },
    })

    const autoAddContextModeResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        contextMode: 'auto_add',
        changeSet: {
          updateEntities: [{ '@id': './', merge: { customTerm: 'auto add keeps existing mapping' } }],
        },
      },
    })
    const autoAddContextModePayload = JSON.parse(autoAddContextModeResponse.result.content[0].text)
    assert.equal(autoAddContextModePayload.contextMode, 'auto_add')
    assert.ok(
      autoAddContextModePayload.contextPatch.skippedConflicts.some(
        (entry) => entry.term === 'customTerm',
      ),
      'auto_add should keep conflicting mappings unchanged',
    )

    const crateAfterContextAutoAdd = JSON.parse(fs.readFileSync(cratePath, 'utf8'))
    const contextAfterAutoAdd = Array.isArray(crateAfterContextAutoAdd['@context'])
      ? crateAfterContextAutoAdd['@context'].find(
          (item) =>
            item &&
            typeof item === 'object' &&
            !Array.isArray(item) &&
            Object.prototype.hasOwnProperty.call(item, 'customTerm'),
        )
      : undefined
    assert.ok(contextAfterAutoAdd && typeof contextAfterAutoAdd === 'object')
    assert.equal(
      contextAfterAutoAdd.customTerm,
      'https://example.org/vocab/customTerm-wrong',
      'auto_add should not rewrite existing mapping',
    )

    const autoReconcileConflictResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        contextMode: 'auto_reconcile',
        changeSet: {
          updateEntities: [{ '@id': './', merge: { customTerm: 'auto reconcile fixes mapping' } }],
        },
      },
    })
    const autoReconcileConflictPayload = JSON.parse(
      autoReconcileConflictResponse.result.content[0].text,
    )
    assert.ok(
      autoReconcileConflictPayload.contextPatch.reconciledTerms.some(
        (entry) => entry.term === 'customTerm',
      ),
      'auto_reconcile should rewrite conflicting mappings',
    )
    const crateAfterContextReconcileConflict = JSON.parse(fs.readFileSync(cratePath, 'utf8'))
    const contextAfterReconcile = Array.isArray(crateAfterContextReconcileConflict['@context'])
      ? crateAfterContextReconcileConflict['@context'].find(
          (item) =>
            item &&
            typeof item === 'object' &&
            !Array.isArray(item) &&
            Object.prototype.hasOwnProperty.call(item, 'customTerm'),
        )
      : undefined
    assert.ok(contextAfterReconcile && typeof contextAfterReconcile === 'object')
    assert.equal(
      contextAfterReconcile.customTerm,
      'https://example.org/vocab/customTerm',
      'auto_reconcile should fix conflicting mapping',
    )

    const preparedPayloadResponse = await request('tools/call', {
      name: 'prepare_remote_profile_payload',
      arguments: {
        cratePath,
      },
    })
    const preparedPayload = JSON.parse(preparedPayloadResponse.result.content[0].text)
    assert.equal(preparedPayload.mode, 'local')
    assert.equal(preparedPayload.profileUrls[0], profileUrl)
    assert.equal(
      preparedPayload.schemaIndex.conformsToIndex[profileUrl][0],
      'b060794f-1a81-41fc-ab35-f51569fa1188',
    )
    assert.ok(preparedPayload.profileContents['b060794f-1a81-41fc-ab35-f51569fa1188'])

    const remoteCrate = {
      '@context': 'https://w3id.org/ro/crate/1.1/context',
      '@graph': [
        {
          '@id': './',
          '@type': 'Dataset',
          name: 'Remote Root',
          title: 'Remote title',
          author: 'Remote Author',
          conformsTo: [{ '@id': profileUrl }],
        },
        {
          '@id': 'ro-crate-metadata.json',
          '@type': 'CreativeWork',
          name: 'RO-Crate Metadata',
          about: { '@id': './' },
        },
      ],
    }

    const remoteReadResponse = await request('tools/call', {
      name: 'read_crate',
      arguments: {
        mode: 'remote',
        crate: remoteCrate,
      },
    })
    const remoteReadPayload = JSON.parse(remoteReadResponse.result.content[0].text)
    assert.equal(remoteReadPayload['@graph'][0].name, 'Remote Root')

    const remoteUploadResponse = await request('tools/call', {
      name: 'upload_rocrate_to_dataverse',
      arguments: {
        mode: 'remote',
        crate: remoteCrate,
        write: true,
        baseUrl: webToolsMock.baseUrl,
        pid: 'hdl:21.T15999/DSDDEV/REMOTEPID',
        responseMode: 'full',
      },
    })
    const remoteUploadPayload = JSON.parse(remoteUploadResponse.result.content[0].text)
    assert.equal(remoteUploadPayload.mode, 'remote')
    assert.equal(remoteUploadPayload.writeApplied, false)
    assert.equal(remoteUploadPayload.status, 200)
    assert.equal(remoteUploadPayload.pid, 'hdl:21.T15999/DSDDEV/REMOTEPID')
    assert.equal(remoteUploadPayload.ingestedCrate['@graph'].find((entity) => entity['@id'] === './').name, 'Remote Root')

    const remoteDownloadResponse = await request('tools/call', {
      name: 'download_rocrate_from_dataverse',
      arguments: {
        mode: 'remote',
        baseUrl: webToolsMock.baseUrl,
        pid: 'hdl:21.T15999/DSDDEV/REMOTE-DOWNLOAD',
      },
    })
    const remoteDownloadPayload = JSON.parse(remoteDownloadResponse.result.content[0].text)
    assert.equal(remoteDownloadPayload.mode, 'remote')
    assert.equal(remoteDownloadPayload.writeApplied, false)
    assert.equal(remoteDownloadPayload.pid, 'hdl:21.T15999/DSDDEV/REMOTE-DOWNLOAD')
    assert.equal(
      remoteDownloadPayload.crate['@graph'].find((entity) => entity['@id'] === './').name,
      'Downloaded hdl:21.T15999/DSDDEV/REMOTE-DOWNLOAD',
    )

    const remoteContextResponse = await request('tools/call', {
      name: 'get_rocrate_context',
      arguments: {
        mode: 'remote',
        crate: remoteCrate,
      },
    })
    const remoteContextPayload = JSON.parse(remoteContextResponse.result.content[0].text)
    assert.equal(remoteContextPayload.mode, 'remote')
    assert.equal(remoteContextPayload.profileResolution.profileUrls[0], profileUrl)
    assert.equal(remoteContextPayload.profileResolution.unresolvedUrls[0], profileUrl)

    const remoteSchemaIndex = preparedPayload.schemaIndex
    const remoteProfileContents = preparedPayload.profileContents
    const createProfileContextResponse = await request('tools/call', {
      name: 'create_profile_context',
      arguments: {
        schemaIndex: remoteSchemaIndex,
        profileContents: remoteProfileContents,
        profileUrls: [profileUrl],
        ttlSec: 300,
      },
    })
    const createProfileContextPayload = JSON.parse(
      createProfileContextResponse.result.content[0].text,
    )
    const profileContextId = createProfileContextPayload.profileContext.profileContextId
    assert.equal(typeof profileContextId, 'string')
    assert.equal(createProfileContextPayload.profileContext.profileUrls[0], profileUrl)

    const profileContextInfoResponse = await request('tools/call', {
      name: 'get_profile_context_info',
      arguments: {
        profileContextId,
      },
    })
    const profileContextInfoPayload = JSON.parse(profileContextInfoResponse.result.content[0].text)
    assert.equal(profileContextInfoPayload.profileContextId, profileContextId)
    assert.ok(profileContextInfoPayload.profileCount >= 1)

    const resolveProfileResponse = await request('tools/call', {
      name: 'resolve_profile_schema',
      arguments: {
        mode: 'remote',
        profileUrl,
      },
    })
    const resolveProfilePayload = JSON.parse(resolveProfileResponse.result.content[0].text)
    assert.equal(resolveProfilePayload.mode, 'remote')
    assert.equal(resolveProfilePayload.profileUrls[0], profileUrl)
    assert.equal(resolveProfilePayload.unresolvedUrls[0], profileUrl)
    assert.equal(resolveProfilePayload.profiles.length, 0)

    const resolveProfileWithInlineResponse = await request('tools/call', {
      name: 'resolve_profile_schema',
      arguments: {
        mode: 'remote',
        profileUrl,
        profileContextId,
      },
    })
    const resolveProfileWithInlinePayload = JSON.parse(
      resolveProfileWithInlineResponse.result.content[0].text,
    )
    assert.equal(resolveProfileWithInlinePayload.mode, 'remote')
    assert.equal(resolveProfileWithInlinePayload.unresolvedUrls.length, 0)
    assert.equal(resolveProfileWithInlinePayload.profiles.length, 1)
    assert.equal(resolveProfileWithInlinePayload.profiles[0].loaded, true)

    const remoteContextWithInlineResponse = await request('tools/call', {
      name: 'get_rocrate_context',
      arguments: {
        mode: 'remote',
        crate: remoteCrate,
        profileContextId,
      },
    })
    const remoteContextWithInlinePayload = JSON.parse(
      remoteContextWithInlineResponse.result.content[0].text,
    )
    assert.equal(remoteContextWithInlinePayload.conformance.valid, true)
    assert.equal(remoteContextWithInlinePayload.profileResolution.unresolvedUrls.length, 0)

    const remoteApplyResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        mode: 'remote',
        crate: remoteCrate,
        write: true,
        changeSet: {
          updateEntities: [{ '@id': './', merge: { name: 'Remote Updated Root' } }],
        },
      },
    })
    const remoteApplyPayload = JSON.parse(remoteApplyResponse.result.content[0].text)
    assert.equal(remoteApplyPayload.mode, 'remote')
    assert.equal(remoteApplyPayload.writeApplied, false)
    assert.equal(remoteApplyPayload.crate['@graph'][0].name, 'Remote Updated Root')

    const remoteAddProfileResponse = await request('tools/call', {
      name: 'update_profile_conforms_to',
      arguments: {
        mode: 'remote',
        crate: remoteCrate,
        write: true,
        add: [extraProfileUrl],
      },
    })
    const remoteAddProfilePayload = JSON.parse(
      remoteAddProfileResponse.result.content[0].text,
    )
    assert.equal(remoteAddProfilePayload.mode, 'remote')
    assert.equal(remoteAddProfilePayload.writeApplied, false)
    const remoteAddProfileRoot = remoteAddProfilePayload.crate['@graph'].find(
      (entity) => entity['@id'] === './',
    )
    const remoteAddProfileUrls = (remoteAddProfileRoot.conformsTo || []).map(
      (entry) => entry['@id'],
    )
    assert.ok(remoteAddProfileUrls.includes(profileUrl))
    assert.ok(remoteAddProfileUrls.includes(extraProfileUrl))

    const remoteDisallowedEditResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        mode: 'remote',
        crate: remoteCrate,
        write: true,
        profileContextId,
        changeSet: {
          mergeContext: {
            forbiddenRemote: 'https://example.org/vocab/forbiddenRemote',
          },
          updateEntities: [{ '@id': './', merge: { forbiddenRemote: 'x' } }],
        },
      },
    })
    assert.ok(
      remoteDisallowedEditResponse.result,
      'remote custom profile property edit should be advisory, not a hard failure',
    )

    const remoteValidateResponse = await request('tools/call', {
      name: 'validate_crate',
      arguments: {
        mode: 'remote',
        crate: remoteCrate,
      },
    })
    const remoteValidatePayload = JSON.parse(remoteValidateResponse.result.content[0].text)
    assert.equal(typeof remoteValidatePayload.valid, 'boolean')

    const invalidNestedGraphValidateResponse = await request('tools/call', {
      name: 'validate_crate',
      arguments: {
        mode: 'remote',
        crate: {
          '@context': 'https://w3id.org/ro/crate/1.1/context',
          '@graph': [
            {
              '@id': './',
              '@type': 'Dataset',
              name: 'Bad Root',
              '@graph': [{ '@id': './', author: [{ '@id': '#author-1' }] }],
            },
            {
              '@id': 'ro-crate-metadata.json',
              '@type': 'CreativeWork',
              name: 'RO-Crate Metadata',
              about: { '@id': './' },
            },
          ],
        },
      },
    })
    const invalidNestedGraphValidatePayload = JSON.parse(
      invalidNestedGraphValidateResponse.result.content[0].text,
    )
    assert.equal(
      invalidNestedGraphValidatePayload.valid,
      false,
      'validate_crate should reject entity-level @graph properties',
    )
    assert.ok(
      invalidNestedGraphValidatePayload.errors.some(
        (error) => error.code === 'invalid_nested_graph',
      ),
      'validate_crate should report invalid_nested_graph for entity-level @graph',
    )

    const remoteWriteResponse = await request('tools/call', {
      name: 'write_crate_atomic',
      arguments: {
        mode: 'remote',
        crate: remoteCrate,
        profileContextId,
      },
    })
    const remoteWritePayload = JSON.parse(remoteWriteResponse.result.content[0].text)
    assert.equal(remoteWritePayload.mode, 'remote')
    assert.equal(remoteWritePayload.writeApplied, false)

    const remoteWriteAutoContextResponse = await request('tools/call', {
      name: 'write_crate_atomic',
      arguments: {
        mode: 'remote',
        profileContextId,
        responseMode: 'full',
        crate: {
          '@context': 'https://w3id.org/ro/crate/1.1/context',
          '@graph': [
            {
              '@id': './',
              '@type': 'Dataset',
              name: 'Context patch target',
              title: 'Context patch target',
              customTerm: 'value-needing-context',
              conformsTo: [{ '@id': profileUrl }],
            },
            {
              '@id': 'ro-crate-metadata.json',
              '@type': 'CreativeWork',
              name: 'RO-Crate Metadata',
              conformsTo: { '@id': 'https://w3id.org/ro/crate/1.1' },
              about: { '@id': './' },
            },
          ],
        },
      },
    })
    assert.ok(remoteWriteAutoContextResponse.result, 'write_crate_atomic should auto-patch context')
    const remoteWriteAutoContextPayload = JSON.parse(
      remoteWriteAutoContextResponse.result.content[0].text,
    )
    assert.equal(remoteWriteAutoContextPayload.ok, true)
    const remotePatchedContext = remoteWriteAutoContextPayload.crate['@context']
    const remotePatchedContextObject = Array.isArray(remotePatchedContext)
      ? remotePatchedContext.find(
          (item) => item && typeof item === 'object' && !Array.isArray(item),
        )
      : undefined
    assert.equal(
      remotePatchedContextObject?.customTerm,
      'https://example.org/vocab/customTerm',
      'write_crate_atomic should add missing customTerm @context mapping',
    )

    const deleteProfileContextResponse = await request('tools/call', {
      name: 'delete_profile_context',
      arguments: {
        profileContextId,
      },
    })
    const deleteProfileContextPayload = JSON.parse(
      deleteProfileContextResponse.result.content[0].text,
    )
    assert.equal(deleteProfileContextPayload.deleted, true)

    // Fallback transport check: newline-delimited JSON-RPC should also work.
    const ping = await request('ping', {}, 'jsonl')
    assert.ok(ping.result, 'jsonl ping should return result')

    const reloaded = JSON.parse(fs.readFileSync(cratePath, 'utf8'))
    const rootEntity = reloaded['@graph'].find((entity) => entity['@id'] === './')
    assert.equal(rootEntity.name, 'Downloaded hdl:21.T15999/DSDDEV/DOWNLOADED')

    console.log('rocrate-mcp-server test passed')
  } finally {
    child.kill()
    await webToolsMock.close()
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')

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

async function startMockWebToolsServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/page') {
      res.statusCode = 200
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(
        '<html><head><title>Test Page</title><style>.x{color:red;}</style></head><body><h1>Hello</h1><script>window.x=1</script><p>World</p></body></html>',
      )
      return
    }
    if (req.url === '/search' && req.method === 'POST') {
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
  const webToolsMock = await startMockWebToolsServer()
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rocrate-mcp-test-'))
  const aromaRoot = path.join(tempRoot, 'aroma-root')
  fs.mkdirSync(path.join(aromaRoot, 'metadata-schemas', 'ro-crate'), { recursive: true })
  const profileUrl = 'https://w3id.org/arp/schema/33677b82-7973-3e4c-b09d-b5189e095627'
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
              { name: 'title', required: true },
              { name: 'author', required: true },
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
            hasPart: [],
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
      null,
      2,
    )}\n`,
    'utf8',
  )
  fs.mkdirSync(path.join(tempRoot, 'folder'))
  fs.writeFileSync(path.join(tempRoot, 'folder', 'x.txt'), 'hello\n', 'utf8')

  const serverPath = path.resolve(__dirname, '../lib/server.js')
  const child = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TAVILY_API_KEY: 'test-key',
      TAVILY_API_URL: `${webToolsMock.baseUrl}/search`,
      AROMA_ROOT_PATH: aromaRoot,
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
  function request(method, params, mode = 'lf') {
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
    assert.ok(toolNames.includes('get_rocrate_context'), 'get_rocrate_context tool should exist')
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
    assert.ok(toolNames.includes('compute_delta'), 'compute_delta tool should exist')
    assert.ok(toolNames.includes('apply_changes'), 'apply_changes tool should exist')
    assert.ok(
      toolNames.includes('add_profile_conforms_to'),
      'add_profile_conforms_to tool should exist',
    )

    const deltaResponse = await request('tools/call', {
      name: 'compute_delta',
      arguments: { cratePath, rootPath: tempRoot },
    })
    const deltaPayload = JSON.parse(deltaResponse.result.content[0].text)
    assert.ok(deltaPayload.summary.newEntities >= 2, 'Expected structural additions')

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
      name: 'add_profile_conforms_to',
      arguments: {
        cratePath,
        write: true,
        profileUrl: extraProfileUrl,
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

    const outOfScopeUpdateResponse = await request('tools/call', {
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
    assert.ok(outOfScopeUpdateResponse.error, 'out-of-profile target update should fail by default')
    assert.match(
      outOfScopeUpdateResponse.error.message,
      /without matching conformsTo/,
    )

    const outOfScopeAllowedResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        allowOutOfProfileTargets: true,
        changeSet: {
          updateEntities: [
            {
              '@id': 'file://./unprofiled/',
              merge: { title: 'Allowed by explicit confirmation' },
            },
          ],
        },
      },
    })
    assert.ok(outOfScopeAllowedResponse.result, 'confirmed out-of-profile target update should pass')

    await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        changeSet: {
          entityChanges: [{ '@id': './', upsert: { name: 'Updated By Alias' } }],
        },
      },
    })

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

    const missingWriteResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        changeSet: {
          updateEntities: [{ '@id': './', merge: { name: 'Missing write should fail' } }],
        },
      },
    })
    assert.ok(missingWriteResponse.error, 'apply_changes without write should fail')
    assert.match(missingWriteResponse.error.message, /requires write=true/)

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

    const strictValidateResponse = await request('tools/call', {
      name: 'validate_crate',
      arguments: {
        cratePath,
        strict: true,
      },
    })
    const strictValidatePayload = JSON.parse(strictValidateResponse.result.content[0].text)
    assert.equal(strictValidatePayload.profile.requiredMode, 'enforce_required')
    assert.equal(strictValidatePayload.profile.validationMode, 'full')
    assert.equal(strictValidatePayload.profile.valid, false)
    assert.ok(
      strictValidatePayload.profile.errors.some((error) =>
        String(error).includes('missing required property'),
      ),
    )

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
    assert.ok(scopedApplyResponse.result, 'scoped apply should ignore unrelated pre-existing violations')

    const disallowedEditResponse = await request('tools/call', {
      name: 'apply_changes',
      arguments: {
        cratePath,
        write: true,
        changeSet: {
          updateEntities: [{ '@id': './', merge: { forbiddenField: 'x' } }],
        },
      },
    })
    assert.ok(disallowedEditResponse.error, 'disallowed profile edit should fail')
    assert.match(disallowedEditResponse.error.message, /Profile conformance failed/)

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
      name: 'add_profile_conforms_to',
      arguments: {
        mode: 'remote',
        crate: remoteCrate,
        write: true,
        profileUrls: [extraProfileUrl],
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
          updateEntities: [{ '@id': './', merge: { forbiddenRemote: 'x' } }],
        },
      },
    })
    assert.ok(remoteDisallowedEditResponse.error, 'remote disallowed profile edit should fail')
    assert.match(remoteDisallowedEditResponse.error.message, /Profile conformance failed/)

    const remoteValidateResponse = await request('tools/call', {
      name: 'validate_crate',
      arguments: {
        mode: 'remote',
        crate: remoteCrate,
      },
    })
    const remoteValidatePayload = JSON.parse(remoteValidateResponse.result.content[0].text)
    assert.equal(typeof remoteValidatePayload.valid, 'boolean')

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
    assert.equal(rootEntity.name, 'Root scoped update')

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

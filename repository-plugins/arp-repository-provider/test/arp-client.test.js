// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')

const { ArpClient } = require('../src/arp-client')

function mockTransport(body = '{}', status = 200, allow) {
  const calls = []
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return {
        ok: status >= 200 && status < 300,
        status,
        url,
        headers: { get: name => name === 'allow' ? allow : undefined },
        text: async () => body,
      }
    },
  }
}

describe('ArpClient RO-Crate transport', () => {
  it('uses the existing strict validation endpoint and authenticated JSON POST', async () => {
    const transport = mockTransport('{"status":"OK"}')
    const crate = { '@graph': [{ '@id': './' }] }
    const client = new ArpClient({
      baseUrl: 'https://repo.example.org/', token: 'secret', fetchImpl: transport.fetchImpl,
    })

    const result = await client.validateRoCrate(crate)

    assert.equal(transport.calls[0].url, 'https://repo.example.org/api/arp/validateRoCrate?strict=true')
    assert.equal(transport.calls[0].init.method, 'POST')
    assert.deepEqual(transport.calls[0].init.headers, {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-dataverse-key': 'secret',
    })
    assert.equal(transport.calls[0].init.body, JSON.stringify(crate))
    assert.equal(transport.calls[0].init.redirect, 'follow')
    assert.deepEqual(result.payload, { status: 'OK' })
  })

  it('fetches a remote RO-Crate without a content-type header or absent API token', async () => {
    const transport = mockTransport('{"@graph":[]}')
    const client = new ArpClient({
      baseUrl: 'https://repo.example.org', fetchImpl: transport.fetchImpl,
    })

    const result = await client.getRoCrate('doi:10.123/example')

    assert.equal(transport.calls[0].url, 'https://repo.example.org/api/arp/rocrate/doi:10.123/example')
    assert.equal(transport.calls[0].init.method, 'GET')
    assert.deepEqual(transport.calls[0].init.headers, { accept: 'application/json' })
    assert.deepEqual(result.payload, { '@graph': [] })
  })

  it('downloads an authenticated ARP RO-Crate ZIP as bytes', async () => {
    const calls = []
    const bytes = Uint8Array.from([80, 75, 3, 4])
    const client = new ArpClient({
      baseUrl: 'https://repo.example.org', token: 'secret',
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return {
          ok: true, status: 200, url,
          arrayBuffer: async () => bytes.buffer,
        }
      },
    })

    const result = await client.downloadRoCrateZip('hdl:21.15109/ARP/VYBLPE')

    assert.equal(calls[0].url,
      'https://repo.example.org/api/access/datafiles/rocrate/hdl:21.15109/ARP/VYBLPE')
    assert.deepEqual(calls[0].init.headers, {
      accept: 'application/zip', 'x-dataverse-key': 'secret',
    })
    assert.deepEqual(result.bytes, bytes)
  })

  it('downloads an authenticated Dataverse file as bytes', async () => {
    const calls = []
    const bytes = Uint8Array.from([1, 2, 3])
    const client = new ArpClient({
      baseUrl: 'https://repo.example.org', token: 'secret',
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return { ok: true, status: 200, url, arrayBuffer: async () => bytes.buffer }
      },
    })

    const result = await client.downloadFile('file/42')

    assert.equal(calls[0].url, 'https://repo.example.org/api/access/datafile/file%2F42')
    assert.equal(calls[0].init.headers.accept, 'application/octet-stream')
    assert.deepEqual(result.bytes, bytes)
  })

  it('posts a crate update and returns error payloads for operation-level handling', async () => {
    const transport = mockTransport('{"status":"ERROR","message":"Rejected"}', 400)
    const crate = { '@graph': [] }
    const client = new ArpClient({
      baseUrl: 'https://repo.example.org', token: 'secret', fetchImpl: transport.fetchImpl,
    })

    const result = await client.updateRoCrate('doi:10.123/example', crate)

    assert.equal(transport.calls[0].url, 'https://repo.example.org/api/arp/rocrate/doi:10.123/example')
    assert.equal(transport.calls[0].init.method, 'POST')
    assert.equal(transport.calls[0].init.body, JSON.stringify(crate))
    assert.equal(result.ok, false)
    assert.equal(result.status, 400)
    assert.deepEqual(result.payload, { status: 'ERROR', message: 'Rejected' })
  })

  it('preserves non-JSON error bodies for useful diagnostics', async () => {
    const transport = mockTransport('Gateway timeout', 504)
    const client = new ArpClient({
      baseUrl: 'https://repo.example.org', fetchImpl: transport.fetchImpl,
    })

    const result = await client.getRoCrate('123')

    assert.equal(result.payload, 'Gateway timeout')
    assert.equal(result.status, 504)
  })

  it('probes the ARP ZIP upload endpoint without changing repository state', async () => {
    const transport = mockTransport('', 200, 'GET, POST')
    const client = new ArpClient({
      baseUrl: 'https://repo.example.org', token: 'secret', fetchImpl: transport.fetchImpl,
    })

    assert.equal(await client.supportsRoCrateUpload(), true)
    assert.equal(transport.calls[0].url, 'https://repo.example.org/api/arp/uploadRoCrateZip')
    assert.equal(transport.calls[0].init.method, 'OPTIONS')
    assert.equal(transport.calls[0].init.headers['x-dataverse-key'], 'secret')
  })

  it('checks the authenticated user before accepting the API token', async () => {
    const transport = mockTransport('{"status":"OK","data":{"id":17,"displayName":"Alice"}}')
    const client = new ArpClient({
      baseUrl: 'https://repo.example.org', token: 'secret', fetchImpl: transport.fetchImpl,
    })

    assert.deepEqual(await client.validateToken(), { id: 17, displayName: 'Alice' })
    assert.equal(transport.calls[0].url, 'https://repo.example.org/api/v1/users/:me')
    assert.deepEqual(transport.calls[0].init.headers, {
      accept: 'application/json', 'x-dataverse-key': 'secret',
    })
  })

  it('rejects an expired or invalid token', async () => {
    const transport = mockTransport('{"status":"ERROR"}', 403)
    const client = new ArpClient({
      baseUrl: 'https://repo.example.org', token: 'expired', fetchImpl: transport.fetchImpl,
    })

    await assert.rejects(client.validateToken(), /ARP rejected the API token \(403\)/)
  })

  it('reads metadata languages from the selected Dataverse collection', async () => {
    const transport = mockTransport('{"status":"OK","data":["en"]}')
    const client = new ArpClient({
      baseUrl: 'https://repo.example.org', token: 'secret', fetchImpl: transport.fetchImpl,
    })

    const result = await client.getAllowedMetadataLanguages('my collection')

    assert.equal(transport.calls[0].url,
      'https://repo.example.org/api/v1/dataverses/my%20collection/allowedMetadataLanguages')
    assert.equal(transport.calls[0].init.method, 'GET')
    assert.deepEqual(result.payload, { status: 'OK', data: ['en'] })
  })

  it('creates a dataset with the existing Dataverse JSON request shape', async () => {
    const transport = mockTransport('{"status":"OK","data":{"persistentId":"doi:10.1/example"}}')
    const client = new ArpClient({
      baseUrl: 'https://repo.example.org', token: 'secret', fetchImpl: transport.fetchImpl,
    })
    const payload = { datasetVersion: { metadataBlocks: { citation: {} } } }

    const result = await client.createDataset('collection/one', payload)

    assert.equal(transport.calls[0].url,
      'https://repo.example.org/api/v1/dataverses/collection%2Fone/datasets')
    assert.equal(transport.calls[0].init.method, 'POST')
    assert.equal(transport.calls[0].init.body, JSON.stringify(payload))
    assert.equal(transport.calls[0].init.headers['content-type'], 'application/json')
    assert.equal(result.payload.data.persistentId, 'doi:10.1/example')
  })

  it('deletes the selected draft using the authenticated Dataverse endpoint', async () => {
    const transport = mockTransport('{"status":"OK"}')
    const client = new ArpClient({
      baseUrl: 'https://repo.example.org/', token: 'secret', fetchImpl: transport.fetchImpl,
    })

    const result = await client.deleteDraft('doi:10.1/example with space')

    assert.equal(transport.calls[0].url,
      'https://repo.example.org/api/v1/datasets/:persistentId/versions/:draft?persistentId=doi%3A10.1%2Fexample+with+space')
    assert.equal(transport.calls[0].init.method, 'DELETE')
    assert.deepEqual(transport.calls[0].init.headers, {
      accept: 'application/json', 'x-dataverse-key': 'secret',
    })
    assert.deepEqual(result.payload, { status: 'OK' })
  })

  it('replaces a file with the original metadata request shape', async () => {
    const transport = mockTransport('{"status":"OK"}')
    const client = new ArpClient({
      baseUrl: 'https://repo.example.org', token: 'secret', fetchImpl: transport.fetchImpl,
    })
    const content = Uint8Array.from([1, 2, 3])

    await client.replaceFile(42, 'folder/data.bin', 'Updated file', content)

    const { url, init } = transport.calls[0]
    assert.equal(url, 'https://repo.example.org/api/files/42/replace')
    assert.equal(init.method, 'POST')
    assert.equal(init.headers['content-type'], undefined)
    assert.equal(init.headers['x-dataverse-key'], 'secret')
    assert.equal(init.body.get('jsonData'),
      '{"forceReplace":false,"description":"Updated file","directoryLabel":"folder"}')
    assert.equal(init.body.get('file').name, 'data.bin')
    assert.deepEqual(new Uint8Array(await init.body.get('file').arrayBuffer()), content)
  })

  it('deletes an individual Dataverse file', async () => {
    const transport = mockTransport('{"status":"OK"}')
    const client = new ArpClient({
      baseUrl: 'https://repo.example.org', token: 'secret', fetchImpl: transport.fetchImpl,
    })

    await client.deleteFile('file/42')

    assert.equal(transport.calls[0].url, 'https://repo.example.org/api/files/file%2F42')
    assert.equal(transport.calls[0].init.method, 'DELETE')
    assert.equal(transport.calls[0].init.headers['x-dataverse-key'], 'secret')
  })

  it('uploads a file with directory metadata and lets FormData set its boundary', async () => {
    const transport = mockTransport('{"status":"OK"}')
    const client = new ArpClient({
      baseUrl: 'https://repo.example.org', token: 'secret', fetchImpl: transport.fetchImpl,
    })
    const content = Uint8Array.from([0, 127, 255])

    await client.uploadFile('doi:10.1/example', 'folder\\data.bin', content)

    const { url, init } = transport.calls[0]
    assert.equal(url,
      'https://repo.example.org/api/v1/datasets/:persistentId/add?persistentId=doi%3A10.1%2Fexample')
    assert.equal(init.method, 'POST')
    assert.equal(init.headers.accept, 'application/json')
    assert.equal(init.headers['content-type'], undefined)
    assert.equal(init.body.get('jsonData'), '{"directoryLabel":"folder"}')
    assert.equal(init.body.get('file').name, 'data.bin')
    assert.deepEqual(new Uint8Array(await init.body.get('file').arrayBuffer()), content)
  })

  it('keeps Dataverse collection browsing requests inside the ARP provider transport', async () => {
    const transport = mockTransport('{"status":"OK","data":[]}')
    const client = new ArpClient({
      baseUrl: 'https://repo.example.org', token: 'secret', fetchImpl: transport.fetchImpl,
    })

    await client.getCollection('research/data')
    await client.getCollectionContents('research/data')
    await client.searchCollections({ query: 'science*', subtree: 'root', perPage: 25, start: 50, queryEntities: false })
    await client.getCollectionUserPermissions('research/data')

    assert.deepEqual(transport.calls.map(call => call.url), [
      'https://repo.example.org/api/v1/dataverses/research%2Fdata?returnChildCount=true',
      'https://repo.example.org/api/v1/dataverses/research%2Fdata/contents',
      'https://repo.example.org/api/v1/search?q=science*&type=dataverse&sort=name&order=asc&per_page=25&start=50&subtree=root&query_entities=false',
      'https://repo.example.org/api/v1/dataverses/research%2Fdata/userPermissions',
    ])
    assert.ok(transport.calls.every(call => call.init.headers['x-dataverse-key'] === 'secret'))
  })
})

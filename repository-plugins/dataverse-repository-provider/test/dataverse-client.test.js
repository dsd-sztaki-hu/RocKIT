// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')

const { DataverseClient } = require('../src/dataverse-client')

function response(payload, status = 200, url = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
  }
}

describe('DataverseClient connection transport', () => {
  it('normalizes an API URL and validates the server and authenticated user', async () => {
    const calls = []
    const replies = [
      response({ status: 'OK', data: { id: 1, alias: 'root' } }),
      response({ status: 'OK', data: { id: 17, displayName: 'Alice' } }),
      response({
        status: 'OK',
        data: { message: 'Token secret expires on 2027-02-03 04:05:06 +0000' },
      }),
    ]
    const client = new DataverseClient({
      baseUrl: 'https://demo.dataverse.org/api/v1/',
      token: 'secret',
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        const reply = replies.shift()
        reply.url = url
        return reply
      },
    })

    const result = await client.validateConnection()

    assert.deepEqual(result, {
      userName: 'Alice',
      expirationDate: '2027-02-03T04:05:06.000Z',
    })
    assert.deepEqual(
      calls.map((call) => call.url),
      [
        'https://demo.dataverse.org/api/dataverses/root',
        'https://demo.dataverse.org/api/v1/users/:me',
        'https://demo.dataverse.org/api/v1/users/token',
      ],
    )
    assert.equal(calls[0].init.method, 'GET')
    assert.equal(calls[0].init.headers['x-dataverse-key'], 'secret')
  })

  it('rejects an expired or invalid API token', async () => {
    let call = 0
    const client = new DataverseClient({
      baseUrl: 'https://demo.dataverse.org',
      token: 'expired',
      fetchImpl: async (url) => {
        call += 1
        return call === 1
          ? response({ status: 'OK', data: { id: 1, alias: 'root' } }, 200, url)
          : response({ status: 'ERROR', message: 'Forbidden' }, 403, url)
      },
    })

    await assert.rejects(client.validateConnection(), /rejected the API token \(403\)/)
  })

  it('rejects a server that is not a compatible Dataverse deployment', async () => {
    const client = new DataverseClient({
      baseUrl: 'https://example.org',
      token: 'secret',
      fetchImpl: async (url) => response('<html>Not found</html>', 404, url),
    })

    await assert.rejects(
      client.validateConnection(),
      /does not expose a compatible Dataverse API/,
    )
  })

  it('requires an API token before sending requests', async () => {
    let called = false
    const client = new DataverseClient({
      baseUrl: 'https://demo.dataverse.org',
      fetchImpl: async () => {
        called = true
      },
    })

    await assert.rejects(client.validateConnection(), /API token is required/)
    assert.equal(called, false)
  })

  it('creates a dataset and uploads a file with Dataverse directory metadata', async () => {
    const calls = []
    const client = new DataverseClient({
      baseUrl: 'https://demo.dataverse.org',
      token: 'secret',
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return response({ status: 'OK' }, 200, url)
      },
    })
    const payload = { datasetVersion: { metadataBlocks: { citation: {} } } }

    await client.createDataset('collection/one', payload)
    await client.uploadFile(
      'doi:10.1/example',
      'data/result.txt',
      Uint8Array.from([1, 2]),
    )

    assert.equal(
      calls[0].url,
      'https://demo.dataverse.org/api/v1/dataverses/collection%2Fone/datasets',
    )
    assert.equal(calls[0].init.body, JSON.stringify(payload))
    assert.equal(calls[0].init.headers['content-type'], 'application/json')
    assert.equal(
      calls[1].url,
      'https://demo.dataverse.org/api/v1/datasets/:persistentId/add?persistentId=doi%3A10.1%2Fexample',
    )
    assert.ok(calls[1].init.body instanceof FormData)
    assert.equal(calls[1].init.headers['content-type'], undefined)
    assert.equal(calls[1].init.body.get('jsonData'), '{"directoryLabel":"data"}')
  })

  it('loads the metadata blocks enabled for a collection', async () => {
    const calls = []
    const client = new DataverseClient({
      baseUrl: 'https://demo.dataverse.org',
      token: 'secret',
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return response({ status: 'OK', data: [{ name: 'citation' }] }, 200, url)
      },
    })

    await client.getCollectionMetadataBlocks('collection/one')

    assert.equal(
      calls[0].url,
      'https://demo.dataverse.org/api/dataverses/collection%2Fone/metadatablocks',
    )
    assert.equal(calls[0].init.headers['x-dataverse-key'], 'secret')
  })

  it('deletes the latest draft using the native Dataverse API endpoint', async () => {
    const calls = []
    const client = new DataverseClient({
      baseUrl: 'https://demo.dataverse.org',
      token: 'secret',
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return response({ status: 'OK' }, 200, url)
      },
    })

    await client.deleteDraft('doi:10.1/example')

    assert.equal(
      calls[0].url,
      'https://demo.dataverse.org/api/datasets/:persistentId/versions/:draft?persistentId=doi%3A10.1%2Fexample',
    )
    assert.equal(calls[0].init.method, 'DELETE')
    assert.equal(calls[0].init.headers['x-dataverse-key'], 'secret')
  })

  it('uses the native Dataverse endpoints required for dataset updates', async () => {
    const calls = []
    const client = new DataverseClient({
      baseUrl: 'https://demo.dataverse.org',
      token: 'secret',
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return response({ status: 'OK', data: {} }, 200, url)
      },
    })

    await client.getDatasetVersion('doi:10.1/example')
    await client.downloadJsonFile('41')
    await client.replaceFile('42', 'data/result.txt', Uint8Array.from([1]))
    await client.deleteFile('43')
    await client.updateDraftMetadata('doi:10.1/example', { metadataBlocks: {} })
    await client.updateDatasetLicense(24, { name: 'CC0 1.0' })

    assert.deepEqual(
      calls.map((call) => [call.init.method, call.url]),
      [
        [
          'GET',
          'https://demo.dataverse.org/api/datasets/:persistentId/versions/:draft?persistentId=doi%3A10.1%2Fexample',
        ],
        ['GET', 'https://demo.dataverse.org/api/access/datafile/41'],
        ['POST', 'https://demo.dataverse.org/api/files/42/replace'],
        ['DELETE', 'https://demo.dataverse.org/api/files/43'],
        [
          'PUT',
          'https://demo.dataverse.org/api/datasets/:persistentId/versions/:draft?persistentId=doi%3A10.1%2Fexample',
        ],
        ['PUT', 'https://demo.dataverse.org/api/datasets/24/license'],
      ],
    )
    assert.ok(calls[2].init.body instanceof FormData)
    assert.equal(calls[4].init.body, JSON.stringify({ metadataBlocks: {} }))
    assert.equal(calls[5].init.body, JSON.stringify({ name: 'CC0 1.0' }))
  })

  it('downloads Dataverse file bytes for sync', async () => {
    const client = new DataverseClient({
      baseUrl: 'https://demo.dataverse.org',
      token: 'secret',
      fetchImpl: async (url, init) => ({
        ok: true,
        status: 200,
        url,
        arrayBuffer: async () => Uint8Array.from([4, 5]).buffer,
        init,
      }),
    })

    const result = await client.downloadFile('51')

    assert.deepEqual([...result.bytes], [4, 5])
    assert.equal(result.url, 'https://demo.dataverse.org/api/access/datafile/51')
  })

  it('downloads a Dataverse dataset ZIP for import', async () => {
    const calls = []
    const client = new DataverseClient({
      baseUrl: 'https://demo.dataverse.org',
      token: 'secret',
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return {
          ok: true, status: 200, url,
          arrayBuffer: async () => Uint8Array.from([80, 75, 3, 4]).buffer,
        }
      },
    })

    const result = await client.downloadDatasetZip('doi:10.1/example')

    assert.deepEqual([...result.bytes], [80, 75, 3, 4])
    assert.equal(calls[0].url,
      'https://demo.dataverse.org/api/access/dataset/:persistentId/?persistentId=doi%3A10.1%2Fexample')
    assert.equal(calls[0].init.headers.accept, 'application/zip')
    assert.equal(calls[0].init.headers['x-dataverse-key'], 'secret')
  })

  it('keeps collection browsing requests inside the provider transport', async () => {
    const calls = []
    const client = new DataverseClient({
      baseUrl: 'https://demo.dataverse.org',
      token: 'secret',
      fetchImpl: async (url, init) => {
        calls.push({ url, init })
        return response({ status: 'OK', data: [] }, 200, url)
      },
    })

    await client.getCollection('research/data')
    await client.getCollectionContents('research/data')
    await client.searchCollections({ query: 'science*', subtree: 'root', perPage: 25, start: 50, queryEntities: false })
    await client.getCollectionUserPermissions('research/data')

    assert.deepEqual(calls.map(call => call.url), [
      'https://demo.dataverse.org/api/v1/dataverses/research%2Fdata?returnChildCount=true',
      'https://demo.dataverse.org/api/v1/dataverses/research%2Fdata/contents',
      'https://demo.dataverse.org/api/v1/search?q=science*&type=dataverse&sort=name&order=asc&per_page=25&start=50&subtree=root&query_entities=false',
      'https://demo.dataverse.org/api/v1/dataverses/research%2Fdata/userPermissions',
    ])
    assert.ok(calls.every(call => call.init.headers['x-dataverse-key'] === 'secret'))
  })
})

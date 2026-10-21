// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

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
})

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { ArpClient } = require('../src/arp-client')

function mockTransport(body = '{}', status = 200) {
  const calls = []
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      return {
        ok: status >= 200 && status < 300,
        status,
        url,
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
})

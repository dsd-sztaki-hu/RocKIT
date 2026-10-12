// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { ZenodoApiError, ZenodoClient } = require('../src/zenodo-client')

const jsonResponse = (payload, options = {}) => ({
  ok: options.ok ?? true,
  status: options.status ?? 200,
  url: options.url ?? '',
  text: async () => JSON.stringify(payload),
})

describe('ZenodoClient', () => {
  it('creates a deposition with normalized URL and bearer authentication', async () => {
    const calls = []
    const client = new ZenodoClient({
      baseUrl: 'https://sandbox.zenodo.org/api/',
      token: 'secret-token',
      fetchImpl: async (...args) => {
        calls.push(args)
        return jsonResponse({ id: 123 })
      },
    })

    assert.deepEqual(await client.createDeposition(), { id: 123 })
    assert.equal(calls[0][0], 'https://sandbox.zenodo.org/api/deposit/depositions')
    assert.equal(calls[0][1].method, 'POST')
    assert.equal(calls[0][1].headers.authorization, 'Bearer secret-token')
    assert.equal(calls[0][1].body, '{}')
  })

  it('updates deposition metadata using a response-provided self link', async () => {
    const calls = []
    const client = new ZenodoClient({
      baseUrl: 'https://zenodo.org',
      token: 'token',
      fetchImpl: async (...args) => {
        calls.push(args)
        return jsonResponse({ updated: true })
      },
    })

    await client.updateDepositionMetadata(
      '42',
      { title: 'Dataset' },
      'https://zenodo.org/api/deposit/depositions/42',
    )

    assert.equal(calls[0][0], 'https://zenodo.org/api/deposit/depositions/42')
    assert.equal(calls[0][1].method, 'PUT')
    assert.equal(calls[0][1].body, JSON.stringify({ metadata: { title: 'Dataset' } }))
  })

  it('encodes uploaded filenames and preserves binary content', async () => {
    const calls = []
    const content = new Uint8Array([1, 2, 3])
    const client = new ZenodoClient({
      baseUrl: 'https://zenodo.org',
      token: 'token',
      fetchImpl: async (...args) => {
        calls.push(args)
        return jsonResponse({ id: 'remote-file' })
      },
    })

    await client.uploadFile(
      'https://zenodo.org/api/files/bucket/',
      'data set.csv',
      content,
    )

    assert.equal(calls[0][0], 'https://zenodo.org/api/files/bucket/data%20set.csv')
    assert.equal(calls[0][1].headers['content-type'], 'application/octet-stream')
    assert.equal(calls[0][1].body, content)
  })

  it('rejects invalid file-list responses', async () => {
    const client = new ZenodoClient({
      baseUrl: 'https://zenodo.org',
      token: 'token',
      fetchImpl: async () => jsonResponse({ files: [] }),
    })

    await assert.rejects(client.listDepositionFiles('42'), /invalid deposition file list/)
  })

  it('reports status, URL, and server message for HTTP failures', async () => {
    const client = new ZenodoClient({
      baseUrl: 'https://zenodo.org',
      token: 'token',
      fetchImpl: async () =>
        jsonResponse(
          { message: 'token expired' },
          {
            ok: false,
            status: 401,
            url: 'https://zenodo.org/api/deposit/depositions/42',
          },
        ),
    })

    await assert.rejects(client.getDeposition('42'), (error) => {
      assert.ok(error instanceof ZenodoApiError)
      assert.equal(error.status, 401)
      assert.match(error.message, /token expired/)
      return true
    })
  })
})

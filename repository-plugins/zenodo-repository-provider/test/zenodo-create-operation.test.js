// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { ZenodoCreateOperation } = require('../src/zenodo-create-operation')

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function validCrate() {
  return {
    '@context': 'https://w3id.org/ro/crate/1.1/context',
    '@graph': [
      {
        '@id': './',
        '@type': 'Dataset',
        name: 'Plugin export test',
        description: 'A crate exported by the Zenodo provider.',
        datePublished: '2026-10-12',
        author: { '@id': '#alice' },
        license: 'cc-by-4.0',
      },
      { '@id': '#alice', '@type': 'author', authorName: 'Alice Example' },
      { '@id': 'data/result.txt', '@type': 'File', name: 'Result' },
      { '@id': 'https://example.org/remote.txt', '@type': 'File' },
    ],
  }
}

function testEnvironment(crate = validCrate()) {
  const files = new Map([
    ['workspace/ro-crate-metadata.json', encoder.encode(JSON.stringify(crate))],
    ['workspace/data/result.txt', encoder.encode('result')],
  ])
  const written = new Map()
  const calls = []
  const vscode = {
    workspace: {
      workspaceFolders: [{ uri: 'workspace' }],
      fs: {
        async readFile(uri) {
          if (!files.has(uri)) {
            throw new Error('File not found')
          }
          return files.get(uri)
        },
        async createDirectory(uri) {
          calls.push(['createDirectory', uri])
        },
        async writeFile(uri, content) {
          written.set(uri, content)
        },
      },
    },
    Uri: {
      joinPath(base, ...parts) {
        return [base, ...parts].join('/')
      },
    },
  }
  const uploads = []
  const metadataUpdates = []
  const client = {
    async createDeposition() {
      calls.push(['createDeposition'])
      return {
        id: 42,
        links: {
          bucket: 'https://sandbox.zenodo.org/api/files/bucket-42',
          self: 'https://sandbox.zenodo.org/api/deposit/depositions/42',
          html: 'https://sandbox.zenodo.org/deposit/42',
        },
      }
    },
    async uploadFile(bucket, filename, content) {
      uploads.push({ bucket, filename, content })
      return { id: `remote-${filename}` }
    },
    async updateDepositionMetadata(id, metadata, selfUrl) {
      metadataUpdates.push({ id, metadata, selfUrl })
      return { id }
    },
  }
  const operation = new ZenodoCreateOperation({
    vscode,
    clientFactory: () => client,
    now: () => new Date('2026-10-12T10:00:00.000Z'),
  })
  return { operation, files, written, calls, uploads, metadataUpdates, vscode }
}

describe('Zenodo create operation', () => {
  it('creates a draft, uploads the crate files, and persists RocKIT export state', async () => {
    const env = testEnvironment()
    const progressMessages = []
    const result = await env.operation.execute(
      {
        repository: {
          id: 'sandbox',
          title: 'Zenodo Sandbox',
          baseUrl: 'https://sandbox.zenodo.org/',
          apiKey: 'secret',
          providerId: 'zenodo',
        },
      },
      { report: ({ message }) => progressMessages.push(message) },
    )

    assert.deepEqual(
      env.uploads.map(({ filename }) => filename),
      ['ro-crate-metadata.json', 'data__result.txt'],
    )
    assert.equal(decoder.decode(env.uploads[1].content), 'result')
    assert.equal(env.metadataUpdates.length, 1)
    assert.equal(env.metadataUpdates[0].id, '42')
    assert.equal(env.metadataUpdates[0].metadata.title, 'Plugin export test')
    assert.equal(env.metadataUpdates[0].metadata.creators[0].name, 'Alice Example')

    const mapping = JSON.parse(
      decoder.decode(env.written.get('workspace/.rockit/zenodo-42-mapping.json')),
    )
    assert.deepEqual(mapping, {
      'ro-crate-metadata.json': 'remote-ro-crate-metadata.json',
      'data/result.txt': 'remote-data__result.txt',
    })

    const log = JSON.parse(
      decoder.decode(env.written.get('workspace/.rockit/export-log.json')),
    )
    assert.equal(log[0].pid, '42')
    assert.equal(log[0].repository, 'https://sandbox.zenodo.org')
    assert.equal(log[0].syncType, 'create')
    assert.equal(log[0].remoteState, 'draft')
    assert.equal(log[0].lastSuccessfulActionAt, '2026-10-12T10:00:00.000Z')
    assert.deepEqual(result, {
      providerId: 'zenodo',
      remoteId: '42',
      state: 'draft',
      landingPage: 'https://sandbox.zenodo.org/deposit/42',
      mappingFile: 'zenodo-42-mapping.json',
      uploadedFileCount: 2,
    })
    assert.equal(progressMessages.at(-1), 'Zenodo export complete.')
  })

  it('validates metadata before creating a remote deposition', async () => {
    const crate = validCrate()
    delete crate['@graph'][0].author
    crate['@graph'] = crate['@graph'].filter((entity) => entity['@id'] !== '#alice')
    const env = testEnvironment(crate)

    await assert.rejects(
      env.operation.execute({
        repository: { baseUrl: 'https://sandbox.zenodo.org', apiKey: 'secret' },
      }),
      /required metadata fields are missing: creators/,
    )
    assert.equal(
      env.calls.some(([name]) => name === 'createDeposition'),
      false,
    )
  })

  it('rejects File entities outside the workspace before creating a draft', async () => {
    const crate = validCrate()
    crate['@graph'][2]['@id'] = '../secret.txt'
    const env = testEnvironment(crate)

    await assert.rejects(
      env.operation.execute({
        repository: { baseUrl: 'https://sandbox.zenodo.org', apiKey: 'secret' },
      }),
      /Only files inside the RO-Crate workspace/,
    )
    assert.equal(
      env.calls.some(([name]) => name === 'createDeposition'),
      false,
    )
  })
})

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')

const { ZenodoLinkOperation } = require('../src/zenodo-link-operation')

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function testEnvironment() {
  const crate = {
    '@context': 'https://w3id.org/ro/crate/1.1/context',
    '@graph': [
      { '@id': './', '@type': 'Dataset', name: 'Local dataset' },
      { '@id': 'data/result.txt', '@type': 'File', name: 'Result' },
      { '@id': 'file:///C:/source/photo.jpg', '@type': 'File', name: 'photo.jpg' },
    ],
  }
  const files = new Map([
    ['workspace/ro-crate-metadata.json', encoder.encode(JSON.stringify(crate))],
  ])
  const directories = new Set(['workspace', 'workspace/.rockit'])
  const written = new Map()
  const vscode = {
    workspace: {
      workspaceFolders: [{ uri: 'workspace' }],
      fs: {
        async readFile(uri) {
          if (written.has(uri)) return written.get(uri)
          if (files.has(uri)) return files.get(uri)
          throw new Error('File not found')
        },
        async writeFile(uri, content) {
          written.set(uri, content)
        },
        async createDirectory(uri) {
          directories.add(uri)
        },
        async stat(uri) {
          if (files.has(uri) || written.has(uri)) return { type: 1, mtime: 1000, size: 1 }
          if (directories.has(uri)) return { type: 2, mtime: 0, size: 0 }
          throw new Error('File not found')
        },
      },
    },
    Uri: {
      joinPath(base, ...parts) {
        return [base, ...parts].join('/')
      },
      parse(value) {
        return value
      },
      file(value) {
        return value
      },
    },
    FileType: { File: 1, Directory: 2 },
  }
  const calls = []
  const client = {
    async getDeposition(id) {
      calls.push(['getDeposition', id])
      return {
        id: 42,
        submitted: false,
        metadata: { title: 'Remote dataset' },
        links: { html: 'https://sandbox.zenodo.org/deposit/42' },
      }
    },
    async listDepositionFiles(id) {
      calls.push(['listDepositionFiles', id])
      return [
        { id: 'metadata-id', filename: 'ro-crate-metadata.json' },
        { id: 'result-id', filename: 'data__result.txt' },
        { id: 'photo-id', filename: 'photo.jpg' },
      ]
    },
  }
  const operation = new ZenodoLinkOperation({
    vscode,
    clientFactory: () => client,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
    randomId: () => 'link-mapping',
  })
  const input = {
    repository: {
      baseUrl: 'https://sandbox.zenodo.org',
      apiKey: 'secret',
      providerId: 'zenodo',
    },
    datasetUrl: 'https://sandbox.zenodo.org/deposit/42',
  }
  return { operation, input, calls, written }
}

describe('Zenodo link operation', () => {
  it('previews the local and remote dataset titles without writing link state', async () => {
    const env = testEnvironment()

    const result = await env.operation.execute({ ...env.input, mode: 'preview' })

    assert.equal(result.remoteId, '42')
    assert.equal(result.localDatasetTitle, 'Local dataset')
    assert.equal(result.remoteDatasetTitle, 'Remote dataset')
    assert.equal(result.titleMismatch, true)
    assert.equal(env.written.size, 0)
  })

  it('maps local files to Zenodo files and persists the export link', async () => {
    const env = testEnvironment()

    const result = await env.operation.execute({ ...env.input, mode: 'link' })

    const mapping = JSON.parse(
      decoder.decode(env.written.get('workspace/.rockit/link-mapping.json')),
    )
    assert.deepEqual(mapping, {
      'data/result.txt': 'result-id',
      'file:///C:/source/photo.jpg': 'photo-id',
      'ro-crate-metadata.json': 'metadata-id',
    })
    const log = JSON.parse(
      decoder.decode(env.written.get('workspace/.rockit/export-log.json')),
    )
    assert.equal(log[0].pid, '42')
    assert.equal(log[0].target, 'https://sandbox.zenodo.org/deposit/42')
    assert.equal(log[0].mappingFile, 'link-mapping.json')
    assert.equal(log[0].syncType, 'update')
    assert.equal(log[0].remoteState, 'draft')
    assert.equal(result.mappedEntityCount, 3)
    assert.deepEqual(result.unmappedEntityIds, [])
  })

  it('rejects a Zenodo URL belonging to a different repository deployment', async () => {
    const env = testEnvironment()

    await assert.rejects(
      env.operation.execute({
        ...env.input,
        datasetUrl: 'https://zenodo.org/deposit/42',
        mode: 'preview',
      }),
      /Could not extract a Zenodo deposition ID/,
    )
    assert.deepEqual(env.calls, [])
  })
})

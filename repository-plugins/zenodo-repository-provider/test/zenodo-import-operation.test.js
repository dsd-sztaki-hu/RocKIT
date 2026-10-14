// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { ZenodoImportOperation } = require('../src/zenodo-import-operation')

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function uploadedCrate() {
  return {
    '@context': 'https://w3id.org/ro/crate/1.1/context',
    '@graph': [
      {
        '@id': 'ro-crate-metadata.json',
        '@type': 'CreativeWork',
        about: { '@id': './' },
        conformsTo: { '@id': 'https://w3id.org/ro/crate/1.1' },
      },
      { '@id': './', '@type': 'Dataset', name: 'Original title' },
      { '@id': 'd_5_1/', '@type': 'Dataset', name: 'Imported directory' },
      { '@id': 'data/result.txt', '@type': 'File', name: 'Result' },
    ],
  }
}

function testEnvironment({ includeMetadata = true } = {}) {
  const existing = new Map([['imports', { type: 2, mtime: 0, size: 0 }]])
  const written = new Map()
  const commands = []
  const files = [
    ...(includeMetadata
      ? [
          {
            id: 'metadata-id',
            key: 'ro-crate-metadata.json',
            checksum: 'md5:metadata',
            links: { download: 'https://sandbox.zenodo.org/api/files/metadata' },
          },
        ]
      : []),
    {
      id: 'result-id',
      key: includeMetadata ? 'data__result.txt' : 'result.txt',
      size: 6,
      checksum: 'md5:0123456789abcdef0123456789abcdef',
      links: { download: 'https://sandbox.zenodo.org/api/files/result' },
    },
  ]
  const downloads = new Map([
    [
      'https://sandbox.zenodo.org/api/files/metadata',
      encoder.encode(JSON.stringify(uploadedCrate())),
    ],
    ['https://sandbox.zenodo.org/api/files/result', encoder.encode('result')],
  ])
  const vscode = {
    commands: {
      async executeCommand(...args) {
        commands.push(args)
      },
    },
    window: {
      async showInputBox() {
        return undefined
      },
      async showOpenDialog() {
        return undefined
      },
    },
    workspace: {
      fs: {
        async createDirectory(uri) {
          existing.set(uri, { type: 2, mtime: 0, size: 0 })
        },
        async stat(uri) {
          if (written.has(uri))
            return { type: 1, mtime: 1000, size: written.get(uri).byteLength }
          const stat = existing.get(uri)
          if (!stat) throw new Error('File not found')
          return stat
        },
        async readFile(uri) {
          if (!written.has(uri)) throw new Error('File not found')
          return written.get(uri)
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
      parse(value) {
        return value
      },
    },
    FileType: { File: 1, Directory: 2 },
  }
  const client = {
    async getDeposition(id) {
      assert.equal(id, '42')
      return {
        id: 42,
        submitted: false,
        links: { html: 'https://sandbox.zenodo.org/deposit/42' },
        metadata: {
          title: 'Imported title',
          description: 'Imported description',
          publication_date: '2026-10-14',
          upload_type: 'dataset',
          access_right: 'open',
          license: 'cc-by-4.0',
          keywords: ['reusable'],
          creators: [
            {
              name: 'Example, Alice',
              affiliation: 'SZTAKI',
              orcid: '0000-0000-0000-0001',
            },
          ],
        },
        files,
      }
    },
    async downloadFile(url) {
      const content = downloads.get(url)
      if (!content) throw new Error(`Unexpected download: ${url}`)
      return content
    },
  }
  const operation = new ZenodoImportOperation({
    vscode,
    clientFactory: () => client,
    now: () => new Date('2026-10-14T08:00:00.000Z'),
    randomId: () => 'mapping-id',
  })
  return { operation, written, commands }
}

describe('Zenodo import operation', () => {
  it('downloads an upload, restores crate paths, and persists linked-record state', async () => {
    const env = testEnvironment()
    const result = await env.operation.execute({
      repository: {
        title: 'Zenodo Sandbox',
        baseUrl: 'https://sandbox.zenodo.org',
        apiKey: 'secret',
        providerId: 'zenodo',
      },
      recordUrl: 'https://sandbox.zenodo.org/uploads/42',
      targetParentUri: 'imports',
    })

    assert.equal(
      decoder.decode(env.written.get('imports/zenodo-42/data/result.txt')),
      'result',
    )
    const crate = JSON.parse(
      decoder.decode(env.written.get('imports/zenodo-42/ro-crate-metadata.json')),
    )
    const root = crate['@graph'].find((entity) => entity['@id'] === './')
    assert.equal(root.name, 'Original title')
    assert.equal(root.title, 'Imported title')
    assert.ok(
      crate['@graph'].some(
        (entity) => entity.dsDescriptionValue === 'Imported description',
      ),
    )
    assert.ok(root.hasPart.some((reference) => reference['@id'] === 'data/result.txt'))

    const mapping = JSON.parse(
      decoder.decode(env.written.get('imports/zenodo-42/.rockit/mapping-id.json')),
    )
    assert.deepEqual(mapping, {
      'data/result.txt': 'data__result.txt',
      'ro-crate-metadata.json': 'ro-crate-metadata.json',
    })
    const log = JSON.parse(
      decoder.decode(env.written.get('imports/zenodo-42/.rockit/export-log.json')),
    )
    assert.equal(log[0].pid, '42')
    assert.equal(log[0].syncType, 'update')
    assert.equal(log[0].status, 'success')
    const hashes = JSON.parse(
      decoder.decode(env.written.get('imports/zenodo-42/.rockit/file-hashes.json')),
    )
    assert.equal(hashes.files['data/result.txt'].md5, '0123456789abcdef0123456789abcdef')
    assert.deepEqual(env.commands, [['vscode.openFolder', 'imports/zenodo-42', true]])
    assert.equal(result.openedWorkspace, true)
    assert.equal(result.downloadedFileCount, 2)
    assert.equal(result.hasUploadedRoCrateMetadata, true)
  })

  it('creates a valid crate when the upload has no RO-Crate metadata', async () => {
    const env = testEnvironment({ includeMetadata: false })
    await env.operation.execute({
      repository: { baseUrl: 'https://sandbox.zenodo.org', apiKey: 'secret' },
      recordUrl: 'https://sandbox.zenodo.org/uploads/42',
      targetParentUri: 'imports',
    })
    const crate = JSON.parse(
      decoder.decode(env.written.get('imports/zenodo-42/ro-crate-metadata.json')),
    )
    assert.ok(crate['@graph'].some((entity) => entity['@id'] === 'result.txt'))
    assert.ok(
      crate['@graph'].some((entity) => entity['@id'] === 'ro-crate-metadata.json'),
    )
  })

  it('returns a cancellation result before contacting Zenodo', async () => {
    const env = testEnvironment()
    assert.deepEqual(
      await env.operation.execute({
        repository: { baseUrl: 'https://sandbox.zenodo.org', apiKey: 'secret' },
      }),
      { cancelled: true },
    )
  })

  it('rejects upload URLs belonging to another Zenodo deployment', async () => {
    const env = testEnvironment()
    await assert.rejects(
      env.operation.execute({
        repository: { baseUrl: 'https://sandbox.zenodo.org', apiKey: 'secret' },
        recordUrl: 'https://zenodo.org/uploads/42',
        targetParentUri: 'imports',
      }),
      /Enter a Zenodo upload URL/,
    )
  })
})

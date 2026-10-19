// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const { createHash } = require('node:crypto')
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { ZenodoUpdateOperation } = require('../src/zenodo-update-operation')

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function crate() {
  return {
    '@context': 'https://w3id.org/ro/crate/1.1/context',
    '@graph': [
      {
        '@id': './',
        '@type': 'Dataset',
        name: 'Updated dataset',
        description: 'Updated description',
        datePublished: '2026-10-12',
        author: { '@id': '#alice' },
      },
      { '@id': '#alice', '@type': 'author', authorName: 'Alice Example' },
      { '@id': 'data/result.txt', '@type': 'File' },
      { '@id': 'data/new.txt', '@type': 'File' },
    ],
  }
}

function md5(value) {
  return createHash('md5').update(value).digest('hex')
}

function environment({ published = false } = {}) {
  const crateBytes = encoder.encode(JSON.stringify(crate()))
  const resultBytes = encoder.encode('unchanged result')
  const newBytes = encoder.encode('new result')
  const files = new Map([
    ['workspace/ro-crate-metadata.json', crateBytes],
    ['workspace/data/result.txt', resultBytes],
    ['workspace/data/new.txt', newBytes],
    [
      'workspace/.rockit/export-log.json',
      encoder.encode(
        JSON.stringify([
          {
            pid: '42',
            target: 'https://zenodo.org/deposit/42',
            repository: 'https://zenodo.org',
            mappingFile: 'zenodo-42-mapping.json',
            syncType: 'create',
            status: 'success',
            lastSuccessfulActionAt: '2026-10-11T10:00:00.000Z',
          },
        ]),
      ),
    ],
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
        async stat(uri) {
          if (!files.has(uri)) {
            throw new Error('File not found')
          }
          return { type: 1, mtime: 1000, size: files.get(uri).byteLength }
        },
        async writeFile(uri, content) {
          written.set(uri, content)
        },
      },
    },
    Uri: {
      joinPath: (base, ...parts) => [base, ...parts].join('/'),
      parse: (value) => value,
      file: (value) => value.replace(/\\/g, '/'),
    },
    FileType: { File: 1, Directory: 2 },
  }
  const metadataUpdates = []
  const client = {
    async getDeposition(id) {
      calls.push(['getDeposition', id])
      return {
        id: 42,
        submitted: published,
        state: published ? 'done' : 'unsubmitted',
        metadata: {
          access_right: 'restricted',
          access_conditions: 'Request access from the record owner.',
        },
        links: {
          bucket: 'https://zenodo.org/api/files/bucket-42',
          self: 'https://zenodo.org/api/deposit/depositions/42',
          html: 'https://zenodo.org/deposit/42',
        },
      }
    },
    async listDepositionFiles() {
      calls.push(['listDepositionFiles'])
      return [
        {
          id: 'remote-metadata',
          filename: 'ro-crate-metadata.json',
          checksum: 'md5:00000000000000000000000000000000',
          filesize: 1,
        },
        {
          id: 'remote-result',
          filename: 'data__result.txt',
          checksum: `md5:${md5(resultBytes)}`,
          filesize: resultBytes.byteLength,
        },
        {
          id: 'remote-obsolete',
          filename: 'obsolete.txt',
          checksum: 'md5:00000000000000000000000000000000',
          filesize: 1,
        },
      ]
    },
    async deleteFile(id, fileId) {
      calls.push(['deleteFile', id, fileId])
      return {}
    },
    async uploadFile(bucket, filename) {
      calls.push(['uploadFile', bucket, filename])
      return { id: `uploaded-${filename}` }
    },
    async updateDepositionMetadata(id, metadata, selfUrl) {
      metadataUpdates.push({ id, metadata, selfUrl })
      return { id }
    },
  }
  const operation = new ZenodoUpdateOperation({
    vscode,
    clientFactory: () => client,
    now: () => new Date('2026-10-12T14:00:00.000Z'),
  })
  const input = {
    repository: {
      id: 'zenodo',
      baseUrl: 'https://zenodo.org',
      apiKey: 'secret',
      providerId: 'zenodo',
    },
    exportTarget: {
      pid: '42',
      target: 'https://zenodo.org/deposit/42',
      mappingFile: 'zenodo-42-mapping.json',
    },
    crosswalkId: 'arp-zenodo-crosswalk',
    repositoryMetadata: {
      title: 'Updated dataset',
      description: 'Updated description',
      publication_date: '2026-10-12',
      upload_type: 'dataset',
      creators: [{ name: 'Alice Example' }],
    },
  }
  return { operation, input, calls, written, metadataUpdates }
}

describe('Zenodo update operation', () => {
  it('reconciles draft files, preserves access policy, and updates local state', async () => {
    const env = environment()
    const result = await env.operation.execute(env.input)

    assert.deepEqual(
      env.calls.filter(([name]) => name === 'deleteFile'),
      [
        ['deleteFile', '42', 'remote-obsolete'],
        ['deleteFile', '42', 'remote-metadata'],
      ],
    )
    assert.deepEqual(
      env.calls.filter(([name]) => name === 'uploadFile').map((call) => call[2]),
      ['ro-crate-metadata.json', 'data__new.txt'],
    )
    assert.equal(env.metadataUpdates[0].metadata.title, 'Updated dataset')
    assert.equal(env.metadataUpdates[0].metadata.access_right, 'restricted')
    assert.equal(
      env.metadataUpdates[0].metadata.access_conditions,
      'Request access from the record owner.',
    )

    const mapping = JSON.parse(
      decoder.decode(env.written.get('workspace/.rockit/zenodo-42-mapping.json')),
    )
    assert.deepEqual(mapping, {
      'data/result.txt': 'remote-result',
      'ro-crate-metadata.json': 'uploaded-ro-crate-metadata.json',
      'data/new.txt': 'uploaded-data__new.txt',
    })
    const log = JSON.parse(
      decoder.decode(env.written.get('workspace/.rockit/export-log.json')),
    )
    assert.equal(log.length, 2)
    assert.equal(log[1].syncType, 'update')
    assert.equal(log[1].lastSuccessfulActionAt, '2026-10-12T14:00:00.000Z')
    assert.deepEqual(result, {
      providerId: 'zenodo',
      remoteId: '42',
      state: 'draft',
      landingPage: 'https://zenodo.org/deposit/42',
      mappingFile: 'zenodo-42-mapping.json',
      addedFileCount: 1,
      replacedFileCount: 1,
      removedFileCount: 1,
      unchangedFileCount: 1,
    })
  })

  it('refuses to mutate a published record', async () => {
    const env = environment({ published: true })

    await assert.rejects(env.operation.execute(env.input), /Published Zenodo records/)
    assert.equal(
      env.calls.some(([name]) => name === 'deleteFile'),
      false,
    )
    assert.equal(
      env.calls.some(([name]) => name === 'uploadFile'),
      false,
    )
    assert.equal(env.metadataUpdates.length, 0)
  })

  it('rejects unsafe mapping filenames before contacting Zenodo', async () => {
    const env = environment()
    env.input.exportTarget.mappingFile = '../outside.json'

    await assert.rejects(env.operation.execute(env.input), /mapping filename is invalid/)
    assert.equal(
      env.calls.some(([name]) => name === 'getDeposition'),
      false,
    )
  })
})

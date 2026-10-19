// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const { createHash } = require('node:crypto')
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { ZenodoSyncOperation } = require('../src/zenodo-sync-operation')

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function md5(value) {
  return createHash('md5').update(value).digest('hex')
}

function environment(mode = 'complete', recordMetadata) {
  const localCrate = {
    '@context': 'https://w3id.org/ro/crate/1.1/context',
    '@graph': [
      { '@id': './', '@type': 'Dataset', name: 'Local title', hasPart: [{ '@id': 'data/result.txt' }] },
      { '@id': 'data/result.txt', '@type': 'File', name: 'result.txt' },
      { '@id': '#local-note', '@type': 'CreativeWork', name: 'Keep only as an addition' },
    ],
  }
  const remoteCrate = {
    '@context': 'https://w3id.org/ro/crate/1.1/context',
    '@graph': [
      {
        '@id': './',
        '@type': 'Dataset',
        name: 'Uploaded title',
        hasPart: [{ '@id': 'data/result.txt' }, { '@id': 'remote/new.txt' }],
      },
      { '@id': 'data/result.txt', '@type': 'File', name: 'result.txt' },
      { '@id': 'remote/new.txt', '@type': 'File', name: 'new.txt' },
    ],
  }
  const remoteResult = encoder.encode('remote result')
  const remoteNew = encoder.encode('new remote file')
  const files = new Map([
    ['workspace/ro-crate-metadata.json', encoder.encode(JSON.stringify(localCrate))],
    ['workspace/data/result.txt', encoder.encode('local result')],
    [
      'workspace/.rockit/zenodo-42-mapping.json',
      encoder.encode(JSON.stringify({ 'data/result.txt': 'remote-result', 'ro-crate-metadata.json': 'remote-metadata' })),
    ],
    ['workspace/.rockit/export-log.json', encoder.encode('[]')],
  ])
  const written = new Map()
  const directories = []
  const vscode = {
    workspace: {
      workspaceFolders: [{ uri: 'workspace' }],
      fs: {
        async readFile(uri) {
          if (written.has(uri)) return written.get(uri)
          if (!files.has(uri)) throw new Error('File not found')
          return files.get(uri)
        },
        async writeFile(uri, content) {
          written.set(uri, content)
        },
        async stat(uri) {
          if (!files.has(uri) && !written.has(uri) && !directories.includes(uri)) {
            throw new Error('File not found')
          }
          const content = written.get(uri) || files.get(uri)
          return {
            type: directories.includes(uri) ? 2 : 1,
            mtime: 1000,
            size: content?.byteLength,
          }
        },
        async createDirectory(uri) {
          directories.push(uri)
        },
      },
    },
    Uri: { joinPath: (base, ...parts) => [base, ...parts].join('/') },
    FileType: { File: 1, Directory: 2 },
  }
  const downloads = new Map([
    ['https://zenodo.org/files/metadata', encoder.encode(JSON.stringify(remoteCrate))],
    ['https://zenodo.org/files/result', remoteResult],
    ['https://zenodo.org/files/new', remoteNew],
  ])
  const client = {
    async getDeposition() {
      return {
        id: 42,
        submitted: false,
        metadata: {
          title: 'Repository title',
          description: 'Repository description',
          publication_date: '2026-10-13',
          creators: [{ name: 'Alice Example' }],
          upload_type: 'dataset',
        },
      }
    },
    async getRecord() {
      if (recordMetadata) return { metadata: recordMetadata }
      throw new Error('Records endpoint unavailable')
    },
    async listDepositionFiles() {
      return [
        {
          id: 'remote-metadata',
          filename: 'ro-crate-metadata.json',
          checksum: `md5:${md5(encoder.encode(JSON.stringify(remoteCrate)))}`,
          links: { download: 'https://zenodo.org/files/metadata' },
        },
        {
          id: 'remote-result',
          filename: 'data__result.txt',
          checksum: `md5:${md5(remoteResult)}`,
          size: remoteResult.byteLength,
          links: { download: 'https://zenodo.org/files/result' },
        },
        {
          id: 'remote-new',
          filename: 'remote__new.txt',
          checksum: `md5:${md5(remoteNew)}`,
          size: remoteNew.byteLength,
          links: { download: 'https://zenodo.org/files/new' },
        },
      ]
    },
    async downloadFile(url) {
      return downloads.get(url)
    },
  }
  const operation = new ZenodoSyncOperation({
    vscode,
    clientFactory: () => client,
    now: () => new Date('2026-10-13T08:00:00.000Z'),
  })
  const input = {
    repository: { id: 'zenodo', baseUrl: 'https://zenodo.org', apiKey: 'secret', providerId: 'zenodo' },
    exportTarget: {
      pid: '42',
      target: 'https://zenodo.org/deposit/42',
      mappingFile: 'zenodo-42-mapping.json',
    },
    syncMode: mode,
    crosswalkId: 'arp-zenodo-crosswalk',
  }
  return { input, operation, written, remoteResult, remoteNew, client, files }
}

describe('Zenodo sync operation', () => {
  it('downloads new and changed files and returns raw metadata for RocKIT', async () => {
    const env = environment()
    const result = await env.operation.execute(env.input)

    assert.deepEqual(env.written.get('workspace/data/result.txt'), env.remoteResult)
    assert.deepEqual(env.written.get('workspace/remote/new.txt'), env.remoteNew)
    assert.equal(env.written.has('workspace/ro-crate-metadata.json'), false)
    assert.equal(result.remoteCrate['@graph'][0].name, 'Uploaded title')
    assert.equal(result.localCrate['@graph'][0].name, 'Local title')
    assert.equal(result.repositoryMetadata.title, 'Repository title')
    const mapping = JSON.parse(decoder.decode(env.written.get('workspace/.rockit/zenodo-42-mapping.json')))
    assert.equal(mapping['remote/new.txt'], 'remote-new')
    assert.equal(result.downloadedFileCount, 1)
    assert.equal(result.replacedFileCount, 1)
    assert.equal(result.metadataSource, 'complete')
  })

  it('keeps local shared entities and existing file bytes in remote-additions mode', async () => {
    const env = environment('remote-additions')
    const result = await env.operation.execute(env.input)

    assert.equal(env.written.has('workspace/data/result.txt'), false)
    assert.deepEqual(env.written.get('workspace/remote/new.txt'), env.remoteNew)
    assert.equal(result.localCrate['@graph'][0].name, 'Local title')
    assert.equal(result.localCrate['@graph'].some((entity) => entity['@id'] === '#local-note'), true)
    assert.equal(result.keptLocalFileCount, 1)
  })

  it('returns both crates for RocKIT to merge in local-additions mode', async () => {
    const env = environment('local-additions')
    const result = await env.operation.execute(env.input)

    assert.equal(result.remoteCrate['@graph'][0].name, 'Uploaded title')
    assert.equal(result.localCrate['@graph'].some((entity) => entity['@id'] === '#local-note'), true)
    assert.deepEqual(env.written.get('workspace/data/result.txt'), env.remoteResult)
  })

  it('returns modern Zenodo subject metadata unchanged for RocKIT to map', async () => {
    const env = environment('remote-additions', {
      subjects: [{ subject: 'Cica' }],
    })
    const result = await env.operation.execute(env.input)

    assert.deepEqual(result.repositoryMetadata.keywords, ['Cica'])
    assert.equal(result.remoteCrate['@graph'][0].keyword, undefined)
  })

  it('normalizes modern creator details and singular additional descriptions', async () => {
    const env = environment('complete')
    const metadata = env.operation.mergeRecordMetadata({}, {
      additional_description: [{ description: 'Methods note' }],
      creators: [
        {
          person_or_org: {
            family_name: 'Example',
            given_name: 'Alice',
            identifiers: [{ scheme: 'orcid', identifier: '0000-0001-2345-6789' }],
          },
          affiliations: [{ name: 'SZTAKI' }],
        },
      ],
    })

    assert.deepEqual(metadata.additional_descriptions, [{ description: 'Methods note' }])
    assert.deepEqual(metadata.creators, [
      {
        name: 'Example, Alice',
        affiliation: 'SZTAKI',
        orcid: '0000-0001-2345-6789',
      },
    ])
  })

  it('records downloaded hashes and leaves the log pending for RocKIT to complete', async () => {
    const env = environment()
    await env.operation.execute(env.input)

    const hashes = JSON.parse(
      decoder.decode(env.written.get('workspace/.rockit/file-hashes.json')),
    )
    assert.equal(hashes.files['data/result.txt'].md5, md5(env.remoteResult))
    assert.equal(hashes.files['remote/new.txt'].md5, md5(env.remoteNew))
    const log = JSON.parse(
      decoder.decode(env.written.get('workspace/.rockit/export-log.json')),
    )
    assert.equal(log.length, 1)
    assert.equal(log[0].status, 'cancelled')
    assert.equal(log[0].syncType, 'sync')
  })

  it('keeps a file whose local snapshot and stored remote hash still match', async () => {
    const env = environment()
    env.files.set('workspace/data/result.txt', env.remoteResult)
    env.files.set(
      'workspace/.rockit/file-hashes.json',
      encoder.encode(
        JSON.stringify({
          files: {
            'data/result.txt': {
              md5: md5(env.remoteResult),
              hashUpdatedAt: '2026-10-13T07:00:00.000Z',
              sourceLastModifiedAt: new Date(1000).toISOString(),
              sourceSize: env.remoteResult.byteLength,
            },
          },
        }),
      ),
    )

    const result = await env.operation.execute(env.input)

    assert.equal(env.written.has('workspace/data/result.txt'), false)
    assert.equal(result.keptLocalFileCount, 1)
  })

  it('records a failed sync when a download fails after synchronization starts', async () => {
    const env = environment()
    env.client.downloadFile = async (url) => {
      if (url.endsWith('/new')) throw new Error('Download interrupted')
      if (url.endsWith('/metadata')) {
        const local = environment()
        return local.client.downloadFile(url)
      }
      return env.remoteResult
    }

    await assert.rejects(env.operation.execute(env.input), /Download interrupted/)
    const log = JSON.parse(
      decoder.decode(env.written.get('workspace/.rockit/export-log.json')),
    )
    assert.equal(log.length, 1)
    assert.equal(log[0].status, 'failed')
    assert.equal(log[0].errorMessage, 'Download interrupted')
  })

  it('rejects unsafe mapping filenames before contacting the repository', async () => {
    const env = environment()
    env.input.exportTarget.mappingFile = '../mapping.json'
    await assert.rejects(env.operation.execute(env.input), /mapping filename is invalid/)
  })
})

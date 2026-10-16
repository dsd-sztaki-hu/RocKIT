// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { ZenodoCreateOperation } = require('../src/zenodo-create-operation')
const crosswalk = require('../../../theia-extensions/data-repository-manager/src/browser/crosswalks/arp-zenodo-crosswalk.json')

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
    commands: {
      async executeCommand(command, prompt) {
        calls.push(['executeCommand', command])
        const defaults = Object.fromEntries(
          prompt.fields.map((field) => [field.id, field.defaultValue]),
        )
        return {
          access_right: defaults.access_right,
          license: defaults.license,
        }
      },
    },
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
      joinPath(base, ...parts) {
        return [base, ...parts].join('/')
      },
      parse(value) {
        return value
      },
      file(value) {
        return value.replace(/\\/g, '/')
      },
    },
    FileType: { File: 1, Directory: 2 },
  }
  const uploads = []
  const metadataUpdates = []
  const client = {
    async listLicenses() {
      calls.push(['listLicenses'])
      return { hits: { hits: [] } }
    },
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
        crosswalk: { id: crosswalk.id, document: crosswalk },
      },
      { report: ({ message }) => progressMessages.push(message) },
    )

    assert.deepEqual(
      env.uploads.map(({ filename }) => filename),
      ['data__result.txt', 'ro-crate-metadata.json'],
    )
    assert.equal(decoder.decode(env.uploads[0].content), 'result')
    assert.equal(env.metadataUpdates.length, 1)
    assert.equal(env.metadataUpdates[0].id, '42')
    assert.equal(env.metadataUpdates[0].metadata.title, 'Plugin export test')
    assert.equal(env.metadataUpdates[0].metadata.creators[0].name, 'Alice Example')

    const mapping = JSON.parse(
      decoder.decode(env.written.get('workspace/.rockit/zenodo-42-mapping.json')),
    )
    assert.deepEqual(mapping, {
      'data/result.txt': 'remote-data__result.txt',
      'ro-crate-metadata.json': 'remote-ro-crate-metadata.json',
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
        crosswalk: { id: crosswalk.id, document: crosswalk },
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
        crosswalk: { id: crosswalk.id, document: crosswalk },
      }),
      /Only files inside the RO-Crate workspace/,
    )
    assert.equal(
      env.calls.some(([name]) => name === 'createDeposition'),
      false,
    )
  })

  it('localizes external local files only in the uploaded crate', async () => {
    const crate = validCrate()
    crate['@graph'][2] = {
      '@id': 'file:///C:/outside/result.txt',
      '@type': 'File',
      name: 'result.txt',
    }
    const env = testEnvironment(crate)
    env.files.set('file:///C:/outside/result.txt', encoder.encode('external result'))

    await env.operation.execute({
      repository: { baseUrl: 'https://sandbox.zenodo.org', apiKey: 'secret' },
      crosswalk: { id: crosswalk.id, document: crosswalk },
    })

    assert.deepEqual(
      env.uploads.map(({ filename }) => filename),
      ['imported_resources__result.txt', 'ro-crate-metadata.json'],
    )
    const uploadedCrate = JSON.parse(decoder.decode(env.uploads[1].content))
    assert.equal(uploadedCrate['@graph'][2]['@id'], 'imported_resources/result.txt')
    assert.equal(crate['@graph'][2]['@id'], 'file:///C:/outside/result.txt')
    const mapping = JSON.parse(
      decoder.decode(env.written.get('workspace/.rockit/zenodo-42-mapping.json')),
    )
    assert.equal(
      mapping['file:///C:/outside/result.txt'],
      'remote-imported_resources__result.txt',
    )
  })
})

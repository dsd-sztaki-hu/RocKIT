// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { ArpLinkOperation } = require('../src/arp-link-operation')

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function testEnvironment() {
  const localCrate = {
    '@graph': [
      { '@id': './', '@type': 'Dataset', name: 'Local dataset' },
      { '@id': 'data/result.txt', '@type': 'File', name: 'result.txt', directoryLabel: 'data' },
      { '@id': '#collection', '@type': 'Dataset', name: 'Measurements' },
      { '@id': '#joe', '@type': 'Person', name: 'Joe Brown', affiliation: 'SZTAKI' },
    ],
  }
  const remoteCrate = {
    '@graph': [
      { '@id': './', '@type': 'Dataset', name: 'Remote dataset' },
      { '@id': 'https://w3id.org/arp/ro-id/example/file/51', '@type': 'File', name: 'result.txt', directoryLabel: 'data' },
      { '@id': 'https://w3id.org/arp/ro-id/example/dataset/7', '@type': 'Dataset', name: 'Measurements' },
      { '@id': 'https://w3id.org/arp/ro-id/example/person/9', '@type': 'Person', name: 'Joe Brown', affiliation: 'SZTAKI' },
    ],
  }
  const files = new Map([
    ['workspace/ro-crate-metadata.json', encoder.encode(JSON.stringify(localCrate))],
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
          if (files.has(uri) || written.has(uri)) return { type: 1 }
          if (directories.has(uri)) return { type: 2 }
          throw new Error('File not found')
        },
      },
    },
    Uri: {
      joinPath(base, ...parts) {
        return [base, ...parts].join('/')
      },
    },
  }
  const calls = []
  const operation = new ArpLinkOperation({
    vscode,
    clientFactory: repository => ({
      async getRoCrate(pid) {
        calls.push({ repository, pid })
        return {
          ok: true,
          status: 200,
          url: `${repository.baseUrl}/api/arp/rocrate/${pid}`,
          payload: { data: { roCrate: remoteCrate } },
        }
      },
    }),
    now: () => new Date('2026-10-21T12:00:00.000Z'),
    randomId: () => 'arp-link-mapping',
  })
  const input = {
    repository: {
      baseUrl: 'https://repo.researchdata.hu',
      apiKey: 'secret',
      providerId: 'arp',
      crosswalkId: 'arp-crosswalk',
    },
    datasetUrl: 'https://repo.researchdata.hu/dataset.xhtml?persistentId=hdl:21.15109/ARP.TEST',
  }
  return { operation, input, calls, written }
}

describe('ARP link operation', () => {
  it('previews local and remote titles without writing link state', async () => {
    const env = testEnvironment()

    const result = await env.operation.execute({ ...env.input, mode: 'preview' })

    assert.equal(result.remoteId, 'hdl:21.15109/ARP.TEST')
    assert.equal(result.localDatasetTitle, 'Local dataset')
    assert.equal(result.remoteDatasetTitle, 'Remote dataset')
    assert.equal(result.titleMismatch, true)
    assert.equal(env.written.size, 0)
  })

  it('maps files, nested datasets, and metadata entities and persists the link', async () => {
    const env = testEnvironment()

    const result = await env.operation.execute({ ...env.input, mode: 'link' })

    const mapping = JSON.parse(
      decoder.decode(env.written.get('workspace/.rockit/arp-link-mapping.json')),
    )
    assert.deepEqual(mapping, {
      '#collection': 'https://w3id.org/arp/ro-id/example/dataset/7',
      '#joe': 'https://w3id.org/arp/ro-id/example/person/9',
      'data/result.txt': 'https://w3id.org/arp/ro-id/example/file/51',
    })
    const log = JSON.parse(
      decoder.decode(env.written.get('workspace/.rockit/export-log.json')),
    )
    assert.equal(log[0].pid, 'hdl:21.15109/ARP.TEST')
    assert.equal(log[0].target, 'https://hdl.handle.net/21.15109/ARP.TEST')
    assert.equal(log[0].mappingFile, 'arp-link-mapping.json')
    assert.equal(log[0].crosswalkFile, 'arp-crosswalk')
    assert.equal(log[0].syncType, 'update')
    assert.equal(result.mappedEntityCount, 3)
    assert.deepEqual(result.unmappedEntityIds, [])
    assert.equal(env.calls.length, 1)
  })

  it('rejects an unsuccessful remote RO-Crate response', async () => {
    const env = testEnvironment()
    env.operation.clientFactory = () => ({
      async getRoCrate() {
        return { ok: false, status: 404, url: 'https://repo.example/api/arp/rocrate/missing', payload: {} }
      },
    })

    await assert.rejects(
      env.operation.execute({ ...env.input, mode: 'preview' }),
      /Failed to retrieve the ARP RO-Crate \(404\)/,
    )
    assert.equal(env.written.size, 0)
  })
})

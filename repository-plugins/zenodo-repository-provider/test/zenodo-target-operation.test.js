// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')

const { ZenodoTargetOperation } = require('../src/zenodo-target-operation')

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function testEnvironment() {
  const exportLog = [
    {
      pid: '42',
      target: 'https://zenodo.org/deposit/42',
      repository: 'https://zenodo.org',
      mappingFile: 'mapping-42.json',
      crosswalkFile: 'arp-zenodo-crosswalk.json',
      syncType: 'update',
      status: 'cancelled',
      datasetName: 'Stored dataset',
    },
    {
      target: 'https://other.example/deposit/99',
      repository: 'https://other.example',
      mappingFile: 'other.json',
      syncType: 'update',
      status: 'success',
      lastSuccessfulActionAt: '2026-10-14T10:00:00.000Z',
    },
  ]
  const files = new Map([
    ['workspace/.rockit/export-log.json', encoder.encode(JSON.stringify(exportLog))],
    [
      'workspace/ro-crate-metadata.json',
      encoder.encode(
        JSON.stringify({
          '@context': 'https://w3id.org/ro/crate/1.1/context',
          '@graph': [{ '@id': './', '@type': 'Dataset', name: 'Current dataset' }],
        }),
      ),
    ],
  ])
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
      },
    },
    Uri: {
      joinPath(base, ...parts) {
        return [base, ...parts].join('/')
      },
    },
  }
  const operation = new ZenodoTargetOperation({
    vscode,
    clientFactory: () => undefined,
  })
  const repository = {
    id: 'zenodo',
    title: 'Zenodo',
    baseUrl: 'https://zenodo.org/',
    providerId: 'zenodo',
  }
  return { operation, repository, written }
}

describe('Zenodo target operation', () => {
  it('lists only stored targets belonging to the configured Zenodo connection', async () => {
    const env = testEnvironment()

    const targets = await env.operation.list({ repository: env.repository })

    assert.equal(targets.length, 1)
    assert.equal(targets[0].pid, '42')
    assert.equal(targets[0].mappingFile, 'mapping-42.json')
    assert.equal(targets[0].status, 'cancelled')
    assert.equal(targets[0].datasetName, 'Stored dataset')
  })

  it('marks a declined interrupted export as failed', async () => {
    const env = testEnvironment()
    const [target] = await env.operation.list({ repository: env.repository })

    const result = await env.operation.markFailed({
      repository: env.repository,
      exportTarget: target,
      message: 'User chose not to continue the interrupted export.',
    })

    const log = JSON.parse(
      decoder.decode(env.written.get('workspace/.rockit/export-log.json')),
    )
    assert.equal(log[0].status, 'failed')
    assert.equal(
      log[0].errorMessage,
      'User chose not to continue the interrupted export.',
    )
    assert.deepEqual(result, {
      providerId: 'zenodo',
      remoteId: '42',
      status: 'failed',
    })
  })
})

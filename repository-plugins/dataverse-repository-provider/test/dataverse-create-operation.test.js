// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')

const { DataverseCreateOperation } = require('../src/dataverse-create-operation')

function fixture() {
  const files = new Map([['file:///workspace/data.txt', Uint8Array.from([1, 2, 3])]])
  const checkpoints = []
  const uploads = []
  const vscode = {
    workspace: { fs: { readFile: async (uri) => files.get(uri) } },
    Uri: { parse: (value) => value },
    commands: {
      executeCommand: async (command, value) => checkpoints.push({ command, value }),
    },
  }
  const client = {
    createDataset: async () => ({
      ok: true,
      status: 200,
      url: 'https://repo.example/api/v1/dataverses/root/datasets',
      payload: { status: 'OK', data: { id: 7, persistentId: 'doi:10.1/example' } },
    }),
    uploadFile: async (_pid, entryPath, content) => {
      uploads.push({ entryPath, content })
      const id = entryPath === 'ro-crate-metadata.json' ? 52 : 51
      return {
        ok: true,
        status: 200,
        url: 'https://repo.example/api/v1/datasets/:persistentId/add',
        payload: {
          status: 'OK',
          data: {
            files: [{ dataFile: { id, checksum: { type: 'MD5', value: 'abc123' } } }],
          },
        },
      }
    },
  }
  const input = {
    repository: { baseUrl: 'https://repo.example', apiKey: 'secret' },
    collectionId: 'root',
    operationId: 'create-1',
    datasetCreationPayload: { datasetVersion: { metadataBlocks: {} } },
    plan: {
      metadataCrate: {
        '@graph': [
          { '@id': './', '@type': 'Dataset', hasPart: [{ '@id': 'data.txt' }] },
          { '@id': 'data.txt', '@type': 'File', name: 'data.txt' },
        ],
      },
      originalToUploadIds: {},
      fileSources: [
        {
          localFileId: 'data.txt',
          entryPath: 'data.txt',
          sourceUri: 'file:///workspace/data.txt',
          lastModified: 100,
          sourceSize: 3,
        },
      ],
    },
  }
  return {
    operation: new DataverseCreateOperation({ vscode, clientFactory: () => client }),
    input,
    checkpoints,
    uploads,
  }
}

describe('Dataverse create operation', () => {
  it('creates a dataset, uploads files and rewritten metadata, and checkpoints progress', async () => {
    const f = fixture()

    const result = await f.operation.execute(f.input)

    assert.equal(result.providerId, 'dataverse')
    assert.equal(result.persistentId, 'doi:10.1/example')
    assert.equal(result.datasetId, 7)
    assert.equal(result.fileResults[0].remoteId, '51')
    assert.equal(result.metadataRemoteId, '52')
    assert.deepEqual(
      f.checkpoints.map((item) => item.value.stage),
      ['datasetCreated', 'fileUploaded', 'metadataUploaded'],
    )
    const uploadedCrate = JSON.parse(new TextDecoder().decode(f.uploads[1].content))
    assert.equal(uploadedCrate['@graph'][0].hasPart[0]['@id'], '51')
    assert.equal(uploadedCrate['@graph'][1]['@id'], '51')
  })

  it('returns recoverable partial state after the dataset has been created', async () => {
    const f = fixture()
    f.operation.clientFactory = () => ({
      createDataset: async () => ({
        ok: true,
        status: 200,
        payload: { status: 'OK', data: { persistentId: 'doi:10.1/example' } },
      }),
      uploadFile: async () => ({
        ok: false,
        status: 500,
        payload: { message: 'Failed' },
      }),
    })

    const result = await f.operation.execute(f.input)

    assert.equal(result.interrupted, true)
    assert.equal(result.persistentId, 'doi:10.1/example')
    assert.match(result.errorMessage, /Dataverse upload/)
  })
})

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { DataverseLinkOperation } = require('../src/dataverse-link-operation')

describe('Dataverse link operation', () => {
  it('returns the remote snapshot needed by RocKIT to create the local link', async () => {
    const calls = []
    const operation = new DataverseLinkOperation({
      vscode: {},
      clientFactory: repository => {
        assert.equal(repository.apiKey, 'secret')
        return {
          getDatasetVersion: async (persistentId, version) => {
            calls.push([persistentId, version])
            return { ok: true, status: 200, payload: { status: 'OK', data: {
              metadataBlocks: { citation: { fields: [
                { typeName: 'title', value: 'Linked dataset' },
              ] } },
              files: [{ directoryLabel: 'data', dataFile: {
                id: 42, filename: 'sample.csv',
              } }],
            } } }
          },
        }
      },
    })

    const result = await operation.execute({
      repository: { baseUrl: 'https://demo.dataverse.org/', apiKey: 'secret' },
      datasetUrl: 'https://demo.dataverse.org/dataset.xhtml?persistentId=doi:10.1/example',
    })

    assert.deepEqual(calls, [['doi:10.1/example', ':draft']])
    assert.deepEqual(result, {
      providerId: 'dataverse',
      persistentId: 'doi:10.1/example',
      target: 'https://demo.dataverse.org/dataset.xhtml?persistentId=doi:10.1/example',
      remoteDatasetTitle: 'Linked dataset',
      remoteFiles: [{ id: '42', path: 'data/sample.csv' }],
    })
  })

  it('falls back to the latest published version', async () => {
    const calls = []
    const operation = new DataverseLinkOperation({
      vscode: {},
      clientFactory: () => ({
        getDatasetVersion: async (_persistentId, version) => {
          calls.push(version)
          return version === ':draft'
            ? { ok: false, status: 404, payload: { status: 'ERROR' } }
            : { ok: true, status: 200, payload: { status: 'OK', data: { files: [] } } }
        },
      }),
    })

    await operation.execute({
      repository: { baseUrl: 'https://demo.dataverse.org' },
      datasetUrl: 'doi:10.1/example',
    })
    assert.deepEqual(calls, [':draft', ':latest'])
  })
})

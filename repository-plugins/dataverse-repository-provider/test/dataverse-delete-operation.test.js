// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')

const { DataverseDeleteOperation } = require('../src/dataverse-delete-operation')

describe('Dataverse delete operation', () => {
  it('deletes the draft identified by the selected export target', async () => {
    const deleted = []
    const operation = new DataverseDeleteOperation({
      clientFactory: (repository) => {
        assert.equal(repository.baseUrl, 'https://demo.dataverse.org')
        return {
          async deleteDraft(persistentId) {
            deleted.push(persistentId)
            return { ok: true, status: 200, payload: { status: 'OK' } }
          },
        }
      },
    })
    const progress = []

    const result = await operation.execute(
      {
        repository: { baseUrl: 'https://demo.dataverse.org', apiKey: 'secret' },
        exportTarget: { pid: 'doi:10.1/example' },
      },
      { report: (update) => progress.push(update.message) },
    )

    assert.deepEqual(deleted, ['doi:10.1/example'])
    assert.deepEqual(progress, ['Deleting Dataverse draft doi:10.1/example...'])
    assert.deepEqual(result, {
      providerId: 'dataverse',
      remoteId: 'doi:10.1/example',
      deleted: true,
    })
  })

  it('reports a rejected deletion without hiding the repository error', async () => {
    const operation = new DataverseDeleteOperation({
      clientFactory: () => ({
        async deleteDraft() {
          return {
            ok: false,
            status: 403,
            payload: { status: 'ERROR', message: 'Forbidden' },
          }
        },
      }),
    })

    await assert.rejects(
      operation.execute({
        repository: {},
        exportTarget: { pid: 'doi:10.1/example' },
      }),
      /rejected the deletion \(403\): Forbidden/,
    )
  })

  it('rejects a target without a persistent ID before creating a client', async () => {
    let clientCreated = false
    const operation = new DataverseDeleteOperation({
      clientFactory: () => {
        clientCreated = true
        return {}
      },
    })

    await assert.rejects(
      operation.execute({ repository: {}, exportTarget: {} }),
      /persistent ID is missing/,
    )
    assert.equal(clientCreated, false)
  })
})

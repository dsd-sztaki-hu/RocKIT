// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')

const { ZenodoDeleteOperation } = require('../src/zenodo-delete-operation')

describe('Zenodo delete operation', () => {
  it('deletes the deposition identified by the selected export target', async () => {
    const deleted = []
    const operation = new ZenodoDeleteOperation({
      clientFactory: (repository) => {
        assert.equal(repository.baseUrl, 'https://zenodo.org')
        return {
          async deleteDeposition(id) {
            deleted.push(id)
          },
        }
      },
    })
    const progress = []

    const result = await operation.execute(
      {
        repository: { baseUrl: 'https://zenodo.org', apiKey: 'secret' },
        exportTarget: { pid: '42' },
      },
      { report: (update) => progress.push(update.message) },
    )

    assert.deepEqual(deleted, ['42'])
    assert.deepEqual(progress, ['Deleting Zenodo deposition 42...'])
    assert.deepEqual(result, {
      providerId: 'zenodo',
      remoteId: '42',
      deleted: true,
    })
  })

  it('rejects a target without a deposition id before creating a client', async () => {
    let clientCreated = false
    const operation = new ZenodoDeleteOperation({
      clientFactory: () => {
        clientCreated = true
        return {}
      },
    })

    await assert.rejects(
      operation.execute({ repository: {}, exportTarget: {} }),
      /deposition id is missing/,
    )
    assert.equal(clientCreated, false)
  })
})

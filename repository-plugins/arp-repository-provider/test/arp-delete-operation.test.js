// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { ArpDeleteOperation } = require('../src/arp-delete-operation')

describe('ARP delete operation', () => {
  it('deletes the draft identified by the selected export target', async () => {
    const deleted = []
    const operation = new ArpDeleteOperation({
      clientFactory: repository => {
        assert.equal(repository.baseUrl, 'https://repo.example.org')
        return {
          async deleteDraft(pid) {
            deleted.push(pid)
            return { ok: true, status: 200, payload: { status: 'OK' } }
          },
        }
      },
    })
    const progress = []

    const result = await operation.execute({
      repository: { baseUrl: 'https://repo.example.org', apiKey: 'secret' },
      exportTarget: { pid: 'doi:10.1/example' },
    }, { report: update => progress.push(update.message) })

    assert.deepEqual(deleted, ['doi:10.1/example'])
    assert.deepEqual(progress, ['Deleting ARP draft doi:10.1/example...'])
    assert.deepEqual(result, {
      providerId: 'arp',
      remoteId: 'doi:10.1/example',
      deleted: true,
    })
  })

  it('reports the repository error without unlinking locally', async () => {
    const operation = new ArpDeleteOperation({
      clientFactory: () => ({
        async deleteDraft() {
          return { ok: false, status: 403, payload: { status: 'ERROR', message: 'Forbidden' } }
        },
      }),
    })

    await assert.rejects(
      operation.execute({ repository: {}, exportTarget: { pid: 'doi:10.1/example' } }),
      /rejected the deletion \(403\): Forbidden/,
    )
  })

  it('rejects a target without a PID before creating a client', async () => {
    let clientCreated = false
    const operation = new ArpDeleteOperation({
      clientFactory: () => {
        clientCreated = true
        return {}
      },
    })

    await assert.rejects(
      operation.execute({ repository: {}, exportTarget: {} }),
      /dataset PID is missing/,
    )
    assert.equal(clientCreated, false)
  })
})

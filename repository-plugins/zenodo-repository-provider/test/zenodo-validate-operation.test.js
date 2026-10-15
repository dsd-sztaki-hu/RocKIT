// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { ZenodoValidateOperation } = require('../src/zenodo-validate-operation')

describe('Zenodo validate operation', () => {
  it('validates the configured URL and token through the authenticated API', async () => {
    const calls = []
    const operation = new ZenodoValidateOperation({
      clientFactory: (repository) => {
        calls.push(['client', repository])
        return {
          async listDepositions(size) {
            calls.push(['listDepositions', size])
            return []
          },
        }
      },
    })
    const progress = []
    const repository = {
      baseUrl: 'https://zenodo.org',
      apiKey: 'secret',
      providerId: 'zenodo',
    }

    const result = await operation.execute(
      { repository },
      { report: (update) => progress.push(update.message) },
    )

    assert.deepEqual(calls, [
      ['client', repository],
      ['listDepositions', 1],
    ])
    assert.deepEqual(result, {
      providerId: 'zenodo',
      valid: true,
      userName: 'Zenodo',
    })
    assert.deepEqual(progress, ['Validating the Zenodo connection and API token...'])
  })

  it('rejects a missing repository configuration before creating a client', async () => {
    let clientCreated = false
    const operation = new ZenodoValidateOperation({
      clientFactory: () => {
        clientCreated = true
        return {}
      },
    })

    await assert.rejects(operation.execute({}), /configuration is missing/)
    assert.equal(clientCreated, false)
  })
})

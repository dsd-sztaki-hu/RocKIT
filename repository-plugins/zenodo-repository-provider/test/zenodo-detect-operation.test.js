// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { ZenodoDetectOperation } = require('../src/zenodo-detect-operation')

describe('ZenodoDetectOperation', () => {
  it.each([200, 401, 403])(
    'recognizes the Zenodo deposit endpoint when it returns %i',
    async status => {
      let requestedUrl
      let requestedInit
      const operation = new ZenodoDetectOperation({
        fetchImpl: async (url, init) => {
          requestedUrl = url
          requestedInit = init
          return {
            status,
          }
        },
      })

      assert.deepEqual(await operation.execute({ baseUrl: 'https://zenodo.org/' }), {
        supported: true,
      })
      assert.equal(requestedUrl, 'https://zenodo.org/api/deposit/depositions')
      assert.equal(requestedInit.method, 'GET')
    },
  )

  it('does not recognize a missing endpoint or an unreachable service', async () => {
    const unrelated = new ZenodoDetectOperation({
      fetchImpl: async () => ({ status: 404 }),
    })
    const unreachable = new ZenodoDetectOperation({
      fetchImpl: async () => { throw new Error('offline') },
    })

    assert.deepEqual(await unrelated.execute({ baseUrl: 'https://example.org' }), {
      supported: false,
    })
    assert.deepEqual(await unreachable.execute({ baseUrl: 'https://example.org' }), {
      supported: false,
    })
  })
})

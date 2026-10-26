// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { DataverseDestinationOperation } = require('../src/dataverse-destination-operation')

describe('Dataverse destination operation', () => {
  it('lists children, searches destinations, and checks create permission', async () => {
    const calls = []
    const repository = { baseUrl: 'https://example.org', apiKey: 'secret' }
    const client = {
      getCollectionContents: async id => {
        calls.push(`contents:${id}`)
        return {
          ok: true,
          status: 200,
          payload: {
            status: 'OK',
            data: [{ type: 'dataverse', alias: 'science', name: 'Science' }],
          },
        }
      },
      getCollection: async id => {
        calls.push(`details:${id}`)
        return {
          ok: true,
          status: 200,
          payload: { status: 'OK', data: { alias: id, name: 'Science', childCount: 2 } },
        }
      },
      searchCollections: async input => {
        calls.push(`search:${input.query}:${input.subtree || ''}`)
        return {
          ok: true,
          status: 200,
          payload: {
            status: 'OK',
            data: {
              total_count: 1,
              items: input.subtree
                ? [{ type: 'dataverse', identifier: 'child', name: 'Child' }]
                : [{ type: 'dataverse', identifier: 'biology', name: 'Biology' }],
            },
          },
        }
      },
      getCollectionUserPermissions: async id => {
        calls.push(`permissions:${id}`)
        return {
          ok: true,
          status: 200,
          payload: { status: 'OK', data: { permissions: ['AddDataset'] } },
        }
      },
    }
    const operation = new DataverseDestinationOperation({
      clientFactory: received => {
        assert.equal(received, repository)
        return client
      },
    })

    assert.deepEqual(await operation.list({ repository }), {
      destinations: [{
        id: 'science',
        label: 'Science',
        parentId: 'root',
        hasChildren: true,
      }],
    })
    assert.deepEqual(await operation.search({ repository, query: 'bio' }), {
      destinations: [{
        id: 'biology',
        label: 'Biology',
        hasChildren: false,
      }],
    })
    assert.deepEqual(await operation.check({
      repository,
      destinationId: 'science',
    }), { selectable: true })
    assert.deepEqual(calls, [
      'contents:root',
      'details:science',
      'search:*:science',
      'search:bio*:',
      'permissions:science',
    ])
  })

  it('does not allow a destination without AddDataset permission', async () => {
    const operation = new DataverseDestinationOperation({
      clientFactory: () => ({
        getCollectionUserPermissions: async () => ({
          ok: true,
          status: 200,
          payload: { status: 'OK', data: ['ViewUnpublishedDataset'] },
        }),
      }),
    })
    assert.deepEqual(await operation.check({
      repository: {},
      destinationId: 'readonly',
    }), { selectable: false })
  })
})


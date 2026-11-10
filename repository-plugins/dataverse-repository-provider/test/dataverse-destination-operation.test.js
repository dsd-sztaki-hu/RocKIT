// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { DataverseDestinationOperation } = require('../src/dataverse-destination-operation')
const ok = data => ({ ok: true, status: 200, payload: { status: 'OK', data } })

function setup() {
  const client = {
    searchCollections: jest.fn(async ({ query, perPage }) => perPage === 1
      ? ok({ total_count: query === 'dvParentAlias:"sztaki"' ? 1 : 0, items: [] })
      : ok({
      total_count: 1,
      items: query === 'parentDataverseIdentifier:"root"'
        ? [{ type: 'dataverse', identifier: 'sztaki', name: 'SZTAKI', parentDataverseIdentifier: 'root' }]
        : query === 'parentDataverseIdentifier:"sztaki"'
          ? [{ type: 'dataverse', identifier: 'aroma', name: 'AROMA 2.0 test', parentDataverseIdentifier: 'sztaki' }]
          : [{ type: 'dataverse', identifier: 'sztaki', name: 'SZTAKI' }],
    })),
    getCollection: jest.fn(async id => ok({
      alias: id === ':root' ? 'root' : id,
      childCount: id === 'aroma' ? 0 : 2,
    })),
    getCollectionContents: jest.fn(() => { throw new Error('Must not prefetch contents') }),
    getCollectionUserPermissions: jest.fn(async () => ok({ permissions: ['AddDataset'] })),
  }
  return { client, operation: new DataverseDestinationOperation({ clientFactory: () => client }) }
}

describe('Dataverse destination operation', () => {
  it('loads one hierarchy level at a time and never prefetches descendant records', async () => {
    const { operation, client } = setup()
    assert.deepEqual(await operation.list({ repository: {} }), {
      destinations: [{ id: 'sztaki', label: 'SZTAKI', parentId: 'root', hasChildren: true }],
    })
    expect(client.searchCollections.mock.calls).toEqual([
      [{ query: 'parentDataverseIdentifier:"root"', perPage: 1000, start: 0 }],
      [{ query: 'dvParentAlias:"sztaki"', perPage: 1, start: 0, queryEntities: false }],
    ])
    expect(client.getCollection).toHaveBeenCalledWith(':root')
    assert.deepEqual(await operation.list({ repository: {}, parentId: 'sztaki' }), {
      destinations: [{ id: 'aroma', label: 'AROMA 2.0 test', parentId: 'sztaki', hasChildren: false }],
    })
    expect(client.searchCollections).toHaveBeenCalledWith({
      query: 'parentDataverseIdentifier:"sztaki"', perPage: 1000, start: 0,
    })
    expect(client.searchCollections).toHaveBeenLastCalledWith({
      query: 'dvParentAlias:"aroma"', perPage: 1, start: 0, queryEntities: false,
    })
    expect(client.getCollectionContents).not.toHaveBeenCalled()
  })

  it('resolves the real site-root alias before listing its children', async () => {
    const { operation, client } = setup()
    client.getCollection.mockResolvedValueOnce(ok({ alias: 'demo', name: 'Demo Dataverse' }))
    client.searchCollections.mockImplementation(async ({ query, perPage }) => perPage === 1
      ? ok({ total_count: 0, items: [] })
      : ok({ items: [{
          type: 'dataverse', identifier: 'child', name: 'Child',
          parentDataverseIdentifier: 'demo',
        }] }))

    expect(await operation.list({ repository: {} })).toEqual({
      destinations: [{ id: 'child', label: 'Child', parentId: 'demo', hasChildren: false }],
    })
    expect(client.getCollection).toHaveBeenCalledWith(':root')
    expect(client.searchCollections).toHaveBeenCalledWith({
      query: 'parentDataverseIdentifier:"demo"', perPage: 1000, start: 0,
    })
  })

  it('restricts filtering to collection names and keeps matched parents expandable', async () => {
    const { operation, client } = setup()
    const result = await operation.search({ repository: {}, query: ' SZTAKI inst ' })
    expect(client.searchCollections).toHaveBeenCalledWith({
      query: 'dvName:(SZTAKI* AND inst*)', perPage: 1000, start: 0,
    })
    expect(result.destinations[0].hasChildren).toBe(true)
    expect(client.getCollectionContents).not.toHaveBeenCalled()
    expect(operation.partialQuery('name:foo (bar)')).toBe('dvName:(name\\:foo* AND \\(bar\\)*)')
  })

  it('does not show arrows for dataset-only collections even if childCount is positive', async () => {
    const { operation, client } = setup()
    client.getCollection.mockResolvedValue(ok({ alias: 'aroma', childCount: 8 }))
    const result = await operation.list({ repository: {}, parentId: 'sztaki' })
    expect(result.destinations[0].hasChildren).toBe(false)
    expect(client.getCollection).not.toHaveBeenCalled()
    expect(client.getCollectionContents).not.toHaveBeenCalled()
  })

  it('checks filtered results for Dataverse children using the same direct-parent query', async () => {
    const { operation, client } = setup()
    client.searchCollections.mockImplementation(async ({ perPage }) => perPage === 1
      ? ok({ total_count: 0, items: [] })
      : ok({ items: [{ type: 'dataverse', identifier: 'aroma', name: 'AROMA 2.0 test' }] }))
    const result = await operation.search({ repository: {}, query: 'aroma' })
    expect(result.destinations[0].hasChildren).toBe(false)
    expect(client.searchCollections).toHaveBeenLastCalledWith({
      query: 'dvParentAlias:"aroma"', perPage: 1, start: 0, queryEntities: false,
    })
  })

  it('reports a failed child check instead of guessing that a collection is expandable', async () => {
    const { operation, client } = setup()
    client.searchCollections.mockImplementation(async ({ perPage }) => perPage === 1
      ? { ok: false, status: 503, payload: { status: 'ERROR' } }
      : ok({ items: [{ type: 'dataverse', identifier: 'sztaki', name: 'SZTAKI', parentDataverseIdentifier: 'root' }] }))
    await expect(operation.list({ repository: {} })).rejects.toThrow('check child collections')
  })

  it('caps results at 1,000 and does not automatically page through the repository', async () => {
    const { operation, client } = setup()
    client.searchCollections.mockResolvedValue(ok({ total_count: 5000, items:
      Array.from({ length: 1001 }, (_, id) => ({
        type: 'dataverse', identifier: String(id), parentDataverseIdentifier: 'root',
      })),
    }))
    const result = await operation.list({ repository: {} })
    expect(result.destinations).toHaveLength(1000)
    expect(client.searchCollections.mock.calls.filter(([input]) => input.perPage === 1000)).toHaveLength(1)
    expect(client.searchCollections.mock.calls.filter(([input]) => input.perPage === 1)).toHaveLength(1000)
  })

  it('keeps an empty root selectable without flattening the entire repository', async () => {
    const { operation, client } = setup()
    client.searchCollections.mockResolvedValue(ok({ total_count: 0, items: [] }))
    client.getCollection.mockResolvedValue(ok({ alias: 'root', name: 'ARP' }))
    expect(await operation.list({ repository: {} })).toEqual({
      destinations: [{ id: 'root', label: 'ARP', hasChildren: false }],
    })
    expect(await operation.list({ repository: {}, parentId: 'leaf' })).toEqual({ destinations: [] })
    expect(await operation.search({ repository: {}, query: ' ' })).toEqual({ destinations: [] })
  })

  it('checks permission independently of browsing and searching', async () => {
    const { operation, client } = setup()
    expect(await operation.check({ repository: {}, destinationId: 'sztaki' })).toEqual({ selectable: true })
    client.getCollectionUserPermissions.mockResolvedValue(ok(['ViewUnpublishedDataset']))
    expect(await operation.check({ repository: {}, destinationId: 'sztaki' })).toEqual({ selectable: false })
  })
})

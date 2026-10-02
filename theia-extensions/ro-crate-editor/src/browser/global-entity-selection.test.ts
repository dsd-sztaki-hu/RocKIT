/** @jest-environment node */

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************
import { GlobalEntityLibraryService } from 'global-entity-library/lib/browser/global-entity-library-service'
import type { GlobalEntityCollection, GlobalEntityMapping } from 'global-entity-library/lib/browser/global-entity-library-types'

jest.mock('@theia/core/lib/common', () => ({
  Emitter: class { event = jest.fn(); fire = jest.fn() },
}))
jest.mock('@theia/core/shared/inversify', () => ({
  inject: () => () => {},
  injectable: () => (target: unknown) => target,
}))
jest.mock('@theia/workspace/lib/browser', () => ({ WorkspaceService: class {} }))
jest.mock('app-state/lib/browser/state/app-state-service', () => ({ AppStateService: class {} }))
jest.mock('global-entity-library/lib/browser/global-entity-library-store', () => ({
  isSupportedGlobalEntityType: (type: string) => ['author', 'datasetContact'].includes(type),
  getPrimaryEntityType: (entity: Record<string, string[]>) => entity['@type'][0],
  sanitizeGlobalEntity: (entity: unknown) => entity,
  GlobalEntityLibraryStore: class {},
}))
jest.mock('global-entity-library/lib/browser/global-entity-mapping-store', () => ({ GlobalEntityMappingStore: class {} }))

class SelectionService extends GlobalEntityLibraryService {
  readonly savedMappings: GlobalEntityMapping[] = []
  constructor(collection: GlobalEntityCollection, graph: Record<string, unknown>[] = [], mapping: GlobalEntityMapping = {}) {
    super()
    this.collection = structuredClone(collection)
    this.mapping = structuredClone(mapping)
    this.initialized = true
    this.mappingRootKey = 'workspace'
    Object.assign(this, {
      appStateService: { roCrate: { '@graph': graph } },
      mappingStore: {
        getRootKey: () => 'workspace',
        save: async (value: GlobalEntityMapping) => { this.savedMappings.push(structuredClone(value)) },
      },
      store: { save: async (value: GlobalEntityCollection) => value },
    })
    this.rebuildRecordIndexes()
    this.rebuildMappingIndex()
  }
}

const collection: GlobalEntityCollection = {
  author: [{ recordId: 'ada', entity: { '@type': ['author'], name: 'Ada' } }],
  datasetContact: [{ recordId: 'contact', entity: { '@type': ['datasetContact'], name: 'Contact' } }],
}

describe('global entity selection in a crate', () => {
  it('lists the requested type before typing and searches without modifying the library', async () => {
    const service = new SelectionService(collection)
    expect((await service.findEntitiesForCrate({ type: 'author' })).documents).toEqual([
      { '@id': '#global-ada', '@type': ['author'], name: 'Ada', globalRecordId: 'ada' },
    ])
    expect((await service.findEntitiesForCrate({ type: 'author', queryString: 'ADA' })).documents).toHaveLength(1)
    expect((await service.findEntitiesForCrate({ type: 'author', queryString: 'Contact' })).documents).toHaveLength(0)
    expect((await service.findEntitiesForCrate({ type: 'ANY' })).documents).toHaveLength(2)
    expect(collection.author[0].entity).not.toHaveProperty('@id')
  })

  it('uses a mapped entity only when it exists in the current crate', async () => {
    const graph = [{ '@id': '#local', '@type': 'author', name: 'Ada' }]
    const service = new SelectionService(collection, graph)
    await service.mapAddedEntity({ recordId: 'ada', entityId: '#local' })
    expect((await service.findEntitiesForCrate({ type: 'author' })).documents[0]['@id']).toBe('#local')
  })

  it('avoids an ID collision with an unrelated entity', async () => {
    const service = new SelectionService(collection, [{ '@id': '#global-ada', '@type': 'Thing', name: 'Other' }])
    expect((await service.findEntitiesForCrate({ type: 'author' })).documents[0]['@id']).not.toBe('#global-ada')
  })

  it('persists the chosen record mapping and keeps it during reconciliation', async () => {
    const source = { '@id': '#global-ada', '@type': 'author', name: 'Ada' }
    const service = new SelectionService(collection, [source])
    await service.mapAddedEntity({ recordId: 'ada', entityId: '#global-ada' })
    expect(service.savedMappings[0].author.ada.entityIds).toEqual(['#global-ada'])
    expect(service.savedMappings[0].author.ada.lastSyncedHash).toMatch(/^[a-f0-9]{16}$/)
    expect((await service.getCollection()).author).toHaveLength(1)
    expect((await service.findEntitiesForCrate({ type: 'author' })).documents[0]['@id']).toBe('#global-ada')
  })

  it('does not map a missing crate entity', async () => {
    const service = new SelectionService(collection)
    await service.mapAddedEntity({ recordId: 'ada', entityId: '#absent' })
    expect(service.savedMappings).toHaveLength(0)
  })

  it('keeps the selected record identity when two library records have identical data', async () => {
    const duplicated = {
      author: [collection.author[0], { ...collection.author[0], recordId: 'second-ada' }],
    }
    const service = new SelectionService(duplicated, [{ '@id': '#chosen', '@type': 'author', name: 'Ada' }])
    await service.mapAddedEntity({ recordId: 'second-ada', entityId: '#chosen' })
    expect((await service.getCollection()).author).toHaveLength(2)
    expect(service.savedMappings[0].author['second-ada'].entityIds).toEqual(['#chosen'])
    expect(service.savedMappings[0].author.ada).toBeUndefined()
  })
})

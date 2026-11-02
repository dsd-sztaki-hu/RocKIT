// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

jest.mock('@theia/workspace/lib/browser', () => ({ WorkspaceService: class WorkspaceService {} }))
jest.mock('app-state/lib/browser/state/app-state-service', () => ({
    AppStateService: class AppStateService {},
}))
jest.mock('./global-entity-library-store', () => ({
    GlobalEntityLibraryStore: class GlobalEntityLibraryStore {},
    getPrimaryEntityType: (entity: Record<string, unknown>) => {
        const type = Array.isArray(entity['@type']) ? entity['@type'][0] : entity['@type']
        return typeof type === 'string' ? type : 'Thing'
    },
    isSupportedGlobalEntityType: (type: string) => type === 'author' || type === 'datasetContact',
    sanitizeGlobalEntity: (entity: Record<string, unknown>) => {
        const { '@id': _id, '@reverse': _reverse, recordId: _recordId, relationships: _relationships, ...safe } = entity
        return safe
    },
}))
jest.mock('./global-entity-mapping-store', () => ({
    GlobalEntityMappingStore: class GlobalEntityMappingStore {},
}))

import { GlobalEntityLibraryService } from './global-entity-library-service'

type TestService = Pick<GlobalEntityLibraryService, 'getCollection' | 'saveRecord'> & {
    store: { load: jest.Mock; save: jest.Mock }
    mappingStore: { load: jest.Mock; save: jest.Mock; getRootKey: jest.Mock }
    appStateService: { roCrate?: Record<string, unknown> }
    scheduleReconcile: jest.Mock
}

const createService = (collection: Record<string, unknown[]> = {}): TestService => {
    const service = new GlobalEntityLibraryService() as unknown as TestService
    service.store = {
        load: jest.fn().mockResolvedValue(collection),
        save: jest.fn().mockImplementation(async (value: unknown) => value),
    }
    service.mappingStore = {
        load: jest.fn().mockResolvedValue({}),
        save: jest.fn().mockResolvedValue(undefined),
        getRootKey: jest.fn().mockReturnValue('workspace'),
    }
    service.appStateService = {}
    service.scheduleReconcile = jest.fn()
    return service
}

describe('GlobalEntityLibraryService', () => {
    it('replaces a duplicate record identifier and removes transient entity fields', async () => {
        const service = createService({
            author: [{ recordId: 'record-1', entity: { '@type': ['author'], name: 'Old' } }],
        })

        await service.saveRecord({
            recordId: 'record-1',
            entity: {
                '@id': '#temporary',
                '@type': 'datasetContact',
                '@reverse': { contact: [] },
                name: 'New',
            },
        })

        expect(service.store.save).toHaveBeenCalledWith({
            datasetContact: [{
                recordId: 'record-1',
                entity: { '@type': ['datasetContact'], name: 'New' },
                relationships: {},
            }],
        })
    })

    it('recovers its operation queue after a collection write failure', async () => {
        const service = createService()
        service.store.save.mockRejectedValueOnce(new Error('disk unavailable'))
        const record = { recordId: 'record-1', entity: { '@type': 'author', name: 'Ada' } }

        await expect(service.saveRecord(record)).rejects.toThrow('disk unavailable')
        await expect(service.saveRecord(record)).resolves.toEqual({
            author: [{
                recordId: 'record-1',
                entity: { '@type': ['author'], name: 'Ada' },
                relationships: {},
            }],
        })
    })

    it('reconciles a crate entity with one matching global record instead of duplicating it', async () => {
        const service = createService({
            author: [{
                recordId: 'ada',
                entity: { '@type': ['author'], name: 'Ada' },
                relationships: {},
            }],
        })
        service.appStateService.roCrate = {
            '@graph': [{ '@id': '#person', '@type': 'author', name: 'Ada' }],
        }

        const collection = await service.getCollection()

        expect(collection.author).toHaveLength(1)
        expect(service.store.save).not.toHaveBeenCalled()
        expect(service.mappingStore.save).toHaveBeenCalledWith({
            author: {
                ada: expect.objectContaining({ entityIds: ['#person'] }),
            },
        })
    })
})

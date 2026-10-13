// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

jest.mock('@theia/filesystem/lib/browser/file-service', () => ({ FileService: class FileService {} }))
jest.mock('rockit-common/lib/browser', () => ({
    readUtf8TextFile: jest.fn(),
    writeUtf8TextFile: jest.fn(),
}))

import { GlobalEntityLibraryStore } from './global-entity-library-store'

describe('GlobalEntityLibraryStore collection normalization', () => {
    const normalize = (value: unknown) =>
        (GlobalEntityLibraryStore.prototype as any).normalizeCollection(value)

    it('keeps supported records, removes transient fields, and normalizes their type', () => {
        expect(normalize({
            ignored: [{ recordId: 'nope', entity: { name: 'Ignored' } }],
            author: [
                {
                    recordId: 'ada',
                    entity: {
                        '@id': '#ada',
                        '@type': 'Thing',
                        '@reverse': { creator: [] },
                        name: 'Ada',
                    },
                    relationships: {
                        affiliation: ['org-1', 2],
                        empty: [],
                    },
                },
                { recordId: '', entity: { name: 'Invalid' } },
            ],
        })).toEqual({
            author: [{
                recordId: 'ada',
                entity: { '@type': ['author'], name: 'Ada' },
                relationships: { affiliation: ['org-1'] },
            }],
        })
    })

    it('rejects a collection that is not an object', () => {
        expect(() => normalize([])).toThrow('must be a JSON object grouped by entity type')
        expect(() => normalize(null)).toThrow('must be a JSON object grouped by entity type')
    })
})

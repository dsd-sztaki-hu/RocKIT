// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import URI from '@theia/core/lib/common/uri'

import { ArpRoCrateExportService } from './arp-ro-crate-export-service'

jest.mock('@theia/workspace/lib/browser', () => ({ WorkspaceService: class WorkspaceService {} }))
jest.mock('app-state/lib/browser/state/app-state-service', () => ({ AppStateService: class AppStateService {} }))
jest.mock('save-ro-crate/lib/browser/ro-crate-persistence-service', () => ({
  RoCratePersistenceService: class RoCratePersistenceService {},
}))

class TestArpExportService extends ArpRoCrateExportService {
  prepare(rootUri: URI) {
    return this.prepareCreateExport(rootUri)
  }
}

describe('ARP create preparation', () => {
  it('prepares a separate upload crate without making remote requests', async () => {
    const crate = {
      '@context': 'https://w3id.org/ro/crate/1.1/context',
      '@graph': [{ '@id': './', '@type': 'Dataset', '@arpPid': 'doi:old', name: 'Dataset' }],
    }
    const readFile = jest.fn(async () => ({ value: { toString: () => JSON.stringify(crate) } }))
    const fileService = { exists: jest.fn(async () => true), readFile }
    const service = new TestArpExportService(
      {} as never,
      fileService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )

    const result = await service.prepare(new URI('file:///workspace'))

    expect(result.crate).toEqual(crate)
    expect(result.uploadCrate['@graph'][0]).toEqual({
      '@id': './', '@type': 'Dataset', name: 'Dataset',
    })
    expect(result.fileSources).toEqual([])
    expect(result.originalToUploadIds).toEqual({})
    expect(readFile).toHaveBeenCalledTimes(1)
  })

  it('collects file source URIs and enriches only the upload copy of metadata', async () => {
    const crate = {
      '@context': 'https://w3id.org/ro/crate/1.1/context',
      '@graph': [
        { '@id': './', '@type': 'Dataset', hasPart: [{ '@id': 'data/file.txt' }] },
        { '@id': 'data/file.txt', '@type': 'File' },
      ],
    }
    const fileService = {
      exists: jest.fn(async () => true),
      readFile: jest.fn(async () => ({ value: { toString: () => JSON.stringify(crate) } })),
      resolve: jest.fn(async () => ({ isDirectory: false, size: 3, mtime: 123 })),
    }
    const service = new TestArpExportService(
      {} as never,
      fileService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )

    const result = await service.prepare(new URI('file:///workspace'))

    expect(result.crate).toEqual(crate)
    expect(result.uploadCrate['@graph'][1]).toMatchObject({
      '@id': 'data/file.txt', name: 'file.txt', contentSize: '3',
      encodingFormat: 'text/plain', directoryLabel: 'data',
    })
    expect(result.fileSources).toEqual([{
      entityId: 'data/file.txt', entryPath: 'data/file.txt',
      sourceUri: 'file:///workspace/data/file.txt',
      lastModified: 123, sourceSize: 3,
    }])
    expect(JSON.parse(JSON.stringify(result)).fileSources).toEqual(result.fileSources)
    expect(fileService.readFile).toHaveBeenCalledTimes(1)
  })
})

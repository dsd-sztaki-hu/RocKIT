// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import URI from '@theia/core/lib/common/uri'

import {
  DataverseProviderUpdateInspection,
  DataverseProviderUpdateResult,
  NativeDataverseExportService,
} from './native-dataverse-export-service'

jest.mock('@theia/workspace/lib/browser', () => ({
  WorkspaceService: class WorkspaceService {},
}))
jest.mock('app-state/lib/browser/state/app-state-service', () => ({
  AppStateService: class AppStateService {},
}))
jest.mock('save-ro-crate/lib/browser/ro-crate-persistence-service', () => ({
  RoCratePersistenceService: class RoCratePersistenceService {},
}))

describe('Dataverse plugin update orchestration', () => {
  it('persists provider checkpoints and completes the local update record', async () => {
    const root = new URI('file:///workspace')
    const crate = {
      '@graph': [
        {
          '@id': './',
          '@type': 'Dataset',
          name: 'Example',
          hasPart: { '@id': 'file.txt' },
        },
        { '@id': 'file.txt', '@type': 'File', name: 'file.txt' },
      ],
    }
    const remoteCrate = {
      '@graph': [
        { '@id': './', '@type': 'Dataset', hasPart: { '@id': '51' } },
        { '@id': '51', '@type': 'File', name: 'file.txt', hash: 'old' },
      ],
    }
    const saveEntityIdMapping = jest.fn(async () => undefined)
    const appendExportLog = jest.fn(
      async (_root: URI, _entry: Record<string, unknown>) => undefined,
    )
    const persistUploadedFileHash = jest.fn(async () => true)
    const persistenceWrite = jest.fn(async () => ({ previewLimited: false }))
    const selectedCrosswalk = {
      id: 'crosswalk-id',
      name: 'Crosswalk',
      repositories: { dataverse: { blocks: {} } },
      crosswalks: { canonicalToDataverse: { mappings: [] } },
    }
    const service = new NativeDataverseExportService(
      {} as never,
      {} as never,
      {} as never,
      {
        readFileHashes: async () => ({}),
        isFileRecordUnchanged: () => false,
      } as never,
      { roCrate: crate } as never,
      { write: persistenceWrite } as never,
      { read: async () => selectedCrosswalk } as never,
    )
    Object.assign(service, {
      getWorkspaceRoot: () => root,
      readRoCrate: async () => crate,
      resolveExistingExportTarget: async () => ({
        persistentId: 'doi:10.1/example',
        exportLogEntry: {
          target: 'https://dv.example/dataset.xhtml?persistentId=doi:10.1/example',
          repository: 'https://dv.example',
          mappingFile: 'mapping.json',
          crosswalkFile: 'crosswalk-id',
          collectionId: 'root',
        },
        mapping: { 'file.txt': '51', 'ro-crate-metadata.json': '52' },
      }),
      collectRoCrateUploadFiles: async () => ({
        files: [
          {
            entryPath: 'file.txt',
            sourceUri: 'file:///workspace/file.txt',
            localFileId: 'file.txt',
            lastModified: 123,
            sourceSize: 3,
          },
        ],
        metadataCrate: crate,
        uploadEntryPathByEntityId: new Map([['file.txt', 'file.txt']]),
        originalToUploadIds: new Map(),
      }),
      buildDatasetNativeMetadataUpdatePayload: async () => ({ metadataBlocks: {} }),
      saveEntityIdMapping,
      appendExportLog,
      persistUploadedFileHash,
      randomId: () => 'operation-1',
    })
    const repository = {
      id: 'dv',
      title: 'Dataverse',
      baseUrl: 'https://dv.example',
      apiKey: 'secret',
      providerId: 'dataverse',
      crosswalkId: 'crosswalk-id',
    }
    const target = {
      pid: 'doi:10.1/example',
      target: 'https://dv.example/dataset.xhtml?persistentId=doi:10.1/example',
      repository: 'https://dv.example',
      mappingFile: 'mapping.json',
      syncType: 'create' as const,
    }
    const inspection: DataverseProviderUpdateInspection = {
      providerId: 'dataverse',
      persistentId: target.pid,
      datasetVersionData: { metadataBlocks: { citation: {} } },
      draftFiles: [
        { id: '51', label: 'file.txt', md5: 'old', size: 3 },
        { id: '52', label: 'ro-crate-metadata.json' },
      ],
      metadataFileId: '52',
      remoteMetadataCrate: remoteCrate,
    }
    const result = await service.updateDataverseWithProvider(
      repository,
      target,
      async (input) => {
        if (input.phase === 'inspect') return inspection
        await service.handleProviderUpdateCheckpoint({
          operationId: 'operation-1',
          providerId: 'dataverse',
          persistentId: target.pid,
          stage: 'fileReplaced',
          fileResult: {
            kind: 'changed',
            localFileId: 'file.txt',
            entryPath: 'file.txt',
            remoteId: '54',
            md5: 'new',
            lastModified: 123,
            sourceSize: 3,
          },
        })
        return {
          providerId: 'dataverse',
          persistentId: target.pid,
          fileResults: [
            {
              kind: 'changed',
              localFileId: 'file.txt',
              entryPath: 'file.txt',
              remoteId: '54',
              md5: 'new',
              lastModified: 123,
              sourceSize: 3,
            },
          ],
          removedRemoteFileIds: [],
          metadataRemoteId: '55',
        } satisfies DataverseProviderUpdateResult
      },
    )

    expect(result?.replacedFileCount).toBe(1)
    expect(persistUploadedFileHash).toHaveBeenCalledTimes(1)
    expect(persistenceWrite).toHaveBeenCalledTimes(1)
    expect(appendExportLog.mock.calls.map((call) => call[1].status)).toEqual([
      'cancelled',
      'success',
    ])
    expect(saveEntityIdMapping).toHaveBeenLastCalledWith(root, 'mapping.json', {
      'file.txt': '54',
      'ro-crate-metadata.json': '55',
    })
  })
})

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import URI from '@theia/core/lib/common/uri'

import {
  DataverseProviderCreateResult,
  NativeDataverseExportService,
} from './native-dataverse-export-service'

jest.mock('@theia/workspace/lib/browser', () => ({ WorkspaceService: class WorkspaceService {} }))
jest.mock('app-state/lib/browser/state/app-state-service', () => ({ AppStateService: class AppStateService {} }))
jest.mock('save-ro-crate/lib/browser/ro-crate-persistence-service', () => ({
  RoCratePersistenceService: class RoCratePersistenceService {},
}))

function fixture() {
  const root = new URI('file:///workspace')
  const crate = {
    '@graph': [
      { '@id': './', '@type': 'Dataset', name: 'Example' },
      { '@id': 'file.txt', '@type': 'File', name: 'file.txt' },
    ],
  }
  const saveEntityIdMapping = jest.fn(async () => undefined)
  const appendExportLog = jest.fn(async (_root: URI, _entry: Record<string, unknown>) => undefined)
  const recordKnownHash = jest.fn(async () => true)
  const persistenceWrite = jest.fn(async () => ({ previewLimited: false }))
  const appState = { roCrate: crate }
  const selectedCrosswalk = {
    id: 'crosswalk-id',
    name: 'Test Dataverse crosswalk',
    repositories: { dataverse: { blocks: {} } },
    crosswalks: { canonicalToDataverse: { mappings: [] } },
  }
  const readCrosswalk = jest.fn(async () => selectedCrosswalk)
  const buildDatasetCreationPayload = jest.fn(
    async () => ({ datasetVersion: { metadataBlocks: {} } }),
  )
  const service = new NativeDataverseExportService(
    {} as never,
    {} as never,
    {} as never,
    { recordKnownHash } as never,
    appState as never,
    { write: persistenceWrite } as never,
    { read: readCrosswalk } as never,
  )
  Object.assign(service, {
    getWorkspaceRoot: () => root,
    readRoCrate: async () => crate,
    fetchCollectionMetadataBlockAliases: async () => new Set(['citation']),
    buildDatasetCreationPayload,
    collectRoCrateUploadFiles: async () => ({
      files: [{
        entryPath: 'file.txt',
        content: Uint8Array.from([1]),
        sourceUri: 'file:///workspace/file.txt',
        localFileId: 'file.txt',
        lastModified: 123,
        sourceSize: 1,
      }],
      metadataCrate: crate,
      uploadEntryPathByEntityId: new Map([['file.txt', 'file.txt']]),
      originalToUploadIds: new Map(),
    }),
    createUniqueMappingFileName: async () => 'mapping.json',
    randomId: () => 'operation-1',
    buildEntityIdMapping: () => ({ 'file.txt': '' }),
    saveEntityIdMapping,
    appendExportLog,
  })
  const repository = {
    id: 'dv',
    title: 'Dataverse',
    baseUrl: 'https://demo.dataverse.org',
    apiKey: 'secret',
    providerId: 'dataverse',
    crosswalkId: 'crosswalk-id',
  }
  const collection = { id: 'root', alias: 'root', name: 'Root' }
  const metadata = {
    title: 'Example',
    authorNames: [],
    contactEmails: [],
    descriptions: [],
    subjects: [],
  }
  const remote: DataverseProviderCreateResult = {
    providerId: 'dataverse',
    persistentId: 'doi:10.1/example',
    datasetId: 7,
    creationResponse: { status: 'OK' },
    fileResults: [{
      localFileId: 'file.txt',
      entryPath: 'file.txt',
      fileName: 'file.txt',
      remoteId: '51',
      md5: '900150983cd24fb0d6963f7d28e17f72',
      lastModified: 123,
      sourceSize: 1,
      response: { status: 'OK' },
    }],
    metadataRemoteId: '52',
    metadataResponse: { status: 'OK' },
  }
  return {
    service,
    repository,
    collection,
    metadata,
    remote,
    saveEntityIdMapping,
    appendExportLog,
    recordKnownHash,
    persistenceWrite,
    readCrosswalk,
    selectedCrosswalk,
    buildDatasetCreationPayload,
  }
}

describe('Dataverse plugin create export completion', () => {
  it('persists incremental recovery state and completes the local export link', async () => {
    const f = fixture()
    const result = await f.service.exportToDataverseWithProvider(
      f.repository,
      f.collection,
      f.metadata,
      new Set(['citation']),
      async input => {
        await f.service.handleProviderCreateCheckpoint({
          operationId: input.operationId,
          providerId: 'dataverse',
          stage: 'datasetCreated',
          persistentId: f.remote.persistentId,
        })
        await f.service.handleProviderCreateCheckpoint({
          operationId: input.operationId,
          providerId: 'dataverse',
          stage: 'fileUploaded',
          persistentId: f.remote.persistentId,
          fileResult: f.remote.fileResults[0],
        })
        return f.remote
      },
    )

    expect(result.target).toBe(
      'https://demo.dataverse.org/dataset.xhtml?persistentId=doi%3A10.1%2Fexample',
    )
    expect(result.uploadedFiles).toHaveLength(2)
    expect(f.appendExportLog.mock.calls.map(call => call[1].status)).toEqual([
      'cancelled',
      'success',
    ])
    expect(f.appendExportLog.mock.calls[1][1].crosswalkFile).toBe('crosswalk-id')
    expect(f.recordKnownHash).toHaveBeenCalledWith(
      expect.anything(),
      'file.txt',
      123,
      1,
      '900150983cd24fb0d6963f7d28e17f72',
    )
    expect(f.persistenceWrite).toHaveBeenCalledTimes(1)
    expect(f.readCrosswalk).toHaveBeenCalledWith('crosswalk-id')
    expect(f.buildDatasetCreationPayload).toHaveBeenCalledWith(
      f.metadata,
      expect.anything(),
      new Set(['citation']),
      f.selectedCrosswalk,
    )
    expect(f.saveEntityIdMapping).toHaveBeenLastCalledWith(
      expect.anything(),
      'mapping.json',
      { 'file.txt': '51', 'ro-crate-metadata.json': '52' },
    )
  })

  it('records a failed but recoverable target after an interrupted provider export', async () => {
    const f = fixture()
    const interrupted = {
      ...f.remote,
      interrupted: true,
      metadataRemoteId: undefined,
      metadataResponse: undefined,
      errorMessage: 'Upload failed',
    }

    await expect(
      f.service.exportToDataverseWithProvider(
        f.repository,
        f.collection,
        f.metadata,
        new Set(['citation']),
        async () => interrupted,
      ),
    ).rejects.toThrow('Upload failed')
    expect(f.appendExportLog.mock.calls.map(call => call[1].status)).toEqual([
      'cancelled',
      'failed',
    ])
  })

  it('skips automatic RO-Crate mapping when the repository has no crosswalk', async () => {
    const f = fixture()
    const repository = { ...f.repository, crosswalkId: undefined }

    await f.service.exportToDataverseWithProvider(
      repository,
      f.collection,
      f.metadata,
      new Set(['citation']),
      async () => f.remote,
    )

    expect(f.readCrosswalk).not.toHaveBeenCalled()
    expect(f.buildDatasetCreationPayload).toHaveBeenCalledWith(
      f.metadata,
      expect.anything(),
      new Set(['citation']),
      null,
    )
  })
})

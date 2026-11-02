// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import URI from '@theia/core/lib/common/uri'

import { NativeDataverseImportService } from './native-dataverse-import-service'

jest.mock('@theia/workspace/lib/browser', () => ({
  WorkspaceService: class WorkspaceService {},
}))
jest.mock('@theia/filesystem/lib/browser/file-dialog', () => ({
  FileDialogService: class FileDialogService {},
}))
jest.mock('app-state/lib/browser/state/app-state-service', () => ({
  AppStateService: class AppStateService {},
}))
jest.mock('save-ro-crate/lib/browser/ro-crate-persistence-service', () => ({
  RoCratePersistenceService: class RoCratePersistenceService {},
}))

describe('Dataverse plugin import completion', () => {
  it('extracts the provider archive and persists the supplied repository snapshot', async () => {
    const target = new URI('file:///imports/example')
    const archive = target.resolve('.rockit-dataverse-import.zip')
    const metadata = target.resolve('ro-crate-metadata.json')
    const existing = new Set([archive.toString(), metadata.toString()])
    const deleted: string[] = []
    const opened: string[] = []
    const persistImportedDatasetLink = jest.fn(async () => ({
      mappingFileName: 'mapping.json',
      target: 'https://dv.example/dataset.xhtml?persistentId=doi:10.1/example',
    }))
    const service = new NativeDataverseImportService(
      {
        readFile: async () => ({ value: BinaryBuffer.wrap(Uint8Array.from([80, 75])) }),
        exists: async (uri: URI) => existing.has(uri.toString()),
        delete: async (uri: URI) => {
          deleted.push(uri.toString())
          existing.delete(uri.toString())
        },
      } as never,
      { open: (uri: URI) => opened.push(uri.toString()) } as never,
      { persistImportedDatasetLink } as never,
    )
    Object.assign(service, {
      extractZip: async () => 3,
    })
    const repository = {
      id: 'dv',
      title: 'Dataverse',
      baseUrl: 'https://dv.example',
      providerId: 'dataverse',
      crosswalkId: 'crosswalk-id',
    }
    const datasetVersionData = { metadataBlocks: { citation: { fields: [] } } }

    const result = await service.completeProviderImport(repository, {
      providerId: 'dataverse',
      persistentId: 'doi:10.1/example',
      importedWorkspaceUri: target.toString(),
      archiveUri: archive.toString(),
      datasetVersionData,
    })

    expect(result).toEqual(expect.objectContaining({
      persistentId: 'doi:10.1/example',
      extractedFileCount: 3,
      hasRoCrateMetadata: true,
      mappingFileName: 'mapping.json',
    }))
    expect(deleted).toEqual([archive.toString()])
    expect(persistImportedDatasetLink).toHaveBeenCalledWith(
      target,
      repository,
      'doi:10.1/example',
      datasetVersionData,
    )
    expect(opened).toEqual([target.toString()])
  })
})

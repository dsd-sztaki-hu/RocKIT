// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import URI from '@theia/core/lib/common/uri'

import {
  DataverseProviderUpdateInspection,
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

describe('Dataverse plugin sync orchestration', () => {
  it('maps remote metadata before merging so local compound additions remain referenced', async () => {
    const root = new URI('file:///workspace')
    const localCrate = {
      '@graph': [
        {
          '@id': './',
          '@type': 'Dataset',
          name: 'Local',
          keyword: [{ '@id': '#keyword-remote' }, { '@id': '#keyword-local' }],
          author: [{ '@id': '#author-remote' }, { '@id': '#author-local' }],
        },
        { '@id': '#keyword-remote', '@type': 'keyword', name: 'Cica' },
        { '@id': '#keyword-local', '@type': 'keyword', name: 'Rat' },
        { '@id': '#author-remote', '@type': 'author', name: 'Remote Author' },
        { '@id': '#author-local', '@type': 'author', name: 'Local Author' },
      ],
    }
    const remoteCrate = {
      '@graph': [
        {
          '@id': './',
          '@type': 'Dataset',
          name: 'Remote snapshot',
          keyword: { '@id': '#keyword-remote' },
          author: { '@id': '#author-remote' },
        },
        { '@id': '#keyword-remote', '@type': 'keyword', name: 'Old keyword' },
        { '@id': '#author-remote', '@type': 'author', name: 'Old author' },
      ],
    }
    const selectedCrosswalk = {
      id: 'crosswalk-id',
      name: 'Crosswalk',
      repositories: { dataverse: { blocks: {} } },
      crosswalks: { canonicalToDataverse: { mappings: [] } },
    }
    const mappedRemoteCrate = {
      '@graph': [
        {
          '@id': './',
          '@type': 'Dataset',
          name: 'Mapped remote',
          keyword: { '@id': '#keyword-remote' },
          author: { '@id': '#author-remote' },
        },
        { '@id': '#keyword-remote', '@type': 'keyword', name: 'Cica' },
        { '@id': '#author-remote', '@type': 'author', name: 'Mapped Remote Author' },
      ],
    }
    const applyMetadataBlocksToRoCrate = jest.fn(() => ({
      crate: mappedRemoteCrate,
      updatedFields: ['keyword', 'author'],
    }))
    const writeFile = jest.fn(async (..._args: unknown[]) => undefined)
    const saveEntityIdMapping = jest.fn(async () => undefined)
    const appendExportLog = jest.fn(
      async (_root: URI, _entry: Record<string, unknown>) => undefined,
    )
    const service = new NativeDataverseExportService(
      {} as never,
      { writeFile } as never,
      { applyMetadataBlocksToRoCrate } as never,
      { readFileHashes: async () => ({}) } as never,
      {} as never,
      {} as never,
      { read: async () => selectedCrosswalk } as never,
    )
    Object.assign(service, {
      getWorkspaceRoot: () => root,
      readRoCrate: async () => localCrate,
      resolveExistingExportTarget: async () => ({
        persistentId: 'doi:10.1/example',
        exportLogEntry: {
          target: 'https://dv.example/dataset.xhtml?persistentId=doi:10.1/example',
          repository: 'https://dv.example',
          mappingFile: 'mapping.json',
          crosswalkFile: 'crosswalk-id',
          collectionId: 'root',
        },
        mapping: { 'ro-crate-metadata.json': '52' },
      }),
      saveEntityIdMapping,
      appendExportLog,
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
      draftFiles: [{ id: '52', label: 'ro-crate-metadata.json' }],
      metadataFileId: '52',
      remoteMetadataCrate: remoteCrate,
    }

    const result = await service.syncDataverseWithProvider(
      repository,
      target,
      { metadataMode: 'local-additions' },
      async (input) =>
        input.phase === 'inspect'
          ? inspection
          : {
              providerId: 'dataverse',
              persistentId: target.pid,
              downloadedFiles: [],
            },
    )

    expect(result?.updatedMetadataFields).toEqual(['keyword', 'author'])
    expect(applyMetadataBlocksToRoCrate).toHaveBeenCalledWith(
      remoteCrate,
      inspection.datasetVersionData,
      selectedCrosswalk,
    )
    expect(writeFile).toHaveBeenCalled()
    const writtenContent = writeFile.mock.calls[0]?.[1] as { toString(): string }
    const synchronizedCrate = JSON.parse(writtenContent.toString())
    const synchronizedRoot = synchronizedCrate['@graph']
      .find((entity: Record<string, unknown>) => entity['@id'] === './')
    expect(synchronizedRoot.keyword).toEqual([
      { '@id': '#keyword-remote' },
      { '@id': '#keyword-local' },
    ])
    expect(synchronizedRoot.author).toEqual([
      { '@id': '#author-remote' },
      { '@id': '#author-local' },
    ])
    expect(synchronizedCrate['@graph']).toEqual(expect.arrayContaining([
      expect.objectContaining({ '@id': '#keyword-local', name: 'Rat' }),
      expect.objectContaining({ '@id': '#author-local', name: 'Local Author' }),
    ]))
    expect(appendExportLog.mock.calls.map((call) => call[1].status)).toEqual([
      'cancelled',
      'success',
    ])
  })
})

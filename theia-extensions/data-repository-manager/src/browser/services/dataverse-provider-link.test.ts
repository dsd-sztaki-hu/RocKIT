// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import URI from '@theia/core/lib/common/uri'

import {
  ArpRoCrateLinkService,
  DataverseProviderLinkSnapshot,
} from './arp-ro-crate-link-service'

jest.mock('@theia/workspace/lib/browser', () => ({ WorkspaceService: class WorkspaceService {} }))

function fixture() {
  const root = new URI('file:///workspace')
  const crate = { '@graph': [
    { '@id': './', '@type': 'Dataset', name: 'Local dataset' },
    { '@id': 'data/sample.csv', '@type': 'File' },
    { '@id': 'ro-crate-metadata.json', '@type': 'CreativeWork' },
  ] }
  const saveEntityIdMapping = jest.fn(async () => undefined)
  const appendExportLog = jest.fn(async () => undefined)
  const service = new ArpRoCrateLinkService({} as never, {} as never)
  Object.assign(service, {
    getWorkspaceRoot: () => root,
    readRoCrate: async () => crate,
    findExistingMappingFile: async () => undefined,
    createUniqueMappingFileName: async () => 'mapping.json',
    saveEntityIdMapping,
    appendExportLog,
  })
  const repository = {
    id: 'dv', title: 'Dataverse', baseUrl: 'https://demo.dataverse.org/',
    apiKey: 'secret', providerId: 'dataverse',
  }
  const snapshot: DataverseProviderLinkSnapshot = {
    providerId: 'dataverse',
    persistentId: 'doi:10.1/example',
    target: 'https://demo.dataverse.org/dataset.xhtml?persistentId=doi:10.1/example',
    remoteDatasetTitle: 'Remote dataset',
    remoteFiles: [
      { id: '42', path: 'data/sample.csv' },
      { id: '43', path: 'ro-crate-metadata.json' },
    ],
  }
  return { service, repository, snapshot, saveEntityIdMapping, appendExportLog }
}

describe('Dataverse provider link completion', () => {
  it('compares titles locally while the provider only supplies the remote snapshot', async () => {
    const f = fixture()
    const invoke = jest.fn(async () => f.snapshot)

    const preview = await f.service.previewDataverseLinkWithProvider(
      f.repository, 'doi:10.1/example', invoke,
    )

    expect(invoke).toHaveBeenCalledWith({
      repository: f.repository,
      datasetUrl: 'doi:10.1/example',
    })
    expect(preview).toEqual({
      pid: 'doi:10.1/example',
      localDatasetTitle: 'Local dataset',
      remoteDatasetTitle: 'Remote dataset',
      titleMismatch: true,
    })
  })

  it('persists file mappings and the export target in RocKIT', async () => {
    const f = fixture()
    const result = await f.service.linkDataverseWithProvider(
      f.repository, 'doi:10.1/example', async () => f.snapshot, 'crosswalk-id',
    )

    expect(f.saveEntityIdMapping).toHaveBeenCalledWith(
      expect.any(URI),
      'mapping.json',
      {
        'data/sample.csv': '42',
        'ro-crate-metadata.json': '43',
      },
    )
    expect(f.appendExportLog).toHaveBeenCalledWith(
      expect.any(URI),
      expect.objectContaining({
        target: f.snapshot.target,
        repository: 'https://demo.dataverse.org',
        mappingFile: 'mapping.json',
        crosswalkFile: 'crosswalk-id',
        status: 'success',
      }),
    )
    expect(result.mappedEntityCount).toBe(2)
    expect(result.unmappedEntityIds).toEqual([])
  })
})

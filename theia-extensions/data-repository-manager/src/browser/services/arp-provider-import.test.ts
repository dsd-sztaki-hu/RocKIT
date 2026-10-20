// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import URI from '@theia/core/lib/common/uri'

import { DataRepositoryConfig } from '../types'
import { ArpRoCrateImportService } from './arp-ro-crate-import-service'

jest.mock('@theia/filesystem/lib/browser/file-dialog', () => ({
  FileDialogService: class FileDialogService {},
}))
jest.mock('@theia/filesystem/lib/browser/file-service', () => ({
  FileService: class FileService {},
}))
jest.mock('@theia/workspace/lib/browser', () => ({ WorkspaceService: class WorkspaceService {} }))

describe('ARP provider import completion', () => {
  it('extracts the staged provider archive, persists local state, and opens the workspace', async () => {
    const deleted: string[] = []
    const open = jest.fn((_uri: URI, _options: { preserveWindow: boolean }) => undefined)
    const fileService = {
      readFile: jest.fn(async () => ({ value: BinaryBuffer.wrap(Uint8Array.from([80, 75])) })),
      exists: jest.fn(async () => true),
      delete: jest.fn(async (uri: URI) => { deleted.push(uri.toString()) }),
    }
    const service = new ArpRoCrateImportService(
      {} as never, fileService as never, { open } as never, {} as never)
    const crate = { '@graph': [{ '@id': './', '@type': 'Dataset', name: 'Imported' }] }
    const extractZip = jest.fn(async (_bytes: Uint8Array, _target: URI) => 3)
    const persistImportedExportState = jest.fn(async (
      _rootUri: URI,
      _repository: DataRepositoryConfig,
      _pid: string,
      _crate: Record<string, unknown>,
    ) => 'mapping.json')
    const persistImportedFileHashes = jest.fn(async () => undefined)
    Object.assign(service, {
      extractZip,
      readRoCrate: async () => crate,
      persistImportedExportState,
      persistImportedFileHashes,
    })
    const repository = {
      id: 'arp', title: 'ARP', baseUrl: 'https://repo.researchdata.hu',
      providerId: 'arp', crosswalkId: 'crosswalk-id',
    }

    const result = await service.completeProviderImport(repository, {
      providerId: 'arp', datasetPid: 'hdl:21.15109/ARP/VYBLPE',
      importedWorkspaceUri: 'file:///imports/VYBLPE',
      archiveUri: 'file:///imports/VYBLPE/.rockit-arp-import.zip',
    })

    expect(Array.from(extractZip.mock.calls[0][0])).toEqual([80, 75])
    expect(extractZip.mock.calls[0][1].toString()).toBe('file:///imports/VYBLPE')
    expect(deleted).toEqual(['file:///imports/VYBLPE/.rockit-arp-import.zip'])
    expect(persistImportedExportState.mock.calls[0][0].toString())
      .toBe('file:///imports/VYBLPE')
    expect(persistImportedExportState.mock.calls[0].slice(1)).toEqual([
      repository, 'hdl:21.15109/ARP/VYBLPE', crate,
    ])
    expect(persistImportedFileHashes).toHaveBeenCalled()
    expect(open.mock.calls[0][0].toString()).toBe('file:///imports/VYBLPE')
    expect(open.mock.calls[0][1]).toEqual({ preserveWindow: false })
    expect(result).toEqual(expect.objectContaining({
      datasetPid: 'hdl:21.15109/ARP/VYBLPE', extractedFileCount: 3,
      mappingFileName: 'mapping.json', openedWorkspace: true,
    }))
  })

  it('rejects a staged archive outside the provider-created workspace', async () => {
    const service = new ArpRoCrateImportService(
      {} as never, {} as never, {} as never, {} as never)

    await expect(service.completeProviderImport({
      id: 'arp', title: 'ARP', baseUrl: 'https://repo.example.org', providerId: 'arp',
    }, {
      providerId: 'arp', datasetPid: 'doi:10.1/example',
      importedWorkspaceUri: 'file:///imports/example',
      archiveUri: 'file:///elsewhere/archive.zip',
    })).rejects.toThrow('outside its workspace')
  })
})

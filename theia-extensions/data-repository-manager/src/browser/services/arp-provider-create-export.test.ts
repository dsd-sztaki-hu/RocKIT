// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import URI from '@theia/core/lib/common/uri'

import {
  ArpRoCrateExportService, ArpProviderCreateResult, ArpRoCrateValidationError,
  PreparedArpCreateExport,
} from './arp-ro-crate-export-service'

jest.mock('@theia/workspace/lib/browser', () => ({ WorkspaceService: class WorkspaceService {} }))
jest.mock('app-state/lib/browser/state/app-state-service', () => ({ AppStateService: class AppStateService {} }))
jest.mock('save-ro-crate/lib/browser/ro-crate-persistence-service', () => ({
  RoCratePersistenceService: class RoCratePersistenceService {},
}))

function fixture() {
  const root = new URI('file:///workspace')
  const crate = { '@graph': [
    { '@id': './', '@type': 'Dataset', name: 'Example' },
    { '@id': 'file.txt', '@type': 'File' },
  ] }
  const plan: PreparedArpCreateExport = {
    crate, uploadCrate: crate, fileSources: [], originalToUploadIds: {},
  }
  const saveEntityIdMapping = jest.fn(async () => undefined)
  const appendExportLog = jest.fn(async (_rootUri: URI, _entry: Record<string, any>) => undefined)
  const recordKnownHash = jest.fn(async () => true)
  const persistenceWrite = jest.fn(async () => ({ previewLimited: false }))
  const appState = { roCrate: crate }
  const service = new ArpRoCrateExportService(
    {} as never, {} as never,
    { requiredFields: () => new Set(['title']) } as never,
    { recordKnownHash } as never, appState as never, { write: persistenceWrite } as never, {} as never,
  )
  Object.assign(service, {
    getWorkspaceRoot: () => root,
    prepareCreateExport: async () => plan,
    createUniqueMappingFileName: async () => 'mapping.json',
    saveEntityIdMapping,
    appendExportLog,
  })
  const repository = { id: 'arp', title: 'ARP', baseUrl: 'https://repo.example.org',
    apiKey: 'secret', providerId: 'arp', crosswalkId: 'crosswalk-id' }
  const collection = { id: 'root', alias: 'root', name: 'Root' }
  const metadata = { title: 'Example', authorNames: [], contactEmails: [],
    descriptions: [], subjects: [], metadataLanguage: 'en' }
  const remote: ArpProviderCreateResult = {
    pid: 'doi:10.1/example', creationResponse: { status: 'OK' },
    processedRemoteCrate: crate, uploadCrate: crate,
    uploadIdMapping: { './': './' }, fileResults: [],
  }
  return { service, plan, repository, collection, metadata, remote,
    saveEntityIdMapping, appendExportLog, recordKnownHash, persistenceWrite, appState }
}

describe('ARP plugin create export completion', () => {
  it('uses the selected crosswalk for create and the logged crosswalk for update and sync', async () => {
    const { service, repository } = fixture()
    const root = new URI('file:///workspace')
    const canonical = { '@id': './', '@type': 'Dataset', 'https://example.org/title': 'Example' }
    const remote = { '@id': './', '@type': 'Dataset', arpTitle: 'Remote' }
    const crate = { '@graph': [canonical] }
    const remoteCrate = { '@graph': [remote] }
    const read = jest.fn(async (id: string) => id === 'chosen' ? {
      id, name: 'Chosen',
      crosswalks: { arpRoCrateToCanonical: { mappings: [{
        direction: 'both',
        source: { block: 'citation', entityClass: 'Dataset', field: 'arpTitle' },
        canonical: { entity: 'root', entityClass: 'Dataset', property: 'https://example.org/title' },
      }] } },
    } : undefined)
    const exportLogEntry = { mappingFile: 'mapping.json', crosswalkFile: 'chosen' }
    Object.assign(service, {
      prepareCreateExport: ArpRoCrateExportService.prototype.prepareCreateExport,
      readRoCrate: async () => crate,
      crosswalkRegistry: { read },
      resolveExistingArpExportTarget: async () => ({
        pid: 'doi:10.1/example', exportLogEntry, mapping: { './': './' },
      }),
      fileHashStoreService: { readFileHashes: async () => ({}) },
    })
    const target = {
      pid: 'doi:10.1/example', target: 'doi:10.1/example', repository: repository.baseUrl,
      mappingFile: 'mapping.json', crosswalkFile: 'stale-selection', syncType: 'create' as const,
    }

    const create = await service.prepareCreateExport(root, 'chosen')
    expect(create.uploadCrate['@graph'][0]).toEqual({ ...remote, arpTitle: 'Example' })
    const update = await service.prepareUpdateExport(repository, remoteCrate, target)
    expect(update?.uploadCrate['@graph'][0]).toEqual(create.uploadCrate['@graph'][0])
    const sync = await service.prepareSyncExport(repository, remoteCrate, target, 'remote-additions')
    expect(sync.remoteCrate['@graph'][0]).toEqual({ ...canonical, 'https://example.org/title': 'Remote' })
    expect(crate['@graph'][0]).toEqual(canonical)

    exportLogEntry.crosswalkFile = 'deleted'
    await expect(service.prepareUpdateExport(repository, remoteCrate, target))
      .rejects.toThrow("The selected crosswalk 'deleted' is no longer registered.")
    await expect(service.prepareSyncExport(repository, remoteCrate, target, 'remote-additions'))
      .rejects.toThrow("The selected crosswalk 'deleted' is no longer registered.")
  })

  it('prepares the payload in RocKIT and records a successful target and mapping', async () => {
    const f = fixture()
    const invoke = jest.fn(async () => f.remote)

    const result = await f.service.exportToArpWithProvider(
      f.repository, f.collection, f.metadata, invoke, 'crosswalk-id')

    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      repository: f.repository, collectionId: 'root', plan: f.plan,
      datasetCreationPayload: expect.objectContaining({ metadataLanguage: 'en' }),
    }))
    expect(f.appendExportLog.mock.calls.map(call => call[1].status)).toEqual(['cancelled', 'success'])
    expect(f.appendExportLog.mock.calls[1][1].crosswalkFile).toBe('crosswalk-id')
    expect(f.saveEntityIdMapping).toHaveBeenCalled()
    expect(result.pid).toBe('doi:10.1/example')
    expect(result.target).toBe(
      'https://repo.example.org/dataset.xhtml?persistentId=doi:10.1/example')
    expect(f.appendExportLog.mock.calls[1][1].target).toBe(result.target)
    expect(result.mappingFileName).toBe('mapping.json')
  })

  it('records a recoverable target before reporting a partial provider failure', async () => {
    const f = fixture()
    const interrupted = { ...f.remote, processedRemoteCrate: undefined,
      interrupted: true, errorMessage: 'File upload failed' }

    await expect(f.service.exportToArpWithProvider(
      f.repository, f.collection, f.metadata, async () => interrupted,
      'crosswalk-id',
    )).rejects.toThrow('File upload failed')
    expect(f.appendExportLog.mock.calls.map(call => call[1].status)).toEqual(['cancelled'])
    expect(f.appendExportLog.mock.calls[0][1].target).toBe(
      'https://repo.example.org/dataset.xhtml?persistentId=doi:10.1/example')
  })

  it('opens an HDL export on the configured repository dataset page', async () => {
    const f = fixture()
    f.remote.pid = 'hdl:21.15109/ARP/VYBLPE'

    const result = await f.service.exportToArpWithProvider(
      f.repository, f.collection, f.metadata, async () => f.remote, 'crosswalk-id')

    expect(result.target).toBe(
      'https://repo.example.org/dataset.xhtml?persistentId=hdl:21.15109/ARP/VYBLPE')
  })

  it('persists uploaded file hashes and the remote entity ID mapping', async () => {
    const f = fixture()
    f.plan.crate['@graph'].push({ '@id': 'second.txt', '@type': 'File' })
    f.plan.fileSources.push({
      entityId: 'file.txt', entryPath: 'file.txt',
      sourceUri: 'file:///workspace/file.txt', lastModified: 123, sourceSize: 3,
    }, {
      entityId: 'second.txt', entryPath: 'second.txt',
      sourceUri: 'file:///workspace/second.txt', lastModified: 456, sourceSize: 4,
    })
    const remoteId = 'https://w3id.org/arp/ro-id/doi:10.1/example/file/123'
    const secondRemoteId = 'https://w3id.org/arp/ro-id/doi:10.1/example/file/124'
    f.remote.fileResults.push({
      entityId: 'file.txt', entryPath: 'file.txt', remoteId,
      md5: '900150983cd24fb0d6963f7d28e17f72',
    }, {
      entityId: 'second.txt', entryPath: 'second.txt', remoteId: secondRemoteId,
      md5: 'e2fc714c4727ee9395f324cd2e7f331f',
    })
    f.remote.uploadIdMapping['file.txt'] = remoteId
    f.remote.uploadIdMapping['second.txt'] = secondRemoteId

    await f.service.exportToArpWithProvider(
      f.repository, f.collection, f.metadata, async input => {
        await f.service.handleProviderCreateCheckpoint({
          operationId: input.operationId, providerId: 'arp',
          stage: 'datasetCreated', pid: f.remote.pid,
        })
        expect(f.appendExportLog.mock.calls[0][1].status).toBe('cancelled')
        for (const fileResult of f.remote.fileResults) {
          await f.service.handleProviderCreateCheckpoint({
            operationId: input.operationId, providerId: 'arp',
            stage: 'fileUploaded', pid: f.remote.pid, fileResult,
          })
        }
        expect(f.recordKnownHash).toHaveBeenCalledTimes(2)
        return f.remote
      }, 'crosswalk-id')

    expect(f.recordKnownHash).toHaveBeenCalledWith(
      expect.anything(), 'file.txt', 123, 3, '900150983cd24fb0d6963f7d28e17f72')
    expect(f.recordKnownHash).toHaveBeenCalledTimes(2)
    expect(f.persistenceWrite).toHaveBeenCalledTimes(1)
    expect((f.appState.roCrate['@graph'][1] as Record<string, unknown>).hash)
      .toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(f.saveEntityIdMapping).toHaveBeenCalledTimes(4)
  })

  it('restores the structured ARP validation error without creating a local target', async () => {
    const f = fixture()
    await expect(f.service.exportToArpWithProvider(
      f.repository, f.collection, f.metadata,
      async () => ({ validationFailure: {
        status: 400, url: 'https://repo.example.org/api/arp/validateRoCrate',
        validationErrors: [{ errorEntity: './', errors: [{ errorMessage: 'Invalid title' }] }],
        payload: { errors: [] },
      } }),
      'crosswalk-id',
    )).rejects.toBeInstanceOf(ArpRoCrateValidationError)
    expect(f.appendExportLog).not.toHaveBeenCalled()
  })
})

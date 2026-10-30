// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import URI from '@theia/core/lib/common/uri'

import {
  ArpProviderUpdateResult,
  ArpRoCrateExportService,
  PreparedArpUpdateExport,
} from './arp-ro-crate-export-service'
import { ExportLogEntry } from './export-log'

jest.mock('@theia/workspace/lib/browser', () => ({ WorkspaceService: class WorkspaceService {} }))
jest.mock('app-state/lib/browser/state/app-state-service', () => ({ AppStateService: class AppStateService {} }))
jest.mock('save-ro-crate/lib/browser/ro-crate-persistence-service', () => ({
  RoCratePersistenceService: class RoCratePersistenceService {},
}))

function fixture() {
  const root = new URI('file:///workspace')
  const localCrate = { '@graph': [
    { '@id': './', '@type': 'Dataset', name: 'Example' },
    { '@id': 'file.txt', '@type': 'File' },
  ] }
  const oldRemoteId = 'https://w3id.org/arp/ro-id/doi:10.1/example/file/10'
  const newRemoteId = 'https://w3id.org/arp/ro-id/doi:10.1/example/file/20'
  const remoteCrate = { '@graph': [
    { '@id': './', '@type': 'Dataset' },
    { '@id': oldRemoteId, '@type': 'File' },
  ] }
  const processedRemoteCrate = { '@graph': [
    { '@id': './', '@type': 'Dataset' },
    { '@id': newRemoteId, '@type': 'File' },
  ] }
  const plan: PreparedArpUpdateExport = {
    pid: 'doi:10.1/example',
    target: 'hdl:doi:10.1/example',
    crate: localCrate,
    uploadCrate: JSON.parse(JSON.stringify(localCrate)),
    remoteCrate,
    mappingFileName: 'mapping.json',
    metadataIdMapping: { 'file.txt': oldRemoteId },
    uploadIdMapping: { './': './', 'file.txt': oldRemoteId },
    originalToUploadIds: {},
    addedFiles: [],
    changedFiles: [{
      metadataEntityId: 'file.txt', uploadEntityId: 'file.txt', entryPath: 'file.txt',
      sourceUri: 'file:///workspace/file.txt', remoteId: oldRemoteId, remoteFileId: 10,
      lastModified: 123, sourceSize: 3,
    }],
    removedFiles: [],
  }
  const fileResult = {
    kind: 'changed' as const,
    metadataEntityId: 'file.txt', uploadEntityId: 'file.txt', entryPath: 'file.txt',
    remoteId: newRemoteId, md5: '900150983cd24fb0d6963f7d28e17f72',
    lastModified: 123, sourceSize: 3,
  }
  const remote: ArpProviderUpdateResult = {
    providerId: 'arp', pid: plan.pid, processedRemoteCrate,
    uploadCrate: { '@graph': [
      { '@id': './', '@type': 'Dataset', name: 'Example' },
      { '@id': 'file.txt', '@type': 'File', hash: fileResult.md5 },
    ] },
    uploadIdMapping: { './': './', 'file.txt': newRemoteId },
    fileResults: [fileResult], removedRemoteIds: [],
  }
  const saveEntityIdMapping = jest.fn(async () => undefined)
  const appendExportLog = jest.fn(async (
    _rootUri: URI, _entry: ExportLogEntry,
  ) => undefined)
  const recordKnownHash = jest.fn(async () => true)
  const persistUploadedFileHash = jest.fn(async () => undefined)
  const service = new ArpRoCrateExportService(
    {} as never, {} as never, {} as never,
    { recordKnownHash } as never, { roCrate: localCrate } as never, {} as never,
  )
  Object.assign(service, {
    getWorkspaceRoot: () => root,
    prepareUpdateExport: async () => plan,
    saveEntityIdMapping,
    appendExportLog,
    persistUploadedFileHash,
  })
  const repository = {
    id: 'arp', title: 'ARP', baseUrl: 'https://repo.example.org', apiKey: 'secret',
    providerId: 'arp', crosswalkId: 'crosswalk-id',
  }
  const target = {
    pid: plan.pid, target: plan.target, repository: repository.baseUrl,
    mappingFile: plan.mappingFileName, syncType: 'create' as const,
  }
  return {
    service, repository, target, plan, remote, remoteCrate, fileResult,
    saveEntityIdMapping, appendExportLog, recordKnownHash, persistUploadedFileHash,
  }
}

describe('ARP plugin update export completion', () => {
  it('loads remotely through the provider and persists checkpointed update state', async () => {
    const f = fixture()
    const phases: string[] = []

    const result = await f.service.updateArpWithProvider(
      f.repository,
      f.target,
      async input => {
        phases.push(input.phase as string)
        if (input.phase === 'loadRemote') return { remoteCrate: f.remoteCrate }
        await f.service.handleProviderUpdateCheckpoint({
          operationId: input.operationId as string,
          providerId: 'arp',
          stage: 'fileReplaced',
          pid: f.plan.pid,
          fileResult: f.fileResult,
        })
        return f.remote
      },
    )

    expect(phases).toEqual(['loadRemote', 'apply'])
    expect(f.appendExportLog.mock.calls.map(call => call[1].status))
      .toEqual(['cancelled', 'success'])
    expect(f.appendExportLog.mock.calls[1][1].crosswalkFile).toBe('crosswalk-id')
    expect(f.recordKnownHash).toHaveBeenCalledWith(
      expect.anything(), 'file.txt', 123, 3, f.fileResult.md5)
    expect(f.persistUploadedFileHash).toHaveBeenCalled()
    expect(f.saveEntityIdMapping).toHaveBeenCalledTimes(3)
    expect(result).toEqual(expect.objectContaining({
      pid: f.plan.pid,
      changedFileCount: 1,
      addedFileCount: 0,
      removedFileCount: 0,
      mappingFileName: 'mapping.json',
    }))
  })

  it('leaves the cancelled recovery entry when the provider update fails', async () => {
    const f = fixture()

    await expect(f.service.updateArpWithProvider(
      f.repository,
      f.target,
      async input => {
        if (input.phase === 'loadRemote') return { remoteCrate: f.remoteCrate }
        throw new Error('Remote replacement failed')
      },
    )).rejects.toThrow('Remote replacement failed')

    expect(f.appendExportLog.mock.calls.map(call => call[1].status)).toEqual(['cancelled'])
  })
})

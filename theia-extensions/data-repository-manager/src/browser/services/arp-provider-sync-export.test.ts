// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import URI from '@theia/core/lib/common/uri'

import {
  ArpProviderSyncResult,
  ArpRoCrateExportService,
  PreparedArpSyncExport,
} from './arp-ro-crate-export-service'
import { ExportLogEntry } from './export-log'

jest.mock('@theia/workspace/lib/browser', () => ({ WorkspaceService: class WorkspaceService {} }))
jest.mock('app-state/lib/browser/state/app-state-service', () => ({ AppStateService: class AppStateService {} }))
jest.mock('save-ro-crate/lib/browser/ro-crate-persistence-service', () => ({
  RoCratePersistenceService: class RoCratePersistenceService {},
}))

function fixture() {
  const root = new URI('file:///workspace')
  const pid = 'hdl:21.15109/ARP/EXAMPLE'
  const remoteId = `https://w3id.org/arp/ro-id/${pid}/file/11`
  const localCrate = { '@graph': [
    { '@id': './', '@type': 'Dataset', name: 'Local' },
  ] }
  const remoteCrate = { '@graph': [
    { '@id': './', '@type': 'Dataset', name: 'Remote', hasPart: [{ '@id': remoteId }] },
    { '@id': remoteId, '@type': 'File', name: 'new.txt', hash: '900150983cd24fb0d6963f7d28e17f72' },
  ] }
  const exportLogEntry: ExportLogEntry = {
    target: `https://repo.example.org/dataset.xhtml?persistentId=${pid}`,
    repository: 'https://repo.example.org', mappingFile: 'mapping.json',
    crosswalkFile: 'crosswalk-id',
    syncType: 'update', status: 'success',
  }
  const plan: PreparedArpSyncExport = {
    pid,
    target: exportLogEntry.target,
    localCrate,
    remoteCrate,
    exportLogEntry,
    mappingFileName: 'mapping.json',
    initialMetadataMapping: { './': './' },
    metadataMapping: { './': './' },
    relocatedLocalIds: {},
    metadataMode: 'remote-additions',
    files: [{
      remoteId, remoteFileId: 11, localId: 'new.txt', localPath: 'new.txt',
      targetUri: 'file:///workspace/new.txt', targetParentUri: 'file:///workspace',
      md5: '900150983cd24fb0d6963f7d28e17f72', kind: 'new',
    }],
    keptLocalFileCount: 0,
    removedRemoteFileCount: 0,
  }
  const appendExportLog = jest.fn(async (
    _rootUri: URI, _entry: ExportLogEntry,
  ) => undefined)
  const saveEntityIdMapping = jest.fn(async (
    _rootUri: URI, _mappingFile: string, _mapping: Record<string, string>,
  ) => undefined)
  const writeFile = jest.fn(async () => undefined)
  const recordKnownHash = jest.fn(async () => true)
  const service = new ArpRoCrateExportService(
    {} as never,
    { resolve: async () => ({ isDirectory: false, mtime: 123, size: 3 }), writeFile } as never,
    {} as never,
    { recordKnownHash } as never,
    {} as never,
    {} as never,
  )
  Object.assign(service, {
    getWorkspaceRoot: () => root,
    prepareSyncExport: async () => plan,
    appendExportLog,
    saveEntityIdMapping,
  })
  const repository = {
    id: 'arp', title: 'ARP', baseUrl: 'https://repo.example.org',
    apiKey: 'secret', providerId: 'arp',
  }
  const target = {
    pid, target: plan.target, repository: repository.baseUrl,
    mappingFile: plan.mappingFileName, crosswalkFile: 'crosswalk-id', syncType: 'update' as const,
  }
  return {
    service, repository, target, plan, remoteCrate,
    appendExportLog, saveEntityIdMapping, writeFile, recordKnownHash,
  }
}

describe('ARP plugin sync completion', () => {
  it('loads remotely through the provider, checkpoints files, and merges metadata', async () => {
    const f = fixture()
    const phases: string[] = []

    const result = await f.service.syncArpWithProvider(
      f.repository, f.target, 'remote-additions', async input => {
        phases.push(input.phase as string)
        if (input.phase === 'loadRemote') return { remoteCrate: f.remoteCrate }
        await f.service.handleProviderSyncCheckpoint({
          operationId: input.operationId as string,
          providerId: 'arp', stage: 'fileDownloaded', pid: f.plan.pid,
          file: f.plan.files[0],
        })
        const response: ArpProviderSyncResult = {
          providerId: 'arp', pid: f.plan.pid, downloadedFiles: f.plan.files,
        }
        return response
      })

    expect(phases).toEqual(['loadRemote', 'apply'])
    expect(f.recordKnownHash).toHaveBeenCalledWith(
      expect.anything(), 'new.txt', 123, 3, f.plan.files[0].md5)
    expect(f.appendExportLog.mock.calls.map(call => call[1].status))
      .toEqual(['cancelled', 'success'])
    expect(f.appendExportLog.mock.calls[1][1].crosswalkFile).toBe('crosswalk-id')
    expect(f.saveEntityIdMapping).toHaveBeenCalledTimes(2)
    expect(f.saveEntityIdMapping.mock.calls[
      f.saveEntityIdMapping.mock.calls.length - 1
    ][2]).toEqual(
      expect.objectContaining({ 'new.txt': f.plan.files[0].remoteId }))
    expect(f.writeFile).toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({
      downloadedFileCount: 1, replacedFileCount: 0, mappingFileName: 'mapping.json',
    }))
  })

  it('leaves a cancelled recovery entry when the provider download fails', async () => {
    const f = fixture()

    await expect(f.service.syncArpWithProvider(
      f.repository, f.target, 'remote-additions', async input => {
        if (input.phase === 'loadRemote') return { remoteCrate: f.remoteCrate }
        throw new Error('Remote download failed')
      },
    )).rejects.toThrow('Remote download failed')

    expect(f.appendExportLog.mock.calls.map(call => call[1].status)).toEqual(['cancelled'])
  })
})

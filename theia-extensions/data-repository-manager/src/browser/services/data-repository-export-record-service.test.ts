// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import 'reflect-metadata'
import URI from '@theia/core/lib/common/uri'
import { DataRepositoryExportRecordService } from './data-repository-export-record-service'
import { normalizeExportLogEntries, serializeExportLogEntries } from './export-log'

jest.mock('@theia/workspace/lib/browser', () => ({ WorkspaceService: class WorkspaceService {} }))

const normalizers = [
  { normalizeExportLogEntries, serializeExportLogEntries },
  require('../../../../../repository-plugins/arp-repository-provider/src/export-log'),
  require('../../../../../repository-plugins/zenodo-repository-provider/src/export-log'),
]

function fixture() {
  const target = {
    pid: 'doi:example', target: 'https://repo.example/dataset/1',
    repository: 'https://repo.example/', mappingFile: 'mapping.json',
    syncType: 'create' as const,
  }
  const records = [{
    ...target, crosswalkFile: 'original', collectionId: 'collection', custom: { keep: true },
    log: [{ action: 'create', timestamp: '2026-11-04T12:00:00Z', crosswalkFile: 'original' }],
  }, {
    ...target, repository: 'https://other.example', crosswalkFile: 'unrelated',
    lastSuccessfulActionAt: '2026-11-04T12:00:00Z',
  }] as const
  let data = JSON.stringify(records)
  const writeFile = jest.fn(async (_uri, buffer, _options) => { data = buffer.toString() })
  const service = new DataRepositoryExportRecordService(
    { readFile: async () => ({ value: { toString: () => data }, etag: 'version', mtime: 123 }), writeFile } as never,
    { tryGetRoots: () => [{ resource: new URI('file:///workspace') }] } as never,
  )
  return { target, records, service, writeFile, saved: () => JSON.parse(data) }
}

describe('Export record editing', () => {
  it('changes only the crosswalk and retains legacy history and unrelated records', async () => {
    const f = fixture()
    await f.service.changeCrosswalk(f.target, 'replacement')
    expect(f.saved()).toEqual([{ ...f.records[0], crosswalkFile: 'replacement' }, f.records[1]])
    expect((await f.service.readExport(f.target)).crosswalkFile).toBe('replacement')
    expect(f.writeFile.mock.calls[0][2]).toEqual({ etag: 'version', mtime: 123 })
    for (const normalizer of normalizers) {
      expect(normalizer.normalizeExportLogEntries(f.saved())[0].crosswalkFile).toBe('replacement')
    }
  })

  it('keeps No crosswalk after normalization and serialization by each provider', async () => {
    const f = fixture()
    await f.service.changeCrosswalk(f.target)
    expect(f.saved()[0].crosswalkFile).toBeNull()
    expect(f.saved()[0].log).toEqual(f.records[0].log)
    for (const normalizer of normalizers) {
      const entries = normalizer.normalizeExportLogEntries(f.saved())
      expect(entries[0].crosswalkFile).toBeUndefined()
      const persisted = JSON.parse(JSON.stringify(normalizer.serializeExportLogEntries(entries)))
      expect(normalizer.normalizeExportLogEntries(persisted)[0].crosswalkFile).toBeUndefined()
    }
  })

  it('rejects a removed export without writing the log', async () => {
    const f = fixture()
    await expect(f.service.changeCrosswalk({ ...f.target, mappingFile: 'removed.json' }, 'chosen'))
      .rejects.toThrow('This export record no longer exists.')
    expect(f.writeFile).not.toHaveBeenCalled()
  })
})

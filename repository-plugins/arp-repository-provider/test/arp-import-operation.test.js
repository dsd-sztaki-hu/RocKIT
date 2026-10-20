// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { ArpImportOperation, ARCHIVE_NAME } = require('../src/arp-import-operation')

function fixture(overrides = {}) {
  const calls = []
  const existing = new Set(overrides.existing || [])
  const vscode = {
    Uri: {
      parse: value => value,
      joinPath: (base, ...parts) => `${String(base).replace(/\/$/, '')}/${parts.join('/')}`,
    },
    window: { showOpenDialog: async () => ['file:///imports'] },
    workspace: { fs: {
      stat: async uri => {
        if (!existing.has(uri)) throw new Error('Not found')
        return { type: 2 }
      },
      createDirectory: async uri => { calls.push(['mkdir', uri]); existing.add(uri) },
      writeFile: async (uri, bytes) => calls.push(['write', uri, bytes]),
    } },
  }
  const bytes = Uint8Array.from([80, 75, 3, 4])
  const client = {
    downloadRoCrateZip: async pid => {
      calls.push(['download', pid])
      return { ok: true, status: 200, bytes }
    },
    ...overrides.client,
  }
  return {
    operation: new ArpImportOperation({ vscode, clientFactory: () => client }),
    calls,
    bytes,
  }
}

describe('ARP import operation', () => {
  it('downloads the selected dataset archive into a unique import workspace', async () => {
    const f = fixture()
    const result = await f.operation.execute({
      repository: { baseUrl: 'https://repo.researchdata.hu', apiKey: 'secret' },
      recordUrl: 'https://repo.researchdata.hu/dataset.xhtml?persistentId=hdl:21.15109/ARP/VYBLPE',
      targetParentUri: 'file:///imports',
    })

    assert.equal(result.datasetPid, 'hdl:21.15109/ARP/VYBLPE')
    assert.equal(result.importedWorkspaceUri, 'file:///imports/VYBLPE')
    assert.equal(result.archiveUri, `file:///imports/VYBLPE/${ARCHIVE_NAME}`)
    assert.equal(result.landingPage,
      'https://repo.researchdata.hu/dataset.xhtml?persistentId=hdl:21.15109/ARP/VYBLPE')
    assert.deepEqual(f.calls, [
      ['download', 'hdl:21.15109/ARP/VYBLPE'],
      ['mkdir', 'file:///imports/VYBLPE'],
      ['write', `file:///imports/VYBLPE/${ARCHIVE_NAME}`, f.bytes],
    ])
  })

  it('uses a suffix instead of overwriting an existing import workspace', async () => {
    const f = fixture({ existing: ['file:///imports/example'] })

    const result = await f.operation.execute({
      repository: { baseUrl: 'https://repo.example.org' },
      recordUrl: 'doi:10.1/example', targetParentUri: 'file:///imports',
    })

    assert.equal(result.importedWorkspaceUri, 'file:///imports/example-2')
  })

  it('does not create local state when the ZIP download fails', async () => {
    const f = fixture({ client: {
      downloadRoCrateZip: async () => ({
        ok: false, status: 403, url: 'https://repo.example.org/archive',
        payload: { status: 'ERROR', message: 'Forbidden' },
      }),
    } })

    await assert.rejects(f.operation.execute({
      repository: { baseUrl: 'https://repo.example.org' },
      recordUrl: 'doi:10.1/example', targetParentUri: 'file:///imports',
    }), /ZIP download.*failed \(403\).*Forbidden/)
    assert.deepEqual(f.calls, [])
  })
})

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { DataverseImportOperation, ARCHIVE_NAME } = require('../src/dataverse-import-operation')

function fixture(overrides = {}) {
  const calls = []
  const existing = new Set(overrides.existing || [])
  const bytes = Uint8Array.from([80, 75, 3, 4])
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
      writeFile: async (uri, value) => calls.push(['write', uri, value]),
    } },
    commands: { executeCommand: async () => undefined },
  }
  const client = {
    getDatasetVersion: async (pid, version) => {
      calls.push(['version', pid, version])
      return { ok: true, status: 200, payload: {
        status: 'OK', data: { metadataBlocks: { citation: {} }, files: [] },
      } }
    },
    downloadDatasetZip: async pid => {
      calls.push(['download', pid])
      return { ok: true, status: 200, bytes }
    },
    ...overrides.client,
  }
  return {
    operation: new DataverseImportOperation({ vscode, clientFactory: () => client }),
    calls,
    bytes,
  }
}

describe('Dataverse import operation', () => {
  it('downloads the archive and returns repository metadata to RocKIT', async () => {
    const f = fixture()
    const result = await f.operation.execute({
      repository: { baseUrl: 'https://demo.dataverse.org', apiKey: 'secret' },
      recordUrl: 'https://demo.dataverse.org/dataset.xhtml?persistentId=doi:10.1/example',
      targetParentUri: 'file:///imports',
    })

    assert.equal(result.persistentId, 'doi:10.1/example')
    assert.equal(result.importedWorkspaceUri, 'file:///imports/example')
    assert.equal(result.archiveUri, `file:///imports/example/${ARCHIVE_NAME}`)
    assert.deepEqual(result.datasetVersionData,
      { metadataBlocks: { citation: {} }, files: [] })
    assert.deepEqual(f.calls, [
      ['version', 'doi:10.1/example', ':draft'],
      ['download', 'doi:10.1/example'],
      ['mkdir', 'file:///imports/example'],
      ['write', `file:///imports/example/${ARCHIVE_NAME}`, f.bytes],
    ])
  })

  it('falls back to the latest version when no draft is available', async () => {
    const f = fixture({ client: {
      getDatasetVersion: async (pid, version) => {
        f.calls.push(['version', pid, version])
        return version === ':draft'
          ? { ok: false, status: 404, payload: { status: 'ERROR' } }
          : { ok: true, status: 200, payload: { status: 'OK', data: { files: [] } } }
      },
    } })

    await f.operation.execute({
      repository: { baseUrl: 'https://demo.dataverse.org' },
      recordUrl: 'doi:10.1/example', targetParentUri: 'file:///imports',
    })

    assert.deepEqual(f.calls.slice(0, 2), [
      ['version', 'doi:10.1/example', ':draft'],
      ['version', 'doi:10.1/example', ':latest'],
    ])
  })
})

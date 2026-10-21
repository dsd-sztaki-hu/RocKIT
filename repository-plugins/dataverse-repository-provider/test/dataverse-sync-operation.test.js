// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const {
  CHECKPOINT_COMMAND,
  DataverseSyncOperation,
} = require('../src/dataverse-sync-operation')

describe('Dataverse sync operation', () => {
  it('downloads planned files and checkpoints each completed write', async () => {
    const writes = []
    const checkpoints = []
    const vscode = {
      Uri: { parse: (value) => value },
      workspace: {
        fs: {
          createDirectory: async (uri) => writes.push(['directory', uri]),
          writeFile: async (uri, bytes) => writes.push(['file', uri, [...bytes]]),
        },
      },
      commands: {
        executeCommand: async (command, value) => {
          assert.equal(command, CHECKPOINT_COMMAND)
          checkpoints.push(value)
        },
      },
    }
    const operation = new DataverseSyncOperation({
      vscode,
      clientFactory: () => ({
        downloadFile: async (id) => {
          assert.equal(id, '51')
          return { ok: true, status: 200, bytes: Uint8Array.from([1, 2]) }
        },
      }),
    })
    const file = {
      remoteId: '51',
      localId: 'data/file.txt',
      localPath: 'data/file.txt',
      targetUri: 'file:///workspace/data/file.txt',
      targetParentUri: 'file:///workspace/data',
      checksum: 'abc',
      kind: 'new',
    }

    const result = await operation.execute({
      phase: 'download',
      repository: { baseUrl: 'https://dv.example' },
      persistentId: 'doi:10.1/example',
      operationId: 'operation-1',
      plan: { persistentId: 'doi:10.1/example', files: [file] },
    })

    assert.deepEqual(writes, [
      ['directory', 'file:///workspace/data'],
      ['file', 'file:///workspace/data/file.txt', [1, 2]],
    ])
    assert.equal(checkpoints[0].stage, 'fileDownloaded')
    assert.deepEqual(result.downloadedFiles, [file])
  })
})

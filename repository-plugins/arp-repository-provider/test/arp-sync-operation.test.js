// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')

const { ArpSyncOperation, CHECKPOINT_COMMAND } = require('../src/arp-sync-operation')

function fixture(overrides = {}) {
  const calls = []
  const checkpoints = []
  const client = {
    downloadFile: async id => {
      calls.push(['download', id])
      return { ok: true, status: 200, bytes: Uint8Array.from([Number(id)]) }
    },
    ...overrides,
  }
  const vscode = {
    Uri: { parse: value => value },
    workspace: { fs: {
      createDirectory: async uri => calls.push(['mkdir', uri]),
      writeFile: async (uri, bytes) => calls.push(['write', uri, bytes]),
    } },
    commands: { executeCommand: async (command, value) => {
      assert.equal(command, CHECKPOINT_COMMAND)
      checkpoints.push(value)
    } },
  }
  const plan = {
    pid: 'hdl:21.15109/ARP/EXAMPLE',
    files: [{
      remoteId: 'https://w3id.org/arp/ro-id/hdl:21.15109/ARP/EXAMPLE/file/11',
      remoteFileId: 11,
      localId: 'folder/new.txt',
      localPath: 'folder/new.txt',
      targetUri: 'file:///workspace/folder/new.txt',
      targetParentUri: 'file:///workspace/folder',
      md5: '900150983cd24fb0d6963f7d28e17f72',
      kind: 'new',
    }, {
      remoteId: 'https://w3id.org/arp/ro-id/hdl:21.15109/ARP/EXAMPLE/file/12',
      remoteFileId: 12,
      localId: 'changed.txt',
      localPath: 'changed.txt',
      targetUri: 'file:///workspace/changed.txt',
      targetParentUri: 'file:///workspace',
      kind: 'changed',
    }],
  }
  return {
    operation: new ArpSyncOperation({ vscode, clientFactory: () => client }),
    calls, checkpoints,
    input: {
      repository: { baseUrl: 'https://repo.example.org', apiKey: 'secret' },
      operationId: 'sync-1', plan,
    },
  }
}

describe('ARP sync operation', () => {
  it('loads the remote crate through the provider before RocKIT prepares the sync', async () => {
    const remoteCrate = { '@graph': [{ '@id': './' }] }
    const operation = new ArpSyncOperation({
      vscode: {},
      clientFactory: () => ({
        getRoCrate: async () => ({
          ok: true, status: 200, payload: { data: { roCrate: remoteCrate } },
        }),
      }),
    })

    const result = await operation.execute({
      phase: 'loadRemote', repository: { baseUrl: 'https://repo.example.org' },
      pid: 'hdl:21.15109/ARP/EXAMPLE',
    })

    assert.deepEqual(result, {
      providerId: 'arp', pid: 'hdl:21.15109/ARP/EXAMPLE', remoteCrate,
    })
  })

  it('downloads planned files and checkpoints each completed local write', async () => {
    const f = fixture()

    const result = await f.operation.execute(f.input)

    assert.deepEqual(f.calls.map(call => call[0]), [
      'download', 'mkdir', 'write', 'download', 'mkdir', 'write',
    ])
    assert.deepEqual(f.checkpoints.map(checkpoint => checkpoint.file.kind), ['new', 'changed'])
    assert.equal(result.downloadedFiles.length, 2)
  })

  it('stops before writing or checkpointing a failed download', async () => {
    const f = fixture({
      downloadFile: async () => ({
        ok: false, status: 403, url: 'https://repo.example.org/file/11',
        payload: { status: 'ERROR', message: 'Forbidden' },
      }),
    })

    await assert.rejects(f.operation.execute(f.input), /download.*failed \(403\).*Forbidden/)
    assert.deepEqual(f.calls, [])
    assert.deepEqual(f.checkpoints, [])
  })
})

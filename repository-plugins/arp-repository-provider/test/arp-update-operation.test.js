// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { ArpUpdateOperation, CHECKPOINT_COMMAND } = require('../src/arp-update-operation')

const md5Added = '900150983cd24fb0d6963f7d28e17f72'
const md5Changed = 'd16fb36f0911f878998c136191af705e'

function fixture(overrides = {}) {
  const calls = []
  const checkpoints = []
  const client = {
    uploadFile: async (pid, path, content) => {
      calls.push(['upload', pid, path, content])
      return { ok: true, status: 200,
        payload: { data: { files: [{ dataFile: { id: 201, md5: md5Added } }] } } }
    },
    replaceFile: async (id, path, description, content) => {
      calls.push(['replace', id, path, description, content])
      return { ok: true, status: 200,
        payload: { data: { files: [{ dataFile: { id: 202, md5: md5Changed } }] } } }
    },
    deleteFile: async id => {
      calls.push(['delete', id])
      return { ok: true, status: 200, payload: { status: 'OK' } }
    },
    updateRoCrate: async (pid, crate) => {
      calls.push(['metadata', pid, crate])
      return { ok: true, status: 200, payload: { data: { roCrate: crate } } }
    },
    ...overrides,
  }
  const vscode = {
    Uri: { parse: value => value },
    workspace: { fs: { readFile: async uri => {
      calls.push(['read', uri])
      return Uint8Array.from([1, 2, 3])
    } } },
    commands: { executeCommand: async (command, value) => {
      assert.equal(command, CHECKPOINT_COMMAND)
      checkpoints.push(value)
    } },
  }
  const operation = new ArpUpdateOperation({ vscode, clientFactory: () => client })
  const oldAddedRemote = 'https://w3id.org/arp/ro-id/doi:10.1/example/file/100'
  const oldChangedRemote = 'https://w3id.org/arp/ro-id/doi:10.1/example/file/101'
  const removedRemote = 'https://w3id.org/arp/ro-id/doi:10.1/example/file/102'
  const plan = {
    pid: 'doi:10.1/example',
    remoteCrate: { '@graph': [
      { '@id': './', '@type': 'Dataset' },
      { '@id': oldChangedRemote, '@type': 'File' },
      { '@id': removedRemote, '@type': 'File' },
    ] },
    uploadCrate: { '@graph': [
      { '@id': './', '@type': 'Dataset', hasPart: [
        { '@id': 'new.txt' }, { '@id': 'changed.txt' },
      ] },
      { '@id': 'new.txt', '@type': 'File' },
      { '@id': 'changed.txt', '@type': 'File', description: 'Updated file' },
    ] },
    uploadIdMapping: {
      './': './',
      'new.txt': oldAddedRemote,
      'changed.txt': oldChangedRemote,
      'removed.txt': removedRemote,
    },
    addedFiles: [{
      metadataEntityId: 'new.txt', uploadEntityId: 'new.txt', entryPath: 'new.txt',
      sourceUri: 'file:///workspace/new.txt', lastModified: 10, sourceSize: 3,
    }],
    changedFiles: [{
      metadataEntityId: 'changed.txt', uploadEntityId: 'changed.txt',
      entryPath: 'changed.txt', sourceUri: 'file:///workspace/changed.txt',
      remoteId: oldChangedRemote, remoteFileId: 101, description: 'Updated file',
      lastModified: 11, sourceSize: 3,
    }],
    removedFiles: [{ remoteId: removedRemote, remoteFileId: 102 }],
  }
  return { operation, calls, checkpoints, input: {
    repository: { baseUrl: 'https://repo.example.org', apiKey: 'secret' },
    operationId: 'update-1', plan,
  }, removedRemote }
}

describe('ARP update operation', () => {
  it('loads the remote crate through the provider before RocKIT prepares the diff', async () => {
    const remoteCrate = { '@graph': [{ '@id': './' }] }
    const operation = new ArpUpdateOperation({
      vscode: {},
      clientFactory: () => ({
        getRoCrate: async pid => {
          assert.equal(pid, 'doi:10.1/example')
          return { ok: true, status: 200, payload: { data: { roCrate: remoteCrate } } }
        },
      }),
    })

    const result = await operation.execute({
      phase: 'loadRemote',
      repository: { baseUrl: 'https://repo.example.org' },
      pid: 'doi:10.1/example',
    })

    assert.deepEqual(result, { providerId: 'arp', pid: 'doi:10.1/example', remoteCrate })
  })

  it('adds, replaces, removes, and posts rewritten RO-Crate metadata', async () => {
    const { operation, input, calls, checkpoints, removedRemote } = fixture()

    const result = await operation.execute(input)

    assert.deepEqual(calls.map(call => call[0]), [
      'read', 'upload', 'read', 'replace', 'delete', 'metadata',
    ])
    assert.deepEqual(checkpoints.map(item => item.stage), [
      'fileUploaded', 'fileReplaced', 'fileRemoved',
    ])
    assert.equal(checkpoints[2].remoteId, removedRemote)
    const newRemote = 'https://w3id.org/arp/ro-id/doi:10.1/example/file/201'
    const changedRemote = 'https://w3id.org/arp/ro-id/doi:10.1/example/file/202'
    assert.equal(result.uploadIdMapping['new.txt'], newRemote)
    assert.equal(result.uploadIdMapping['changed.txt'], changedRemote)
    assert.equal(result.uploadIdMapping['removed.txt'], undefined)
    assert.equal(result.uploadCrate['@graph'][1].hash, md5Added)
    assert.equal(result.uploadCrate['@graph'][2].hash, md5Changed)
    const posted = calls.at(-1)[2]
    assert.deepEqual(posted['@graph'][0].hasPart, [
      { '@id': newRemote }, { '@id': changedRemote },
    ])
    assert.equal(input.plan.uploadCrate['@graph'][1].hash, undefined)
  })

  it('preserves a remote ARP file ID prefix when the local mapping has no file entry', async () => {
    const { operation, input } = fixture()
    input.plan.uploadIdMapping = { './': './' }
    input.plan.remoteCrate = { '@graph': [{
      '@id': 'https://custom.example/arp/dataset/file/99', '@type': 'File',
    }] }
    input.plan.changedFiles = []
    input.plan.removedFiles = []

    const result = await operation.execute(input)

    assert.equal(
      result.uploadIdMapping['new.txt'],
      'https://custom.example/arp/dataset/file/201',
    )
  })

  it('stops immediately when a remote file operation fails', async () => {
    const { operation, input, calls, checkpoints } = fixture({
      uploadFile: async () => {
        calls.push(['upload'])
        return { ok: false, status: 403, url: 'https://repo.example.org/api/upload',
          payload: { status: 'ERROR', message: 'Forbidden' } }
      },
    })

    await assert.rejects(operation.execute(input), /Dataverse upload.*failed \(403\).*Forbidden/)
    assert.deepEqual(calls.map(call => call[0]), ['read', 'upload'])
    assert.deepEqual(checkpoints, [])
  })

  it('requires the final metadata response to contain a stored crate', async () => {
    const { operation, input } = fixture({
      updateRoCrate: async () => ({ ok: true, status: 200, payload: { status: 'OK' } }),
    })

    await assert.rejects(operation.execute(input), /did not return the stored RO-Crate/)
  })
})

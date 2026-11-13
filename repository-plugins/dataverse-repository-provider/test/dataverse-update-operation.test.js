// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')

const {
  CHECKPOINT_COMMAND,
  DataverseUpdateOperation,
} = require('../src/dataverse-update-operation')

const ok = (payload) => ({
  ok: true,
  status: 200,
  url: 'https://dv.example/api',
  payload,
})

function fixture(client) {
  const checkpoints = []
  const vscode = {
    Uri: { parse: (value) => value },
    workspace: {
      fs: { readFile: async () => Uint8Array.from([1, 2, 3]) },
    },
    commands: {
      executeCommand: async (command, value) => {
        assert.equal(command, CHECKPOINT_COMMAND)
        checkpoints.push(value)
      },
    },
  }
  return {
    checkpoints,
    operation: new DataverseUpdateOperation({ vscode, clientFactory: () => client }),
  }
}

describe('Dataverse update operation', () => {
  it('inspects the remote draft and downloads its RO-Crate metadata', async () => {
    const client = {
      getDatasetVersion: async () =>
        ok({
          status: 'OK',
          data: {
            metadataBlocks: { citation: {} },
            files: [{ dataFile: { id: 9, filename: 'ro-crate-metadata.json' } }],
          },
        }),
      downloadJsonFile: async (id) => {
        assert.equal(id, '9')
        return ok({ '@graph': [{ '@id': './', '@type': 'Dataset' }] })
      },
    }
    const { operation } = fixture(client)

    const result = await operation.execute({
      phase: 'inspect',
      repository: { baseUrl: 'https://dv.example' },
      persistentId: 'doi:10.1/example',
    })

    assert.equal(result.metadataFileId, '9')
    assert.equal(result.draftFiles[0].label, 'ro-crate-metadata.json')
    assert.equal(result.remoteMetadataCrate['@graph'][0]['@id'], './')
  })

  it('applies the prepared file and metadata update with incremental checkpoints', async () => {
    const calls = []
    const client = {
      uploadFile: async (_pid, path) => {
        calls.push(['upload', path])
        return ok({ data: { files: [{ dataFile: { id: 101, md5: 'aaa' } }] } })
      },
      replaceFile: async (id, path, content) => {
        calls.push(['replace', id, path])
        if (path === 'ro-crate-metadata.json') {
          const crate = JSON.parse(new TextDecoder().decode(content))
          assert.equal(crate['@graph'][1]['@id'], '101')
          return ok({ data: { files: [{ dataFile: { id: 104 } }] } })
        }
        return ok({ data: { files: [{ dataFile: { id: 102, md5: 'bbb' } }] } })
      },
      deleteFile: async (id) => {
        calls.push(['delete', id])
        return ok({ status: 'OK' })
      },
      updateDraftMetadata: async (_pid, payload) => {
        calls.push(['metadata', payload])
        return ok({ status: 'OK' })
      },
      updateDatasetLicense: async (datasetId, payload) => {
        calls.push(['license', datasetId, payload])
        return ok({ status: 'OK' })
      },
    }
    const { operation, checkpoints } = fixture(client)
    const result = await operation.execute({
      phase: 'apply',
      repository: { baseUrl: 'https://dv.example' },
      persistentId: 'doi:10.1/example',
      operationId: 'operation-1',
      plan: {
        persistentId: 'doi:10.1/example',
        metadataCrate: {
          '@graph': [
            { '@id': './', '@type': 'Dataset', hasPart: { '@id': 'new.txt' } },
            { '@id': 'new.txt', '@type': 'File' },
          ],
        },
        mapping: { 'changed.txt': '12', 'removed.txt': '13' },
        originalToUploadIds: {},
        addedFiles: [
          {
            localFileId: 'new.txt',
            entryPath: 'new.txt',
            sourceUri: 'file:///new.txt',
          },
        ],
        changedFiles: [
          {
            localFileId: 'changed.txt',
            entryPath: 'changed.txt',
            sourceUri: 'file:///changed.txt',
            remoteFileId: '12',
            remoteChecksum: { type: 'MD5', value: createHash('md5').update('old content').digest('hex') },
          },
        ],
        removedFiles: [{ remoteFileId: '13' }],
        metadataFileId: '14',
        nativeMetadataPayload: { metadataBlocks: { citation: {} } },
        datasetId: 24,
        nativeLicensePayload: { name: 'CC0 1.0' },
      },
    })

    assert.deepEqual(
      calls.map((call) => call[0]),
      ['upload', 'replace', 'delete', 'replace', 'metadata', 'license'],
    )
    assert.deepEqual(calls.at(-1), ['license', '24', { name: 'CC0 1.0' }])
    assert.deepEqual(
      checkpoints.map((item) => item.stage),
      ['fileUploaded', 'fileReplaced', 'fileRemoved', 'metadataReplaced'],
    )
    assert.equal(result.metadataRemoteId, '104')
    assert.deepEqual(result.removedRemoteFileIds, ['13'])
  })

  it.each([
    { type: 'SHA-1', value: createHash('sha1').update(Uint8Array.from([1, 2, 3])).digest('hex') },
    undefined,
  ])('keeps identical files on a metadata-only update with checksum %p', async (remoteChecksum) => {
    const client = {
      downloadFile: jest.fn(async () => ({ ...ok({}), bytes: Uint8Array.from([1, 2, 3]) })),
      replaceFile: jest.fn(async () => ok({})),
      updateDraftMetadata: jest.fn(async () => ok({})),
    }
    const { operation, checkpoints } = fixture(client)
    const metadataCrate = {
      '@graph': [
        { '@id': './', '@type': 'Dataset', hasPart: { '@id': 'nested/file.txt' } },
        { '@id': 'nested/file.txt', '@type': 'File' },
      ],
    }
    const result = await operation.execute({
      phase: 'apply',
      repository: { baseUrl: 'https://dv.example' },
      persistentId: 'doi:10.1/example',
      operationId: 'operation-1',
      plan: {
        metadataCrate,
        remoteMetadataCrate: {
          '@graph': [
            { '@id': './', '@type': 'Dataset', hasPart: { '@id': '12' } },
            { '@id': '12', '@type': 'File' },
          ],
        },
        mapping: { 'nested/file.txt': '12' },
        addedFiles: [],
        changedFiles: [{
          localFileId: 'nested/file.txt',
          entryPath: 'nested/file.txt',
          sourceUri: 'file:///nested/file.txt',
          remoteFileId: '12',
          remoteChecksum,
        }],
        removedFiles: [],
        metadataFileId: '14',
        nativeMetadataPayload: { metadataBlocks: { citation: {} } },
      },
    })
    expect(client.replaceFile).not.toHaveBeenCalled()
    expect(client.updateDraftMetadata).toHaveBeenCalledTimes(1)
    if (remoteChecksum) expect(client.downloadFile).not.toHaveBeenCalled()
    else expect(client.downloadFile).toHaveBeenCalledWith('12', { original: true })
    expect(result.fileResults).toEqual([])
    expect(result.metadataRemoteId).toBe('14')
    expect(checkpoints.map(item => item.stage)).toEqual(['metadataReplaced'])
  })
})

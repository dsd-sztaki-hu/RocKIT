// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')

const { ArpCreateOperation, CHECKPOINT_COMMAND } = require('../src/arp-create-operation')

const md5 = '900150983cd24fb0d6963f7d28e17f72'

function fixture(overrides = {}) {
  const calls = []
  const checkpoints = []
  const client = {
    validateRoCrate: async crate => {
      calls.push(['validate', crate])
      return { ok: true, status: 200, payload: { status: 'OK' } }
    },
    createDataset: async (collectionId, payload) => {
      calls.push(['create', collectionId, payload])
      return { ok: true, status: 201, payload: { status: 'OK', data: { persistentId: 'doi:10.1/example' } } }
    },
    uploadFile: async (pid, path, content) => {
      calls.push(['upload', pid, path, content])
      return { ok: true, status: 200, payload: { data: { files: [{ dataFile: { id: 123, md5 } }] } } }
    },
    updateRoCrate: async (pid, crate) => {
      calls.push(['update', pid, crate])
      return { ok: true, status: 200, payload: { data: { roCrate: { '@graph': [{ '@id': './' }] } } } }
    },
    ...overrides,
  }
  const vscode = {
    Uri: { parse: source => source },
    commands: { executeCommand: async (command, value) => {
      assert.equal(command, CHECKPOINT_COMMAND)
      checkpoints.push(value)
    } },
    workspace: { fs: { readFile: async uri => {
      calls.push(['readFile', uri])
      return Uint8Array.from([65, 66, 67])
    } } },
  }
  const operation = new ArpCreateOperation({ vscode, clientFactory: () => client })
  const repository = { baseUrl: 'https://repo.example.org', apiKey: 'secret' }
  const plan = {
    uploadCrate: {
      '@graph': [
        { '@id': './', '@type': 'Dataset', hasPart: [{ '@id': 'data/file.txt' }] },
        { '@id': 'data/file.txt', '@type': 'File' },
      ],
    },
    fileSources: [{
      entityId: 'data/file.txt', entryPath: 'data/file.txt',
      sourceUri: 'file:///workspace/data/file.txt', lastModified: 123, sourceSize: 3,
    }],
    originalToUploadIds: {},
  }
  return { operation, calls, input: {
    repository, collectionId: 'my-collection',
    datasetCreationPayload: { metadataLanguage: 'en', datasetVersion: {} }, plan,
    operationId: 'operation-1',
  }, checkpoints }
}

describe('ARP create operation', () => {
  it('validates, creates, uploads files, and posts rewritten metadata in one operation', async () => {
    const { operation, input, calls, checkpoints } = fixture()

    const result = await operation.execute(input)

    assert.deepEqual(calls.map(call => call[0]), [
      'validate', 'create', 'readFile', 'upload', 'update',
    ])
    assert.equal(calls[1][1], 'my-collection')
    assert.equal(calls[2][1], 'file:///workspace/data/file.txt')
    assert.deepEqual(calls[3][3], Uint8Array.from([65, 66, 67]))
    const remoteId = 'https://w3id.org/arp/ro-id/doi:10.1/example/file/123'
    assert.equal(calls[4][2]['@graph'][0].hasPart[0]['@id'], remoteId)
    assert.equal(calls[4][2]['@graph'][1]['@id'], remoteId)
    assert.equal(calls[4][2]['@graph'][1].hash, md5)
    assert.equal(result.pid, 'doi:10.1/example')
    assert.equal(result.uploadIdMapping['data/file.txt'], remoteId)
    assert.deepEqual(result.fileResults, [{
      entityId: 'data/file.txt', entryPath: 'data/file.txt', remoteId, md5,
      lastModified: 123, sourceSize: 3,
    }])
    assert.equal(input.plan.uploadCrate['@graph'][1].hash, undefined)
    assert.deepEqual(checkpoints.map(checkpoint => checkpoint.stage), [
      'datasetCreated', 'fileUploaded',
    ])
    assert.equal(checkpoints[1].fileResult.remoteId, remoteId)
  })

  it('stops before dataset creation when ARP rejects the crate', async () => {
    const { operation, input, calls } = fixture({
      validateRoCrate: async () => {
        calls.push(['validate'])
        return { ok: false, status: 400, url: 'https://repo.example.org/api/arp/validateRoCrate',
          payload: { message: 'Invalid crate' } }
      },
    })

    await assert.rejects(operation.execute(input), /ARP RO-Crate validation failed \(400\)/)
    assert.deepEqual(calls.map(call => call[0]), ['validate'])
  })

  it('rejects validation errors embedded in a successful HTTP response', async () => {
    const { operation, input, calls } = fixture({
      validateRoCrate: async () => {
        calls.push(['validate'])
        return { ok: true, status: 200, payload: {
          details: JSON.stringify({ errors: [{ errorEntity: './', errors: [
            { errorField: 'name', errorMessage: 'Name is required' },
          ] }] }),
        } }
      },
    })

    const result = await operation.execute(input)
    assert.equal(result.validationFailure.status, 200)
    assert.equal(result.validationFailure.validationErrors[0].errors[0].errorMessage, 'Name is required')
    assert.deepEqual(calls.map(call => call[0]), ['validate'])
  })

  it('does not upload files when dataset creation omits the PID', async () => {
    const { operation, input, calls } = fixture({
      createDataset: async () => {
        calls.push(['create'])
        return { ok: true, status: 201, payload: { status: 'OK', data: {} } }
      },
    })

    await assert.rejects(operation.execute(input), /did not return its persistent ID/)
    assert.deepEqual(calls.map(call => call[0]), ['validate', 'create'])
  })

  it('requires ARP to return a stored RO-Crate after the metadata update', async () => {
    const { operation, input } = fixture({
      updateRoCrate: async () => ({ ok: true, status: 200, payload: { status: 'OK' } }),
    })

    const result = await operation.execute(input)
    assert.equal(result.interrupted, true)
    assert.match(result.errorMessage, /did not return the stored RO-Crate @graph/)
    assert.equal(result.pid, 'doi:10.1/example')
    assert.equal(result.fileResults.length, 1)
  })
})

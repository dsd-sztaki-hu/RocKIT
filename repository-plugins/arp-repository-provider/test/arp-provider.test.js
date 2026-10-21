// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const {
  activateArpProvider,
  deactivateArpProvider,
  VALIDATE_COMMAND,
  CREATE_COMMAND,
  DELETE_COMMAND,
  IMPORT_COMMAND,
  LINK_COMMAND,
  SYNC_COMMAND,
  UPDATE_COMMAND,
  METADATA_LANGUAGES_COMMAND,
} = require('../src/arp-provider')

describe('ARP provider command boundary', () => {
  it('registers create, update, import, sync, delete, link, language lookup, and validation commands', async () => {
    const commands = new Map()
    const executions = []
    const vscode = {
      ProgressLocation: { Notification: 15 },
      Uri: { parse: value => value },
      workspace: { fs: { readFile: async () => Uint8Array.from([1]) } },
      window: { withProgress: async (_options, task) =>
        task({ report() {} }) },
      commands: {
        registerCommand: (id, handler) => {
          commands.set(id, handler)
          return { dispose() { commands.delete(id) } }
        },
        executeCommand: async (...args) => { executions.push(args) },
      },
    }
    const context = { extension: { id: 'rockit.arp-repository-provider' }, subscriptions: [] }
    const repository = { baseUrl: 'https://repo.example.org', apiKey: 'secret' }
    const calls = []

    await activateArpProvider(vscode, context, received => {
      assert.equal(received, repository)
      return {
        supportsRoCrateUpload: async () => { calls.push('probe'); return true },
        validateToken: async () => { calls.push('token') },
        getAllowedMetadataLanguages: async id => {
          calls.push(`languages:${id}`)
          return { ok: true, payload: { data: ['en'] } }
        },
        deleteDraft: async pid => {
          calls.push(`delete:${pid}`)
          return { ok: true, status: 200, payload: { status: 'OK' } }
        },
        updateRoCrate: async (_pid, crate) => ({
          ok: true, status: 200, payload: { data: { roCrate: crate } },
        }),
      }
    })

    assert.deepEqual(executions[0], ['rockit.repositories.registerProvider', {
      id: 'arp',
      displayName: 'ARP',
      extensionId: 'rockit.arp-repository-provider',
      protocolVersion: '1.0',
      operations: {
        validate: VALIDATE_COMMAND,
        create: CREATE_COMMAND,
        delete: DELETE_COMMAND,
        import: IMPORT_COMMAND,
        link: LINK_COMMAND,
        sync: SYNC_COMMAND,
        update: UPDATE_COMMAND,
        metadataLanguages: METADATA_LANGUAGES_COMMAND,
      },
      importInput: {
        kind: 'url',
        title: 'Import ARP Dataset',
        description: 'Enter an ARP dataset persistent ID or dataset URL to import.',
        placeholder: 'https://repo.researchdata.hu/dataset.xhtml?persistentId=hdl:...',
        fieldLabel: 'Dataset PID or URL',
      },
      connection: { requiresApiKey: true },
    }])
    assert.deepEqual(await commands.get(VALIDATE_COMMAND)({ repository }), { valid: true })
    assert.deepEqual(await commands.get(METADATA_LANGUAGES_COMMAND)({ repository, collectionId: 'root' }),
      { data: ['en'] })
    assert.deepEqual(await commands.get(DELETE_COMMAND)({
      repository, exportTarget: { pid: 'doi:10.1/example' },
    }), { providerId: 'arp', remoteId: 'doi:10.1/example', deleted: true })
    const updated = await commands.get(UPDATE_COMMAND)({
      repository,
      operationId: 'update-1',
      plan: {
        pid: 'doi:10.1/example', uploadCrate: { '@graph': [{ '@id': './' }] },
        remoteCrate: { '@graph': [{ '@id': './' }] },
        uploadIdMapping: { './': './' }, addedFiles: [], changedFiles: [], removedFiles: [],
      },
    })
    assert.equal(updated.pid, 'doi:10.1/example')
    assert.deepEqual(calls, ['probe', 'token', 'languages:root', 'delete:doi:10.1/example'])

    await deactivateArpProvider(vscode)
    assert.deepEqual(executions[1], [
      'rockit.repositories.unregisterProvider', 'arp', 'rockit.arp-repository-provider',
    ])
  })
})

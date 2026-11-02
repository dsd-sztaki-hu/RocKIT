// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')

const {
  activateDataverseProvider,
  deactivateDataverseProvider,
  CREATE_COMMAND,
  DELETE_COMMAND,
  IMPORT_COMMAND,
  LINK_COMMAND,
  METADATA_BLOCKS_COMMAND,
  LIST_DESTINATIONS_COMMAND,
  SEARCH_DESTINATIONS_COMMAND,
  CHECK_DESTINATION_COMMAND,
  UPDATE_COMMAND,
  SYNC_COMMAND,
  VALIDATE_COMMAND,
} = require('../src/dataverse-provider')

describe('Dataverse provider command boundary', () => {
  it('registers create, delete, import, link, update, sync and validation operations and unregisters on deactivation', async () => {
    const commands = new Map()
    const executions = []
    const vscode = {
      ProgressLocation: { Notification: 15 },
      window: {
        withProgress: async (_options, task) => task({ report() {} }),
      },
      commands: {
        registerCommand: (id, handler) => {
          commands.set(id, handler)
          return {
            dispose() {
              commands.delete(id)
            },
          }
        },
        executeCommand: async (...args) => {
          executions.push(args)
        },
      },
    }
    const context = {
      extension: { id: 'SZTAKI-DSD.dataverse-repository-provider' },
      subscriptions: [],
    }
    const repository = {
      baseUrl: 'https://demo.dataverse.org',
      apiKey: 'secret',
    }

    await activateDataverseProvider(vscode, context, (received) => {
      assert.equal(received, repository)
      return {
        validateConnection: async () => ({
          userName: 'Alice',
          expirationDate: '2027-02-03T04:05:06.000Z',
        }),
        getCollectionMetadataBlocks: async collectionId => {
          assert.equal(collectionId, 'root')
          return {
            ok: true,
            status: 200,
            payload: { status: 'OK', data: [{ name: 'citation' }, { name: 'geospatial' }] },
          }
        },
      }
    })

    assert.deepEqual(executions[0], [
      'rockit.repositories.registerProvider',
      {
        id: 'dataverse',
        displayName: 'Dataverse',
        extensionId: 'SZTAKI-DSD.dataverse-repository-provider',
        protocolVersion: '1.0',
        operations: {
          create: CREATE_COMMAND,
          delete: DELETE_COMMAND,
          import: IMPORT_COMMAND,
          link: LINK_COMMAND,
          metadataBlocks: METADATA_BLOCKS_COMMAND,
          listDestinations: LIST_DESTINATIONS_COMMAND,
          searchDestinations: SEARCH_DESTINATIONS_COMMAND,
          checkDestination: CHECK_DESTINATION_COMMAND,
          update: UPDATE_COMMAND,
          sync: SYNC_COMMAND,
          validate: VALIDATE_COMMAND,
        },
        importInput: {
          kind: 'url',
          title: 'Import Dataverse Dataset',
          description: 'Enter a Dataverse dataset persistent ID or dataset URL to import.',
          placeholder: 'https://demo.dataverse.org/dataset.xhtml?persistentId=doi:...',
          fieldLabel: 'Dataset PID or URL',
        },
        connection: { requiresApiKey: true },
      },
    ])
    assert.deepEqual(await commands.get(VALIDATE_COMMAND)({ repository }), {
      valid: true,
      userName: 'Alice',
      expirationDate: '2027-02-03T04:05:06.000Z',
    })
    assert.deepEqual(
      await commands.get(METADATA_BLOCKS_COMMAND)({ repository, collectionId: 'root' }),
      { aliases: ['citation', 'geospatial'] },
    )

    await deactivateDataverseProvider(vscode)
    assert.deepEqual(executions[1], [
      'rockit.repositories.unregisterProvider',
      'dataverse',
      'SZTAKI-DSD.dataverse-repository-provider',
    ])
  })
})

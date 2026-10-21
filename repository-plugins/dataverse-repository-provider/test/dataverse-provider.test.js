// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const {
  activateDataverseProvider,
  deactivateDataverseProvider,
  CREATE_COMMAND,
  VALIDATE_COMMAND,
} = require('../src/dataverse-provider')

describe('Dataverse provider command boundary', () => {
  it('registers create and validation operations and unregisters on deactivation', async () => {
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
      extension: { id: 'rockit.dataverse-repository-provider' },
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
      }
    })

    assert.deepEqual(executions[0], [
      'rockit.repositories.registerProvider',
      {
        id: 'dataverse',
        displayName: 'Dataverse',
        extensionId: 'rockit.dataverse-repository-provider',
        protocolVersion: '1.0',
        operations: { create: CREATE_COMMAND, validate: VALIDATE_COMMAND },
        connection: { requiresApiKey: true },
      },
    ])
    assert.deepEqual(await commands.get(VALIDATE_COMMAND)({ repository }), {
      valid: true,
      userName: 'Alice',
      expirationDate: '2027-02-03T04:05:06.000Z',
    })

    await deactivateDataverseProvider(vscode)
    assert.deepEqual(executions[1], [
      'rockit.repositories.unregisterProvider',
      'dataverse',
      'rockit.dataverse-repository-provider',
    ])
  })
})

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
} = require('../src/arp-provider')

describe('ARP provider command boundary', () => {
  it('registers only read-only validation and dispatches it through the plugin command', async () => {
    const commands = new Map()
    const executions = []
    const vscode = {
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
      }
    })

    assert.deepEqual(executions[0], ['rockit.repositories.registerProvider', {
      id: 'arp',
      displayName: 'ARP',
      extensionId: 'rockit.arp-repository-provider',
      protocolVersion: '1.0',
      operations: { validate: VALIDATE_COMMAND },
      connection: { requiresApiKey: true },
    }])
    assert.deepEqual(await commands.get(VALIDATE_COMMAND)({ repository }), { valid: true })
    assert.deepEqual(calls, ['probe', 'token'])

    await deactivateArpProvider(vscode)
    assert.deepEqual(executions[1], [
      'rockit.repositories.unregisterProvider', 'arp', 'rockit.arp-repository-provider',
    ])
  })
})

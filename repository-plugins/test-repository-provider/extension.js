// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const vscode = require('vscode')

const PROVIDER_ID = 'test-repository'
const REGISTER_PROVIDER_COMMAND = 'rockit.repositories.registerProvider'
const UNREGISTER_PROVIDER_COMMAND = 'rockit.repositories.unregisterProvider'
const LIST_PROVIDERS_COMMAND = 'rockit.repositories.listProviders'
const EXECUTE_OPERATION_COMMAND = 'rockit.repositories.executeOperation'
const CREATE_COMMAND = 'rockit.testRepository.create'
const VERIFY_REGISTRATION_COMMAND = 'rockit.testRepository.verifyRegistration'
const VERIFY_CREATE_ROUND_TRIP_COMMAND = 'rockit.testRepository.verifyCreateRoundTrip'

let registeredExtensionId

/** @param {import('vscode').ExtensionContext} context */
async function activate(context) {
  registeredExtensionId = context.extension.id
  context.subscriptions.push(
    vscode.commands.registerCommand(CREATE_COMMAND, async (request) => ({
      providerId: PROVIDER_ID,
      remoteId: 'test-123',
      state: 'draft',
      landingPage: 'https://example.invalid/test-123',
      request,
    })),
    vscode.commands.registerCommand(VERIFY_REGISTRATION_COMMAND, async () => {
      const providers = await vscode.commands.executeCommand(LIST_PROVIDERS_COMMAND)
      const provider = Array.isArray(providers)
        ? providers.find((candidate) => candidate.id === PROVIDER_ID)
        : undefined

      const message = provider
        ? `Registered ${provider.displayName} with operations: ${Object.keys(provider.operations).join(', ')}`
        : 'The test repository provider is not registered.'

      await vscode.window.showInformationMessage(message)
      return provider
    }),
    vscode.commands.registerCommand(VERIFY_CREATE_ROUND_TRIP_COMMAND, async () => {
      const result = await vscode.commands.executeCommand(EXECUTE_OPERATION_COMMAND, {
        providerId: PROVIDER_ID,
        operation: 'create',
        input: { title: 'Plugin boundary test' },
      })

      await vscode.window.showInformationMessage(
        `RocKIT received remote id ${result.remoteId} from the test repository extension.`,
      )
      return result
    }),
  )

  await vscode.commands.executeCommand(REGISTER_PROVIDER_COMMAND, {
    id: PROVIDER_ID,
    displayName: 'Test Repository',
    extensionId: registeredExtensionId,
    protocolVersion: '1.0',
    operations: {
      create: CREATE_COMMAND,
    },
  })
}

async function deactivate() {
  if (!registeredExtensionId) {
    return
  }
  await vscode.commands.executeCommand(
    UNREGISTER_PROVIDER_COMMAND,
    PROVIDER_ID,
    registeredExtensionId,
  )
}

module.exports = { activate, deactivate }

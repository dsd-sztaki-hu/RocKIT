// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const { DataverseClient } = require('./dataverse-client')

const PROVIDER_ID = 'dataverse'
const VALIDATE_COMMAND = 'rockit.dataverse.validate'
const REGISTER_COMMAND = 'rockit.repositories.registerProvider'
const UNREGISTER_COMMAND = 'rockit.repositories.unregisterProvider'

let registeredExtensionId

async function activateDataverseProvider(
  vscode,
  context,
  clientFactory = (repository) =>
    new DataverseClient({
      baseUrl: repository.baseUrl,
      token: repository.apiKey,
    }),
) {
  registeredExtensionId = context.extension.id
  context.subscriptions.push(
    vscode.commands.registerCommand(VALIDATE_COMMAND, (input) =>
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Validating Dataverse connection',
          cancellable: false,
        },
        async () => {
          const repository = input?.repository
          if (!repository || typeof repository !== 'object') {
            throw new Error('The Dataverse repository configuration is missing.')
          }
          const result = await clientFactory(repository).validateConnection()
          return { valid: true, ...result }
        },
      ),
    ),
  )

  await vscode.commands.executeCommand(REGISTER_COMMAND, {
    id: PROVIDER_ID,
    displayName: 'Dataverse',
    extensionId: registeredExtensionId,
    protocolVersion: '1.0',
    operations: {
      validate: VALIDATE_COMMAND,
    },
    connection: { requiresApiKey: true },
  })
}

async function deactivateDataverseProvider(vscode) {
  if (!registeredExtensionId) return
  await vscode.commands.executeCommand(
    UNREGISTER_COMMAND,
    PROVIDER_ID,
    registeredExtensionId,
  )
  registeredExtensionId = undefined
}

module.exports = {
  activateDataverseProvider,
  deactivateDataverseProvider,
  PROVIDER_ID,
  VALIDATE_COMMAND,
}

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const vscode = require('vscode')

const { ZenodoClient } = require('./src/zenodo-client')
const { ZenodoCreateOperation } = require('./src/zenodo-create-operation')

const PROVIDER_ID = 'zenodo'
const REGISTER_PROVIDER_COMMAND = 'rockit.repositories.registerProvider'
const UNREGISTER_PROVIDER_COMMAND = 'rockit.repositories.unregisterProvider'
const CREATE_COMMAND = 'rockit.zenodo.create'

let registeredExtensionId

/** @param {import('vscode').ExtensionContext} context */
async function activate(context) {
  registeredExtensionId = context.extension.id
  const createOperation = new ZenodoCreateOperation({
    vscode,
    clientFactory: (repository) =>
      new ZenodoClient({
        baseUrl: repository.baseUrl,
        token: repository.apiKey,
      }),
  })

  context.subscriptions.push(
    vscode.commands.registerCommand(CREATE_COMMAND, (input) =>
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Exporting RO-Crate to Zenodo',
          cancellable: false,
        },
        (progress) => createOperation.execute(input, progress),
      ),
    ),
  )

  await vscode.commands.executeCommand(REGISTER_PROVIDER_COMMAND, {
    id: PROVIDER_ID,
    displayName: 'Zenodo',
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

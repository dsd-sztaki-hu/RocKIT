// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const { ArpClient } = require('./arp-client')
const { ArpCreateOperation } = require('./arp-create-operation')
const { ArpDeleteOperation } = require('./arp-delete-operation')
const { ArpUpdateOperation } = require('./arp-update-operation')

const PROVIDER_ID = 'arp'
const VALIDATE_COMMAND = 'rockit.arp.validate'
const CREATE_COMMAND = 'rockit.arp.create'
const DELETE_COMMAND = 'rockit.arp.delete'
const UPDATE_COMMAND = 'rockit.arp.update'
const METADATA_LANGUAGES_COMMAND = 'rockit.arp.metadataLanguages'
const REGISTER_COMMAND = 'rockit.repositories.registerProvider'
const UNREGISTER_COMMAND = 'rockit.repositories.unregisterProvider'

let registeredExtensionId

async function activateArpProvider(vscode, context, clientFactory = repository => new ArpClient({
  baseUrl: repository.baseUrl,
  token: repository.apiKey,
})) {
  registeredExtensionId = context.extension.id
  const createOperation = new ArpCreateOperation({ vscode, clientFactory })
  const deleteOperation = new ArpDeleteOperation({ clientFactory })
  const updateOperation = new ArpUpdateOperation({ vscode, clientFactory })
  context.subscriptions.push(vscode.commands.registerCommand(CREATE_COMMAND, input =>
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Exporting RO-Crate to ARP',
      cancellable: false,
    }, progress => createOperation.execute(input, progress)),
  ))
  context.subscriptions.push(vscode.commands.registerCommand(DELETE_COMMAND, input =>
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Deleting ARP draft',
      cancellable: false,
    }, progress => deleteOperation.execute(input, progress)),
  ))
  context.subscriptions.push(vscode.commands.registerCommand(UPDATE_COMMAND, input =>
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Updating ARP dataset',
      cancellable: false,
    }, progress => updateOperation.execute(input, progress)),
  ))
  context.subscriptions.push(vscode.commands.registerCommand(METADATA_LANGUAGES_COMMAND, async input => {
    const repository = input?.repository
    const collectionId = input?.collectionId
    if (!repository || typeof collectionId !== 'string' || !collectionId.trim()) {
      throw new Error('ARP metadata languages require a repository and collection.')
    }
    const result = await clientFactory(repository).getAllowedMetadataLanguages(collectionId)
    if (!result.ok || result.payload?.status === 'ERROR') {
      throw new Error(`ARP metadata languages could not be loaded (${result.status}) at ${result.url}.`)
    }
    return result.payload
  }))
  context.subscriptions.push(vscode.commands.registerCommand(VALIDATE_COMMAND, async input => {
    const repository = input?.repository
    if (!repository || typeof repository !== 'object') {
      throw new Error('The ARP repository configuration is missing.')
    }
    const client = clientFactory(repository)
    if (!(await client.supportsRoCrateUpload())) {
      throw new Error('This repository does not support ARP RO-Crate ZIP uploads.')
    }
    await client.validateToken()
    return { valid: true }
  }))

  await vscode.commands.executeCommand(REGISTER_COMMAND, {
    id: PROVIDER_ID,
    displayName: 'ARP',
    extensionId: registeredExtensionId,
    protocolVersion: '1.0',
    operations: {
      validate: VALIDATE_COMMAND,
      create: CREATE_COMMAND,
      delete: DELETE_COMMAND,
      update: UPDATE_COMMAND,
      metadataLanguages: METADATA_LANGUAGES_COMMAND,
    },
    connection: { requiresApiKey: true },
  })
}

async function deactivateArpProvider(vscode) {
  if (!registeredExtensionId) return
  await vscode.commands.executeCommand(UNREGISTER_COMMAND, PROVIDER_ID, registeredExtensionId)
  registeredExtensionId = undefined
}

module.exports = {
  activateArpProvider,
  deactivateArpProvider,
  PROVIDER_ID,
  VALIDATE_COMMAND,
  CREATE_COMMAND,
  DELETE_COMMAND,
  UPDATE_COMMAND,
  METADATA_LANGUAGES_COMMAND,
}

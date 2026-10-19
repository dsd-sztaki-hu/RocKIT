// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const { ArpClient } = require('./arp-client')

const PROVIDER_ID = 'arp'
const VALIDATE_COMMAND = 'rockit.arp.validate'
const REGISTER_COMMAND = 'rockit.repositories.registerProvider'
const UNREGISTER_COMMAND = 'rockit.repositories.unregisterProvider'

let registeredExtensionId

async function activateArpProvider(vscode, context, clientFactory = repository => new ArpClient({
  baseUrl: repository.baseUrl,
  token: repository.apiKey,
})) {
  registeredExtensionId = context.extension.id
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
    operations: { validate: VALIDATE_COMMAND },
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
}

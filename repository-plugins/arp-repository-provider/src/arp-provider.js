const { withRepositoryProgress } = require('./repository-progress')
// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const { ArpClient } = require('./arp-client')
const { ArpCreateOperation } = require('./arp-create-operation')
const { ArpDeleteOperation } = require('./arp-delete-operation')
const { ArpImportOperation } = require('./arp-import-operation')
const { ArpLinkOperation } = require('./arp-link-operation')
const { ArpSyncOperation } = require('./arp-sync-operation')
const { ArpUpdateOperation } = require('./arp-update-operation')
const { DataverseDestinationOperation } = require('./dataverse-destination-operation')

const PROVIDER_ID = 'arp'
const DETECT_COMMAND = 'rockit.arp.detect'
const VALIDATE_COMMAND = 'rockit.arp.validate'
const CREATE_COMMAND = 'rockit.arp.create'
const DELETE_COMMAND = 'rockit.arp.delete'
const IMPORT_COMMAND = 'rockit.arp.import'
const LINK_COMMAND = 'rockit.arp.link'
const SYNC_COMMAND = 'rockit.arp.sync'
const UPDATE_COMMAND = 'rockit.arp.update'
const METADATA_LANGUAGES_COMMAND = 'rockit.arp.metadataLanguages'
const LIST_DESTINATIONS_COMMAND = 'rockit.arp.listDestinations'
const SEARCH_DESTINATIONS_COMMAND = 'rockit.arp.searchDestinations'
const CHECK_DESTINATION_COMMAND = 'rockit.arp.checkDestination'
const REGISTER_COMMAND = 'rockit.repositories.registerProvider'
const UNREGISTER_COMMAND = 'rockit.repositories.unregisterProvider'

let registeredExtensionId

async function activateArpProvider(
  vscode,
  context,
  clientFactory = (repository) =>
    new ArpClient({
      baseUrl: repository.baseUrl,
      token: repository.apiKey,
    }),
) {
  registeredExtensionId = context.extension.id
  const createOperation = new ArpCreateOperation({ vscode, clientFactory })
  const deleteOperation = new ArpDeleteOperation({ clientFactory })
  const importOperation = new ArpImportOperation({ vscode, clientFactory })
  const linkOperation = new ArpLinkOperation({ vscode, clientFactory })
  const syncOperation = new ArpSyncOperation({ vscode, clientFactory })
  const updateOperation = new ArpUpdateOperation({ vscode, clientFactory })
  const destinationOperation = new DataverseDestinationOperation({ clientFactory })
  context.subscriptions.push(
    vscode.commands.registerCommand(DETECT_COMMAND, async (input) => {
      if (typeof input?.baseUrl !== 'string' || !input.baseUrl.trim()) {
        return { supported: false }
      }
      try {
        return {
          supported: await clientFactory({ baseUrl: input.baseUrl }).supportsRoCrateUpload(),
        }
      } catch {
        return { supported: false }
      }
    }),
    vscode.commands.registerCommand(LIST_DESTINATIONS_COMMAND, (input) =>
      destinationOperation.list(input),
    ),
    vscode.commands.registerCommand(SEARCH_DESTINATIONS_COMMAND, (input) =>
      destinationOperation.search(input),
    ),
    vscode.commands.registerCommand(CHECK_DESTINATION_COMMAND, (input) =>
      destinationOperation.check(input),
    ),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand(CREATE_COMMAND, (input) =>
      withRepositoryProgress(
        vscode,
        PROVIDER_ID,
        input,
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Exporting RO-Crate to ARP',
          cancellable: false,
        },
        (progress) => createOperation.execute(input, progress),
      ),
    ),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand(DELETE_COMMAND, (input) =>
      withRepositoryProgress(
        vscode,
        PROVIDER_ID,
        input,
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Deleting ARP draft',
          cancellable: false,
        },
        (progress) => deleteOperation.execute(input, progress),
      ),
    ),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand(UPDATE_COMMAND, (input) =>
      withRepositoryProgress(
        vscode,
        PROVIDER_ID,
        input,
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Updating ARP dataset',
          cancellable: false,
        },
        (progress) => updateOperation.execute(input, progress),
      ),
    ),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand(IMPORT_COMMAND, (input) =>
      withRepositoryProgress(
        vscode,
        PROVIDER_ID,
        input,
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Importing ARP dataset',
          cancellable: false,
        },
        (progress) => importOperation.execute(input, progress),
      ),
    ),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand(LINK_COMMAND, (input) =>
      withRepositoryProgress(
        vscode,
        PROVIDER_ID,
        input,
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Linking RO-Crate to ARP dataset',
          cancellable: false,
        },
        (progress) => linkOperation.execute(input, progress),
      ),
    ),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand(SYNC_COMMAND, (input) =>
      withRepositoryProgress(
        vscode,
        PROVIDER_ID,
        input,
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Synchronizing ARP dataset',
          cancellable: false,
        },
        (progress) => syncOperation.execute(input, progress),
      ),
    ),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand(METADATA_LANGUAGES_COMMAND, async (input) => {
      const repository = input?.repository
      const collectionId = input?.collectionId
      if (!repository || typeof collectionId !== 'string' || !collectionId.trim()) {
        throw new Error('ARP metadata languages require a repository and collection.')
      }
      const result =
        await clientFactory(repository).getAllowedMetadataLanguages(collectionId)
      if (!result.ok || result.payload?.status === 'ERROR') {
        throw new Error(
          `ARP metadata languages could not be loaded (${result.status}) at ${result.url}.`,
        )
      }
      return result.payload
    }),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand(VALIDATE_COMMAND, async (input) => {
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
    }),
  )

  await vscode.commands.executeCommand(REGISTER_COMMAND, {
    id: PROVIDER_ID,
    displayName: 'ARP',
    detectionPriority: 100,
    extensionId: registeredExtensionId,
    protocolVersion: '1.0',
    operations: {
      detect: DETECT_COMMAND,
      validate: VALIDATE_COMMAND,
      create: CREATE_COMMAND,
      delete: DELETE_COMMAND,
      import: IMPORT_COMMAND,
      link: LINK_COMMAND,
      sync: SYNC_COMMAND,
      update: UPDATE_COMMAND,
      metadataLanguages: METADATA_LANGUAGES_COMMAND,
      listDestinations: LIST_DESTINATIONS_COMMAND,
      searchDestinations: SEARCH_DESTINATIONS_COMMAND,
      checkDestination: CHECK_DESTINATION_COMMAND,
    },
    importInput: {
      kind: 'url',
      title: 'Import ARP Dataset',
      description: 'Enter an ARP dataset persistent ID or dataset URL to import.',
      placeholder: 'https://repo.researchdata.hu/dataset.xhtml?persistentId=hdl:...',
      fieldLabel: 'Dataset PID or URL',
    },
    connection: { requiresApiKey: true },
  })
}

async function deactivateArpProvider(vscode) {
  if (!registeredExtensionId) return
  await vscode.commands.executeCommand(
    UNREGISTER_COMMAND,
    PROVIDER_ID,
    registeredExtensionId,
  )
  registeredExtensionId = undefined
}

module.exports = {
  activateArpProvider,
  deactivateArpProvider,
  PROVIDER_ID,
  DETECT_COMMAND,
  VALIDATE_COMMAND,
  CREATE_COMMAND,
  DELETE_COMMAND,
  IMPORT_COMMAND,
  LINK_COMMAND,
  SYNC_COMMAND,
  UPDATE_COMMAND,
  METADATA_LANGUAGES_COMMAND,
  LIST_DESTINATIONS_COMMAND,
  SEARCH_DESTINATIONS_COMMAND,
  CHECK_DESTINATION_COMMAND,
}

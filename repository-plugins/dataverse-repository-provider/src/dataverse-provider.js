const { withRepositoryProgress } = require('./repository-progress')
// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const { DataverseClient } = require('./dataverse-client')
const { DataverseCreateOperation } = require('./dataverse-create-operation')
const { DataverseDeleteOperation } = require('./dataverse-delete-operation')
const { DataverseImportOperation } = require('./dataverse-import-operation')
const { DataverseLinkOperation } = require('./dataverse-link-operation')
const { DataverseUpdateOperation } = require('./dataverse-update-operation')
const { DataverseSyncOperation } = require('./dataverse-sync-operation')
const { DataverseDestinationOperation } = require('./dataverse-destination-operation')

const PROVIDER_ID = 'dataverse'
const DETECT_COMMAND = 'rockit.dataverse.detect'
const CREATE_COMMAND = 'rockit.dataverse.create'
const DELETE_COMMAND = 'rockit.dataverse.delete'
const IMPORT_COMMAND = 'rockit.dataverse.import'
const LINK_COMMAND = 'rockit.dataverse.link'
const METADATA_BLOCKS_COMMAND = 'rockit.dataverse.metadataBlocks'
const LIST_DESTINATIONS_COMMAND = 'rockit.dataverse.listDestinations'
const SEARCH_DESTINATIONS_COMMAND = 'rockit.dataverse.searchDestinations'
const CHECK_DESTINATION_COMMAND = 'rockit.dataverse.checkDestination'
const UPDATE_COMMAND = 'rockit.dataverse.update'
const SYNC_COMMAND = 'rockit.dataverse.sync'
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
  const createOperation = new DataverseCreateOperation({ vscode, clientFactory })
  const deleteOperation = new DataverseDeleteOperation({ clientFactory })
  const importOperation = new DataverseImportOperation({ vscode, clientFactory })
  const linkOperation = new DataverseLinkOperation({ vscode, clientFactory })
  const updateOperation = new DataverseUpdateOperation({ vscode, clientFactory })
  const syncOperation = new DataverseSyncOperation({ vscode, clientFactory })
  const destinationOperation = new DataverseDestinationOperation({ clientFactory })
  context.subscriptions.push(
    vscode.commands.registerCommand(DETECT_COMMAND, async (input) => {
      if (typeof input?.baseUrl !== 'string' || !input.baseUrl.trim()) {
        return { supported: false }
      }
      try {
        return {
          supported: await clientFactory({ baseUrl: input.baseUrl }).supportsRepository(),
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
    vscode.commands.registerCommand(METADATA_BLOCKS_COMMAND, async (input) => {
      const repository = input?.repository
      const collectionId = input?.collectionId
      if (!repository || typeof collectionId !== 'string' || !collectionId.trim()) {
        throw new Error('Dataverse metadata blocks require a repository and collection.')
      }
      const result =
        await clientFactory(repository).getCollectionMetadataBlocks(collectionId)
      if (!result?.ok || result.payload?.status === 'ERROR') {
        throw new Error(
          `Dataverse metadata blocks could not be loaded (${result?.status ?? 'unknown'}).`,
        )
      }
      const aliases = (Array.isArray(result.payload?.data) ? result.payload.data : [])
        .map((block) => (typeof block?.name === 'string' ? block.name.trim() : ''))
        .filter(Boolean)
      return { aliases: [...new Set(['citation', ...aliases])] }
    }),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand(LINK_COMMAND, (input) =>
      withRepositoryProgress(
        vscode,
        PROVIDER_ID,
        input,
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Inspecting Dataverse dataset',
          cancellable: false,
        },
        (progress) => linkOperation.execute(input, progress),
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
          title: 'Importing Dataverse dataset',
          cancellable: false,
        },
        (progress) => importOperation.execute(input, progress),
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
          title: 'Synchronizing Dataverse dataset',
          cancellable: false,
        },
        (progress) => syncOperation.execute(input, progress),
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
          title: 'Updating Dataverse dataset',
          cancellable: false,
        },
        (progress) => updateOperation.execute(input, progress),
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
          title: 'Deleting Dataverse draft',
          cancellable: false,
        },
        (progress) => deleteOperation.execute(input, progress),
      ),
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
          title: 'Exporting RO-Crate to Dataverse',
          cancellable: false,
        },
        (progress) => createOperation.execute(input, progress),
      ),
    ),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand(VALIDATE_COMMAND, (input) =>
      withRepositoryProgress(
        vscode,
        PROVIDER_ID,
        input,
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
    detectionPriority: -100,
    extensionId: registeredExtensionId,
    protocolVersion: '1.0',
    operations: {
      detect: DETECT_COMMAND,
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
  DETECT_COMMAND,
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
}

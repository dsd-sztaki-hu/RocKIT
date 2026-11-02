const { withRepositoryProgress } = require('./src/repository-progress')
// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const vscode = require('vscode')

const { ZenodoClient } = require('./src/zenodo-client')
const { ZenodoCreateOperation } = require('./src/zenodo-create-operation')
const { ZenodoUpdateOperation } = require('./src/zenodo-update-operation')
const { ZenodoSyncOperation } = require('./src/zenodo-sync-operation')
const { ZenodoImportOperation } = require('./src/zenodo-import-operation')
const { ZenodoDeleteOperation } = require('./src/zenodo-delete-operation')
const { ZenodoLinkOperation } = require('./src/zenodo-link-operation')
const { ZenodoValidateOperation } = require('./src/zenodo-validate-operation')
const { ZenodoTargetOperation } = require('./src/zenodo-target-operation')

const PROVIDER_ID = 'zenodo'
const REGISTER_PROVIDER_COMMAND = 'rockit.repositories.registerProvider'
const UNREGISTER_PROVIDER_COMMAND = 'rockit.repositories.unregisterProvider'
const CREATE_COMMAND = 'rockit.zenodo.create'
const UPDATE_COMMAND = 'rockit.zenodo.update'
const SYNC_COMMAND = 'rockit.zenodo.sync'
const IMPORT_COMMAND = 'rockit.zenodo.import'
const DELETE_COMMAND = 'rockit.zenodo.delete'
const LINK_COMMAND = 'rockit.zenodo.link'
const VALIDATE_COMMAND = 'rockit.zenodo.validate'
const LIST_TARGETS_COMMAND = 'rockit.zenodo.listTargets'
const MARK_TARGET_FAILED_COMMAND = 'rockit.zenodo.markTargetFailed'

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
  const updateOperation = new ZenodoUpdateOperation({
    vscode,
    clientFactory: (repository) =>
      new ZenodoClient({
        baseUrl: repository.baseUrl,
        token: repository.apiKey,
      }),
  })
  const syncOperation = new ZenodoSyncOperation({
    vscode,
    clientFactory: (repository) =>
      new ZenodoClient({
        baseUrl: repository.baseUrl,
        token: repository.apiKey,
      }),
  })
  const importOperation = new ZenodoImportOperation({
    vscode,
    clientFactory: (repository) =>
      new ZenodoClient({
        baseUrl: repository.baseUrl,
        token: repository.apiKey,
      }),
  })
  const deleteOperation = new ZenodoDeleteOperation({
    clientFactory: (repository) =>
      new ZenodoClient({
        baseUrl: repository.baseUrl,
        token: repository.apiKey,
      }),
  })
  const linkOperation = new ZenodoLinkOperation({
    vscode,
    clientFactory: (repository) =>
      new ZenodoClient({
        baseUrl: repository.baseUrl,
        token: repository.apiKey,
      }),
  })
  const validateOperation = new ZenodoValidateOperation({
    clientFactory: (repository) =>
      new ZenodoClient({
        baseUrl: repository.baseUrl,
        token: repository.apiKey,
      }),
  })
  const targetOperation = new ZenodoTargetOperation({
    vscode,
    clientFactory: () => undefined,
  })

  context.subscriptions.push(
    vscode.commands.registerCommand(CREATE_COMMAND, (input) =>
      withRepositoryProgress(
        vscode,
        PROVIDER_ID,
        input,
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Exporting RO-Crate to Zenodo',
          cancellable: false,
        },
        (progress) => createOperation.execute(input, progress),
      ),
    ),
    vscode.commands.registerCommand(UPDATE_COMMAND, (input) =>
      withRepositoryProgress(
        vscode,
        PROVIDER_ID,
        input,
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Updating Zenodo draft from RO-Crate',
          cancellable: false,
        },
        (progress) => updateOperation.execute(input, progress),
      ),
    ),
    vscode.commands.registerCommand(SYNC_COMMAND, (input) =>
      withRepositoryProgress(
        vscode,
        PROVIDER_ID,
        input,
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Syncing RO-Crate from Zenodo',
          cancellable: false,
        },
        (progress) => syncOperation.execute(input, progress),
      ),
    ),
    vscode.commands.registerCommand(IMPORT_COMMAND, (input) =>
      withRepositoryProgress(
        vscode,
        PROVIDER_ID,
        input,
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Importing Zenodo record as an RO-Crate',
          cancellable: false,
        },
        (progress) => importOperation.execute(input, progress),
      ),
    ),
    vscode.commands.registerCommand(DELETE_COMMAND, (input) =>
      withRepositoryProgress(
        vscode,
        PROVIDER_ID,
        input,
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Deleting Zenodo deposition',
          cancellable: false,
        },
        (progress) => deleteOperation.execute(input, progress),
      ),
    ),
    vscode.commands.registerCommand(LINK_COMMAND, (input) =>
      withRepositoryProgress(
        vscode,
        PROVIDER_ID,
        input,
        {
          location: vscode.ProgressLocation.Notification,
          title:
            input?.mode === 'preview'
              ? 'Checking Zenodo deposition'
              : 'Linking Zenodo deposition',
          cancellable: false,
        },
        (progress) => linkOperation.execute(input, progress),
      ),
    ),
    vscode.commands.registerCommand(VALIDATE_COMMAND, (input) =>
      withRepositoryProgress(
        vscode,
        PROVIDER_ID,
        input,
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Validating Zenodo connection',
          cancellable: false,
        },
        (progress) => validateOperation.execute(input, progress),
      ),
    ),
    vscode.commands.registerCommand(LIST_TARGETS_COMMAND, (input) =>
      targetOperation.list(input),
    ),
    vscode.commands.registerCommand(MARK_TARGET_FAILED_COMMAND, (input) =>
      targetOperation.markFailed(input),
    ),
  )

  await vscode.commands.executeCommand(REGISTER_PROVIDER_COMMAND, {
    id: PROVIDER_ID,
    displayName: 'Zenodo',
    extensionId: registeredExtensionId,
    protocolVersion: '1.0',
    operations: {
      create: CREATE_COMMAND,
      update: UPDATE_COMMAND,
      sync: SYNC_COMMAND,
      import: IMPORT_COMMAND,
      delete: DELETE_COMMAND,
      link: LINK_COMMAND,
      validate: VALIDATE_COMMAND,
      listTargets: LIST_TARGETS_COMMAND,
      markTargetFailed: MARK_TARGET_FAILED_COMMAND,
    },
    importInput: {
      kind: 'url',
      title: 'Import Zenodo Record',
      description:
        'Enter a Zenodo upload URL in the format https://zenodo.org/uploads/{id}.',
      placeholder: 'https://zenodo.org/uploads/1234567',
      fieldLabel: 'Zenodo Upload URL',
    },
    connection: {
      requiresApiKey: true,
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

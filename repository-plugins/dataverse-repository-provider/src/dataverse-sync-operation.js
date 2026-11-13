// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const { DataverseUpdateOperation } = require('./dataverse-update-operation')

const CHECKPOINT_COMMAND = 'rockit.repositories.checkpointSyncExport'

class DataverseSyncOperation extends DataverseUpdateOperation {
  async execute(input, progress = { report() {} }) {
    const repository = this.object(input?.repository)
    const persistentId = this.text(input?.persistentId ?? input?.plan?.persistentId)
    if (!repository?.baseUrl || !persistentId) {
      throw new Error('Dataverse sync requires a repository and persistent ID.')
    }
    const client = this.clientFactory(repository)
    if (input?.phase === 'inspect') {
      return this.inspect(client, persistentId, progress)
    }
    const plan = this.object(input?.plan)
    const operationId = this.text(input?.operationId)
    const files = plan?.files
    if (input?.phase !== 'download' || !operationId || !Array.isArray(files)) {
      throw new Error(
        'Dataverse sync requires a prepared download plan and operation ID.',
      )
    }
    let completedSteps = 0
    for (const file of files) {
      const remoteId = this.text(file?.remoteId)
      const localPath = this.text(file?.localPath)
      const targetUri = this.text(file?.targetUri)
      const targetParentUri = this.text(file?.targetParentUri)
      if (
        !remoteId ||
        !localPath ||
        !targetUri ||
        !targetParentUri ||
        !['new', 'changed'].includes(file?.kind)
      ) {
        throw new Error('Dataverse sync contains an invalid remote-file entry.')
      }
      progress.report({
        message: `Downloading ${localPath}...`,
        completedSteps,
        totalSteps: files.length,
      })
      const response = await client.downloadFile(remoteId)
      if (!response?.ok || !(response.bytes instanceof Uint8Array)) {
        throw new Error(
          `Dataverse download of '${remoteId}' failed (${response?.status ?? 'unknown'}).`,
        )
      }
      await this.vscode.workspace.fs.createDirectory(
        this.vscode.Uri.parse(targetParentUri),
      )
      await this.vscode.workspace.fs.writeFile(
        this.vscode.Uri.parse(targetUri),
        response.bytes,
      )
      await this.vscode.commands.executeCommand(CHECKPOINT_COMMAND, {
        operationId,
        providerId: 'dataverse',
        stage: 'fileDownloaded',
        persistentId,
        file,
      })
      completedSteps += 1
    }
    return { providerId: 'dataverse', persistentId, downloadedFiles: files }
  }
}

module.exports = { DataverseSyncOperation, CHECKPOINT_COMMAND }

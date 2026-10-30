// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const { ArpCreateOperation } = require('./arp-create-operation')

const CHECKPOINT_COMMAND = 'rockit.repositories.checkpointSyncExport'

class ArpSyncOperation extends ArpCreateOperation {
  async execute(input, progress = { report() {} }) {
    const repository = this.object(input?.repository)
    const pid = input?.pid || input?.plan?.pid
    if (!repository?.baseUrl || typeof pid !== 'string' || !pid.trim()) {
      throw new Error('ARP sync requires a repository and dataset PID.')
    }
    const client = this.clientFactory(repository)
    if (input?.phase === 'loadRemote') {
      progress.report({ message: 'Loading remote ARP RO-Crate...' })
      const response = await client.getRoCrate(pid)
      this.requireSuccess(response, 'ARP RO-Crate lookup')
      const remoteCrate = this.findCrate(response.payload)
      if (!remoteCrate) throw new Error('The ARP RO-Crate response did not contain a valid @graph.')
      return { providerId: 'arp', pid, remoteCrate }
    }

    const plan = this.object(input?.plan)
    const operationId = input?.operationId
    const files = plan?.files
    if (!plan || typeof operationId !== 'string' || !operationId.trim() || !Array.isArray(files)) {
      throw new Error('ARP sync requires a prepared file plan and operation ID.')
    }
    let completedSteps = 0
    for (const file of files) {
      if (!this.object(file) || typeof file.remoteId !== 'string' ||
          (typeof file.remoteFileId !== 'number' && typeof file.remoteFileId !== 'string') ||
          typeof file.localId !== 'string' || typeof file.localPath !== 'string' ||
          typeof file.targetUri !== 'string' || typeof file.targetParentUri !== 'string' ||
          !['new', 'changed'].includes(file.kind)) {
        throw new Error('ARP sync contains an invalid remote-file entry.')
      }
      progress.report({
        message: `Downloading ${file.localPath}...`, completedSteps, totalSteps: files.length,
      })
      const response = await client.downloadFile(file.remoteFileId)
      this.requireSuccess(response, `Dataverse download of '${file.remoteId}'`)
      if (!(response.bytes instanceof Uint8Array)) {
        throw new Error(`Dataverse returned invalid bytes for '${file.remoteId}'.`)
      }
      await this.vscode.workspace.fs.createDirectory(
        this.vscode.Uri.parse(file.targetParentUri))
      await this.vscode.workspace.fs.writeFile(this.vscode.Uri.parse(file.targetUri), response.bytes)
      await this.vscode.commands.executeCommand(CHECKPOINT_COMMAND, {
        operationId, providerId: 'arp', stage: 'fileDownloaded', pid, file,
      })
      completedSteps += 1
    }
    progress.report({ message: 'Remote file download complete.', completedSteps, totalSteps: files.length })
    return { providerId: 'arp', pid, downloadedFiles: files }
  }
}

module.exports = { ArpSyncOperation, CHECKPOINT_COMMAND }

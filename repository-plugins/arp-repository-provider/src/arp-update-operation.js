// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const { ArpCreateOperation } = require('./arp-create-operation')

const CHECKPOINT_COMMAND = 'rockit.repositories.checkpointUpdateExport'

class ArpUpdateOperation extends ArpCreateOperation {
  async execute(input, progress = { report() {} }) {
    const repository = this.object(input?.repository)
    if (input?.phase === 'loadRemote') {
      const pid = input?.pid
      if (!repository?.baseUrl || typeof pid !== 'string' || !pid.trim()) {
        throw new Error('ARP remote update inspection requires a repository and PID.')
      }
      progress.report({ message: 'Loading remote ARP RO-Crate...' })
      const response = await this.clientFactory(repository).getRoCrate(pid)
      this.requireSuccess(response, 'ARP RO-Crate lookup')
      const remoteCrate = this.findCrate(response.payload)
      if (!remoteCrate) {
        throw new Error('The ARP RO-Crate response did not contain a valid @graph.')
      }
      return { providerId: 'arp', pid, remoteCrate }
    }
    const plan = this.object(input?.plan)
    const pid = plan?.pid
    const operationId = input?.operationId
    const uploadCrate = this.cloneCrate(plan?.uploadCrate)
    const remoteCrate = this.cloneCrate(plan?.remoteCrate)
    const uploadIdMapping = this.object(plan?.uploadIdMapping)
    const addedFiles = plan?.addedFiles
    const changedFiles = plan?.changedFiles
    const removedFiles = plan?.removedFiles
    if (!repository?.baseUrl || typeof pid !== 'string' || !pid.trim() ||
        typeof operationId !== 'string' || !operationId.trim() || !uploadCrate || !remoteCrate ||
        !uploadIdMapping || !Array.isArray(addedFiles) || !Array.isArray(changedFiles) ||
        !Array.isArray(removedFiles)) {
      throw new Error('ARP update requires a repository, PID, prepared crate, mapping, file diff, and operation ID.')
    }

    const client = this.clientFactory(repository)
    const mapping = { ...uploadIdMapping }
    const fileResults = []
    const removedRemoteIds = []
    const totalSteps = addedFiles.length + changedFiles.length + removedFiles.length + 1
    let completedSteps = 0

    for (const file of addedFiles) {
      this.requireFilePlan(file, false)
      progress.report({ message: `Uploading ${file.entryPath}...`, completedSteps, totalSteps })
      const content = await this.readSource(file.sourceUri)
      const response = await client.uploadFile(pid, file.entryPath, content)
      const result = this.fileResult(
        response, file, mapping, remoteCrate, repository.baseUrl, pid, 'added')
      this.applyFileResult(uploadCrate, mapping, result)
      fileResults.push(result)
      await this.checkpointUpdate(operationId, pid, 'fileUploaded', result)
      completedSteps += 1
    }

    for (const file of changedFiles) {
      this.requireFilePlan(file, true)
      progress.report({ message: `Replacing ${file.entryPath}...`, completedSteps, totalSteps })
      const content = await this.readSource(file.sourceUri)
      const response = await client.replaceFile(
        file.remoteFileId, file.entryPath, file.description, content)
      const result = this.fileResult(
        response, file, mapping, remoteCrate, repository.baseUrl, pid, 'changed')
      this.applyFileResult(uploadCrate, mapping, result)
      fileResults.push(result)
      await this.checkpointUpdate(operationId, pid, 'fileReplaced', result)
      completedSteps += 1
    }

    for (const file of removedFiles) {
      if (!this.object(file) || typeof file.remoteId !== 'string' || !file.remoteId.trim() ||
          (typeof file.remoteFileId !== 'string' && typeof file.remoteFileId !== 'number')) {
        throw new Error('ARP update contains an invalid removed-file entry.')
      }
      progress.report({ message: `Removing ${file.remoteId}...`, completedSteps, totalSteps })
      const response = await client.deleteFile(file.remoteFileId)
      this.requireSuccess(response, `Dataverse deletion of '${file.remoteId}'`)
      this.removeMappingEntries(mapping, file.remoteId)
      removedRemoteIds.push(file.remoteId)
      await this.checkpointUpdate(operationId, pid, 'fileRemoved', undefined, file.remoteId)
      completedSteps += 1
    }

    progress.report({ message: 'Synchronizing RO-Crate metadata...', completedSteps, totalSteps })
    const metadataUpdateCrate = this.rewriteIds(uploadCrate, mapping)
    const update = await client.updateRoCrate(pid, metadataUpdateCrate)
    this.requireSuccess(update, 'ARP RO-Crate metadata update')
    const processedRemoteCrate = this.findCrate(update.payload)
    if (!processedRemoteCrate) {
      throw new Error('ARP updated the metadata but did not return the stored RO-Crate @graph.')
    }

    progress.report({ message: 'Synchronization complete.', completedSteps: totalSteps, totalSteps })
    return {
      providerId: 'arp', pid, processedRemoteCrate, uploadCrate,
      uploadIdMapping: mapping, fileResults, removedRemoteIds,
    }
  }

  cloneCrate(value) {
    const crate = this.object(value)
    return crate && Array.isArray(crate['@graph']) ? JSON.parse(JSON.stringify(crate)) : undefined
  }

  requireFilePlan(file, replacement) {
    if (!this.object(file) || typeof file.metadataEntityId !== 'string' ||
        typeof file.uploadEntityId !== 'string' || typeof file.entryPath !== 'string' ||
        typeof file.sourceUri !== 'string' ||
        (replacement && typeof file.remoteFileId !== 'string' && typeof file.remoteFileId !== 'number')) {
      throw new Error(`ARP update contains an invalid ${replacement ? 'replacement' : 'new'}-file entry.`)
    }
  }

  readSource(sourceUri) {
    return this.vscode.workspace.fs.readFile(this.vscode.Uri.parse(sourceUri))
  }

  fileResult(response, file, mapping, remoteCrate, baseUrl, pid, kind) {
    this.requireSuccess(response, `Dataverse ${kind === 'added' ? 'upload' : 'replacement'} of '${file.entryPath}'`)
    const fileId = this.findUploadedFileId(response.payload)
    if (!fileId) {
      throw new Error(`Dataverse ${kind === 'added' ? 'uploaded' : 'replaced'} '${file.entryPath}' but did not return a dataFile.id.`)
    }
    const md5 = this.findMd5(response.payload)
    return {
      kind,
      metadataEntityId: file.metadataEntityId,
      uploadEntityId: file.uploadEntityId,
      entryPath: file.entryPath,
      remoteId: this.updatedFileEntityId(fileId, mapping, remoteCrate, baseUrl, pid),
      ...(md5 ? { md5 } : {}),
      lastModified: file.lastModified,
      sourceSize: file.sourceSize,
    }
  }

  updatedFileEntityId(fileId, mapping, remoteCrate, baseUrl, pid) {
    if (!/^\d+$/.test(fileId)) return fileId
    const remoteFileIds = remoteCrate['@graph']
      .filter(entity => {
        const types = Array.isArray(entity?.['@type']) ? entity['@type'] : [entity?.['@type']]
        return types.includes('File')
      })
      .map(entity => entity?.['@id'])
      .filter(id => typeof id === 'string')
    for (const candidate of [...Object.values(mapping), ...remoteFileIds]) {
      const match = candidate.match(/^(.*\/file\/)\d+$/)
      if (match) return `${match[1]}${fileId}`
    }
    return this.arpFileEntityId(fileId, mapping, baseUrl, pid)
  }

  applyFileResult(crate, mapping, result) {
    mapping[result.uploadEntityId] = result.remoteId
    const entity = crate['@graph'].find(item => item?.['@id'] === result.uploadEntityId)
    if (entity && result.md5) entity.hash = result.md5
  }

  removeMappingEntries(mapping, remoteId) {
    for (const [localId, mappedId] of Object.entries(mapping)) {
      if (mappedId === remoteId) delete mapping[localId]
    }
  }

  checkpointUpdate(operationId, pid, stage, fileResult, remoteId) {
    return this.vscode.commands.executeCommand(CHECKPOINT_COMMAND, {
      operationId, providerId: 'arp', stage, pid,
      ...(fileResult ? { fileResult } : {}),
      ...(remoteId ? { remoteId } : {}),
    })
  }
}

module.exports = { ArpUpdateOperation, CHECKPOINT_COMMAND }

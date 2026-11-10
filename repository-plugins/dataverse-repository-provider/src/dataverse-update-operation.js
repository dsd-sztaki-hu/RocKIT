// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const { DataverseCreateOperation } = require('./dataverse-create-operation')

const CHECKPOINT_COMMAND = 'rockit.repositories.checkpointUpdateExport'

class DataverseUpdateOperation extends DataverseCreateOperation {
  async execute(input, progress = { report() {} }) {
    const repository = this.object(input?.repository)
    const persistentId = this.text(input?.persistentId ?? input?.plan?.persistentId)
    if (!repository?.baseUrl || !persistentId) {
      throw new Error('Dataverse update requires a repository and persistent ID.')
    }
    const client = this.clientFactory(repository)
    if (input?.phase === 'inspect') {
      return this.inspect(client, persistentId, progress)
    }
    if (input?.phase !== 'apply') {
      throw new Error("Dataverse update phase must be either 'inspect' or 'apply'.")
    }
    return this.apply(client, input, persistentId, progress)
  }

  async inspect(client, persistentId, progress) {
    progress.report({ message: `Loading Dataverse draft ${persistentId}...` })
    const version = await client.getDatasetVersion(persistentId)
    this.requireSuccess(version, 'Dataverse draft lookup')
    const datasetVersionData = this.object(version.payload?.data)
    if (!datasetVersionData) {
      throw new Error('The Dataverse draft response did not contain dataset data.')
    }
    const draftFiles = this.extractDraftFiles(datasetVersionData)
    const metadataFile = draftFiles.find(
      (file) => file.label === 'ro-crate-metadata.json',
    )
    if (!metadataFile) {
      throw new Error('The Dataverse draft does not contain ro-crate-metadata.json.')
    }
    const metadata = await client.downloadJsonFile(metadataFile.id)
    this.requireSuccess(metadata, 'Dataverse RO-Crate metadata download')
    const remoteMetadataCrate = this.object(metadata.payload)
    if (!remoteMetadataCrate || !Array.isArray(remoteMetadataCrate['@graph'])) {
      throw new Error('The remote ro-crate-metadata.json does not contain an @graph.')
    }
    return {
      providerId: 'dataverse',
      persistentId,
      datasetVersionData,
      draftFiles,
      metadataFileId: metadataFile.id,
      remoteMetadataCrate,
    }
  }

  async apply(client, input, persistentId, progress) {
    const plan = this.object(input?.plan)
    const operationId = this.text(input?.operationId)
    const metadataCrate = this.object(plan?.metadataCrate)
    const mapping = this.object(plan?.mapping)
    const originalToUploadIds = this.object(plan?.originalToUploadIds) || {}
    const addedFiles = plan?.addedFiles
    const changedFiles = plan?.changedFiles
    const removedFiles = plan?.removedFiles
    const metadataFileId = this.text(plan?.metadataFileId)
    if (
      !operationId ||
      !metadataCrate ||
      !Array.isArray(metadataCrate['@graph']) ||
      !mapping ||
      !Array.isArray(addedFiles) ||
      !Array.isArray(changedFiles) ||
      !Array.isArray(removedFiles) ||
      !metadataFileId
    ) {
      throw new Error('Dataverse update requires a complete RocKIT update plan.')
    }

    const nextMapping = { ...mapping }
    const fileResults = []
    const nativeLicensePayload = this.object(plan.nativeLicensePayload)
    const datasetId = this.text(plan.datasetId)
    if (nativeLicensePayload && !datasetId) {
      throw new Error('Dataverse license update requires the numeric dataset ID.')
    }
    const totalSteps = addedFiles.length + changedFiles.length + removedFiles.length + 2 +
      (nativeLicensePayload ? 1 : 0)
    let completedSteps = 0
    for (const file of addedFiles) {
      const result = await this.transferFile(
        client,
        persistentId,
        file,
        false,
        progress,
        completedSteps,
        totalSteps,
      )
      nextMapping[result.localFileId] = result.remoteId
      fileResults.push(result)
      await this.checkpoint(operationId, persistentId, 'fileUploaded', {
        fileResult: result,
      })
      completedSteps += 1
    }
    for (const file of changedFiles) {
      const result = await this.transferFile(
        client,
        persistentId,
        file,
        true,
        progress,
        completedSteps,
        totalSteps,
      )
      nextMapping[result.localFileId] = result.remoteId
      fileResults.push(result)
      await this.checkpoint(operationId, persistentId, 'fileReplaced', {
        fileResult: result,
      })
      completedSteps += 1
    }
    for (const file of removedFiles) {
      const remoteFileId = this.text(file?.remoteFileId)
      if (!remoteFileId)
        throw new Error('Dataverse update contains an invalid removed file.')
      progress.report({
        message: `Removing remote file ${remoteFileId}...`,
        completedSteps,
        totalSteps,
      })
      const deleted = await client.deleteFile(remoteFileId)
      this.requireSuccess(deleted, `Dataverse deletion of file '${remoteFileId}'`)
      this.removeMappingValue(nextMapping, remoteFileId)
      await this.checkpoint(operationId, persistentId, 'fileRemoved', { remoteFileId })
      completedSteps += 1
    }

    progress.report({
      message: 'Synchronizing ro-crate-metadata.json...',
      completedSteps,
      totalSteps,
    })
    const rewrittenCrate = JSON.parse(JSON.stringify(metadataCrate))
    for (const [localId, remoteId] of Object.entries(nextMapping)) {
      if (!this.text(remoteId) || localId === 'ro-crate-metadata.json') continue
      this.rewriteIdReferences(
        rewrittenCrate,
        originalToUploadIds[localId] || localId,
        remoteId,
      )
    }
    const metadataReplacement = await client.replaceFile(
      metadataFileId,
      'ro-crate-metadata.json',
      new TextEncoder().encode(`${JSON.stringify(rewrittenCrate, null, 2)}\n`),
    )
    this.requireSuccess(metadataReplacement, 'Dataverse RO-Crate metadata replacement')
    const metadataRemoteId =
      this.findDataFileId(metadataReplacement.payload) || metadataFileId
    await this.checkpoint(operationId, persistentId, 'metadataReplaced', {
      metadataRemoteId,
    })
    completedSteps += 1

    if (this.object(plan.nativeMetadataPayload)) {
      progress.report({
        message: 'Updating Dataverse dataset metadata...',
        completedSteps,
        totalSteps,
      })
      const updated = await client.updateDraftMetadata(
        persistentId,
        plan.nativeMetadataPayload,
      )
      this.requireSuccess(updated, 'Dataverse dataset metadata update')
      completedSteps += 1
    }
    if (nativeLicensePayload) {
      progress.report({
        message: 'Updating Dataverse dataset license...',
        completedSteps,
        totalSteps,
      })
      const updated = await client.updateDatasetLicense(datasetId, nativeLicensePayload)
      this.requireSuccess(updated, 'Dataverse dataset license update')
    }
    return {
      providerId: 'dataverse',
      persistentId,
      fileResults,
      removedRemoteFileIds: removedFiles.map((file) => String(file.remoteFileId)),
      metadataRemoteId,
    }
  }

  async transferFile(
    client,
    persistentId,
    file,
    replacement,
    progress,
    completedSteps,
    totalSteps,
  ) {
    const localFileId = this.text(file?.localFileId)
    const entryPath = this.text(file?.entryPath)
    const sourceUri = this.text(file?.sourceUri)
    const previousRemoteId = this.text(file?.remoteFileId)
    if (!localFileId || !entryPath || !sourceUri || (replacement && !previousRemoteId)) {
      throw new Error(
        `Dataverse update contains an invalid ${replacement ? 'replacement' : 'new'} file.`,
      )
    }
    progress.report({
      message: `${replacement ? 'Replacing' : 'Uploading'} ${entryPath}...`,
      completedSteps,
      totalSteps,
    })
    const content = await this.vscode.workspace.fs.readFile(
      this.vscode.Uri.parse(sourceUri),
    )
    const response = replacement
      ? await client.replaceFile(previousRemoteId, entryPath, content)
      : await client.uploadFile(persistentId, entryPath, content)
    this.requireSuccess(
      response,
      `Dataverse ${replacement ? 'replacement' : 'upload'} of '${entryPath}'`,
    )
    const remoteId = this.findDataFileId(response.payload) || previousRemoteId
    if (!remoteId)
      throw new Error(`Dataverse did not return a dataFile.id for '${entryPath}'.`)
    return {
      kind: replacement ? 'changed' : 'added',
      localFileId,
      entryPath,
      remoteId,
      md5: this.findMd5(response.payload),
      lastModified: file.lastModified,
      sourceSize: file.sourceSize,
    }
  }

  checkpoint(operationId, persistentId, stage, extra) {
    return this.vscode.commands.executeCommand(CHECKPOINT_COMMAND, {
      operationId,
      providerId: 'dataverse',
      persistentId,
      stage,
      ...extra,
    })
  }

  extractDraftFiles(value) {
    if (Array.isArray(value)) return value.flatMap((item) => this.extractDraftFiles(item))
    const record = this.object(value)
    if (!record) return []
    const dataFile = this.object(record.dataFile)
    if (dataFile) {
      const id = this.text(dataFile.id)
      const label = this.text(record.label) || this.text(dataFile.filename)
      if (id && label) {
        const checksum = this.object(dataFile.checksum)
        return [
          {
            id,
            label,
            persistentId: this.text(dataFile.persistentId),
            md5:
              this.text(dataFile.md5) ||
              (this.text(checksum?.type)?.toLowerCase() === 'md5'
                ? this.text(checksum?.value)
                : undefined),
            size: Number(dataFile.filesize ?? dataFile.contentSize) || undefined,
          },
        ]
      }
    }
    return Object.values(record).flatMap((child) => this.extractDraftFiles(child))
  }

  removeMappingValue(mapping, remoteId) {
    for (const [localId, value] of Object.entries(mapping)) {
      if (value === remoteId) delete mapping[localId]
    }
  }
}

module.exports = { DataverseUpdateOperation, CHECKPOINT_COMMAND }

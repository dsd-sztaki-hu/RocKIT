// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const CHECKPOINT_COMMAND = 'rockit.repositories.checkpointCreateExport'

class DataverseCreateOperation {
  constructor({ vscode, clientFactory }) {
    this.vscode = vscode
    this.clientFactory = clientFactory
  }

  async execute(input, progress = { report() {} }) {
    const repository = this.object(input?.repository)
    const plan = this.object(input?.plan)
    const metadataCrate = this.object(plan?.metadataCrate)
    const fileSources = plan?.fileSources
    const payload = this.object(input?.datasetCreationPayload)
    const collectionId = this.text(input?.collectionId)
    const operationId = this.text(input?.operationId)
    if (
      !repository?.baseUrl ||
      !metadataCrate ||
      !Array.isArray(metadataCrate['@graph']) ||
      !Array.isArray(fileSources) ||
      !payload ||
      !collectionId ||
      !operationId
    ) {
      throw new Error(
        'Dataverse creation requires a repository, mapped metadata, file manifest, collection, dataset payload, and operation ID.',
      )
    }

    const client = this.clientFactory(repository)
    progress.report({ message: `Creating Dataverse dataset in ${collectionId}...` })
    const creation = await client.createDataset(collectionId, payload)
    this.requireSuccess(creation, 'Dataverse dataset creation')
    const persistentId = this.findPersistentId(creation.payload)
    if (!persistentId) {
      throw new Error(
        'Dataverse created the dataset but did not return its persistent ID.',
      )
    }
    const datasetId = this.findDatasetId(creation.payload)
    const fileResults = []
    try {
      await this.checkpoint({
        operationId,
        providerId: 'dataverse',
        stage: 'datasetCreated',
        persistentId,
        creationResponse: creation.payload,
      })
      for (const source of fileSources) {
        const entryPath = this.text(source?.entryPath)
        const sourceUri = this.text(source?.sourceUri)
        const localFileId = this.text(source?.localFileId)
        if (!entryPath || !sourceUri || !localFileId) {
          throw new Error('The Dataverse export contains an invalid file source.')
        }
        progress.report({ message: `Uploading ${entryPath}...` })
        const content = await this.vscode.workspace.fs.readFile(
          this.vscode.Uri.parse(sourceUri),
        )
        const uploaded = await client.uploadFile(persistentId, entryPath, content)
        this.requireSuccess(uploaded, `Dataverse upload of '${entryPath}'`)
        const remoteId = this.findDataFileId(uploaded.payload)
        if (!remoteId) {
          throw new Error(
            `Dataverse uploaded '${entryPath}' but did not return a dataFile.id.`,
          )
        }
        const result = {
          entryPath,
          localFileId,
          remoteId,
          fileName: this.baseName(entryPath),
          directoryLabel: this.directoryName(entryPath),
          md5: this.findMd5(uploaded.payload),
          lastModified: source.lastModified,
          sourceSize: source.sourceSize,
          response: uploaded.payload,
        }
        fileResults.push(result)
        await this.checkpoint({
          operationId,
          providerId: 'dataverse',
          stage: 'fileUploaded',
          persistentId,
          fileResult: result,
        })
      }

      progress.report({ message: 'Uploading rewritten ro-crate-metadata.json...' })
      const rewrittenCrate = this.rewriteMetadataCrate(
        metadataCrate,
        fileResults,
        this.object(plan.originalToUploadIds) || {},
      )
      const metadataUpload = await client.uploadFile(
        persistentId,
        'ro-crate-metadata.json',
        new TextEncoder().encode(`${JSON.stringify(rewrittenCrate, null, 2)}\n`),
      )
      this.requireSuccess(metadataUpload, 'Dataverse RO-Crate metadata upload')
      const metadataRemoteId = this.findDataFileId(metadataUpload.payload)
      if (!metadataRemoteId) {
        throw new Error(
          'Dataverse uploaded ro-crate-metadata.json but did not return a dataFile.id.',
        )
      }
      await this.checkpoint({
        operationId,
        providerId: 'dataverse',
        stage: 'metadataUploaded',
        persistentId,
        metadataRemoteId,
      })
      return {
        providerId: 'dataverse',
        persistentId,
        datasetId,
        creationResponse: creation.payload,
        fileResults,
        metadataRemoteId,
        metadataResponse: metadataUpload.payload,
      }
    } catch (error) {
      return {
        providerId: 'dataverse',
        interrupted: true,
        persistentId,
        datasetId,
        creationResponse: creation.payload,
        fileResults,
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  }

  checkpoint(value) {
    return this.vscode.commands.executeCommand(CHECKPOINT_COMMAND, value)
  }

  rewriteMetadataCrate(metadataCrate, fileResults, originalToUploadIds) {
    const crate = JSON.parse(JSON.stringify(metadataCrate))
    for (const file of fileResults) {
      const uploadId = originalToUploadIds[file.localFileId] || file.localFileId
      const entity = crate['@graph'].find((candidate) => candidate?.['@id'] === uploadId)
      if (entity) {
        entity.name = file.fileName
        if (file.directoryLabel) entity.directoryLabel = file.directoryLabel
        else delete entity.directoryLabel
      }
      this.rewriteIdReferences(crate, uploadId, file.remoteId)
    }
    return crate
  }

  rewriteIdReferences(value, oldId, newId) {
    if (Array.isArray(value))
      return value.forEach((item) => this.rewriteIdReferences(item, oldId, newId))
    if (!this.object(value)) return
    for (const [key, child] of Object.entries(value)) {
      if (key === '@id' && child === oldId) value[key] = newId
      else this.rewriteIdReferences(child, oldId, newId)
    }
  }

  requireSuccess(result, action) {
    if (!result?.ok || this.object(result.payload)?.status === 'ERROR') {
      const message = this.text(this.object(result?.payload)?.message)
      throw new Error(
        `${action} failed (${result?.status ?? 'unknown'}) at ${result?.url ?? 'Dataverse'}${message ? `: ${message}` : ''}.`,
      )
    }
  }

  findPersistentId(value) {
    return this.findValue(value, ['persistentId', 'global_id', 'globalId', 'pid'])
  }

  findDatasetId(value) {
    const found = this.findValue(value, ['id'])
    return found && /^\d+$/.test(found) ? Number(found) : undefined
  }

  findDataFileId(value) {
    if (Array.isArray(value))
      return value.map((item) => this.findDataFileId(item)).find(Boolean)
    const record = this.object(value)
    if (!record) return undefined
    const dataFile = this.object(record.dataFile)
    const direct = this.text(dataFile?.id)
    if (direct) return direct
    return Object.values(record)
      .map((child) => this.findDataFileId(child))
      .find(Boolean)
  }

  findValue(value, keys) {
    if (Array.isArray(value))
      return value.map((item) => this.findValue(item, keys)).find(Boolean)
    const record = this.object(value)
    if (!record) return undefined
    for (const key of keys) {
      const direct = this.text(record[key])
      if (direct) return direct
    }
    return Object.values(record)
      .map((child) => this.findValue(child, keys))
      .find(Boolean)
  }

  findMd5(value) {
    if (Array.isArray(value)) return value.map((item) => this.findMd5(item)).find(Boolean)
    const record = this.object(value)
    if (!record) return undefined
    const direct = this.text(record.md5)?.replace(/^md5:/i, '').toLowerCase()
    if (direct) return direct
    const checksum = this.object(record.checksum)
    if (this.text(checksum?.type)?.toLowerCase() === 'md5') {
      return this.text(checksum.value)?.replace(/^md5:/i, '').toLowerCase()
    }
    return Object.values(record)
      .map((child) => this.findMd5(child))
      .find(Boolean)
  }

  baseName(path) {
    return path.replace(/\\/g, '/').split('/').at(-1)
  }

  directoryName(path) {
    const normalized = path.replace(/\\/g, '/')
    const separator = normalized.lastIndexOf('/')
    return separator === -1 ? undefined : normalized.slice(0, separator)
  }

  text(value) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    return undefined
  }

  object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  }
}

module.exports = { DataverseCreateOperation, CHECKPOINT_COMMAND }

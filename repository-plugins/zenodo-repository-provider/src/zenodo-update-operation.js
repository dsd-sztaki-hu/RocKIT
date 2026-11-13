// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const { createHash } = require('node:crypto')

const { ZenodoCreateOperation } = require('./zenodo-create-operation')

/**
 * Updates a writable Zenodo draft.
 *
 * Extending the create operation intentionally reuses its workspace, path-safety,
 * upload-file, mapping, and export-log helpers. The remote update algorithm is
 * separate and performs a filename/checksum reconciliation before mutating files.
 */
class ZenodoUpdateOperation extends ZenodoCreateOperation {
  async execute(input, progress = { report() {} }) {
    const repository = input?.repository
    const exportTarget = input?.exportTarget
    if (!repository || typeof repository !== 'object') {
      throw new Error('The Zenodo repository configuration is missing.')
    }
    if (!exportTarget?.pid || !exportTarget?.mappingFile) {
      throw new Error('Select an existing Zenodo draft before updating it.')
    }
    if (!this.safeMappingFile(exportTarget.mappingFile)) {
      throw new Error('The selected Zenodo mapping filename is invalid.')
    }

    const rootUri = this.workspaceRoot()
    progress.report({ message: 'Reading RO-Crate and loading Zenodo draft...' })
    const crateBytes = await this.readFile(
      this.vscode.Uri.joinPath(rootUri, 'ro-crate-metadata.json'),
      'The workspace does not contain ro-crate-metadata.json.',
    )
    const crate = this.parseCrate(crateBytes)
    const upload = await this.uploadPackage.prepare(rootUri, crate)
    const uploadFiles = upload.files
    const client = this.clientFactory(repository)
    const deposition = await client.getDeposition(exportTarget.pid)
    if (this.isPublished(deposition)) {
      throw new Error('Published Zenodo records cannot be updated from RocKIT.')
    }

    const depositionId = this.depositionId(deposition) || String(exportTarget.pid)
    const bucketUrl = this.link(deposition, 'bucket')
    if (!bucketUrl) {
      throw new Error('Zenodo did not return a writable bucket for the selected draft.')
    }
    const metadata = this.updateMetadata(
      this.requirePreparedMetadata(input?.repositoryMetadata),
      deposition,
    )
    const remoteFiles = this.normalizeRemoteFiles(
      await client.listDepositionFiles(depositionId),
    )
    const plan = this.reconciliationPlan(uploadFiles, remoteFiles)
    const mapping = {}

    for (const { local, remote } of plan.unchanged) {
      mapping[local.entityId] = remote.id || remote.filename
    }
    for (const remote of plan.removed) {
      progress.report({ message: `Removing ${remote.filename}...` })
      await client.deleteFile(depositionId, remote.id)
    }
    for (const { local, remote } of plan.replaced) {
      progress.report({ message: `Replacing ${local.filename}...` })
      await client.deleteFile(depositionId, remote.id)
      const response = await client.uploadFile(bucketUrl, local.filename, local.content)
      mapping[local.entityId] = this.uploadedFileId(response) ?? ''
    }
    for (const local of plan.added) {
      progress.report({ message: `Uploading ${local.filename}...` })
      const response = await client.uploadFile(bucketUrl, local.filename, local.content)
      mapping[local.entityId] = this.uploadedFileId(response) ?? ''
    }

    progress.report({ message: 'Updating Zenodo metadata...' })
    await client.updateDepositionMetadata(
      depositionId,
      metadata,
      this.link(deposition, 'self'),
    )

    const target =
      this.link(deposition, 'html') ||
      this.link(deposition, 'latest_draft_html') ||
      exportTarget.target ||
      `${this.normalizeBaseUrl(repository.baseUrl)}/deposit/${encodeURIComponent(depositionId)}`
    await this.persistUpdateState({
      rootUri,
      repository,
      exportTarget,
      depositionId,
      target,
      mapping,
      crate,
      crosswalkId: input?.crosswalkId,
    })
    progress.report({ message: 'Zenodo update complete.' })

    return {
      providerId: 'zenodo',
      remoteId: depositionId,
      state: 'draft',
      landingPage: target,
      mappingFile: exportTarget.mappingFile,
      addedFileCount: plan.added.length,
      replacedFileCount: plan.replaced.length,
      removedFileCount: plan.removed.length,
      unchangedFileCount: plan.unchanged.length,
    }
  }

  updateMetadata(preparedMetadata, deposition) {
    const metadata = { ...preparedMetadata }
    const existing = this.object(this.object(deposition)?.metadata) || {}
    for (const field of ['access_right', 'license', 'embargo_date', 'access_conditions']) {
      if (Object.prototype.hasOwnProperty.call(existing, field)) {
        metadata[field] = existing[field]
      } else {
        delete metadata[field]
      }
    }
    return metadata
  }

  normalizeRemoteFiles(payload) {
    if (!Array.isArray(payload)) {
      throw new Error('Zenodo returned an invalid deposition file list.')
    }
    return payload.map((entry) => {
      const record = this.object(entry)
      const filename =
        this.text(record?.filename) || this.text(record?.name) || this.text(record?.key)
      const id = this.text(record?.id)
      if (!filename || !id) {
        throw new Error('Zenodo returned a deposition file without a filename or id.')
      }
      const sizeValue = record.size ?? record.filesize
      return {
        id,
        filename,
        checksum: this.normalizeChecksum(this.text(record.checksum)),
        size:
          typeof sizeValue === 'number' && Number.isFinite(sizeValue)
            ? sizeValue
            : undefined,
      }
    })
  }

  reconciliationPlan(localFiles, remoteFiles) {
    const remoteByFilename = new Map(remoteFiles.map((file) => [file.filename, file]))
    const localNames = new Set(localFiles.map((file) => file.filename))
    const added = []
    const replaced = []
    const unchanged = []

    for (const local of localFiles) {
      const remote = remoteByFilename.get(local.filename)
      if (!remote) {
        added.push(local)
      } else if (this.sameContent(local.content, remote)) {
        unchanged.push({ local, remote })
      } else {
        replaced.push({ local, remote })
      }
    }
    const removed = remoteFiles.filter((file) => !localNames.has(file.filename))
    return { added, replaced, unchanged, removed }
  }

  sameContent(content, remote) {
    if (typeof remote.checksum !== 'string') {
      return false
    }
    const bytes = Buffer.from(content.buffer, content.byteOffset, content.byteLength)
    return (
      (remote.size === undefined || remote.size === bytes.byteLength) &&
      createHash('md5').update(bytes).digest('hex') === remote.checksum
    )
  }

  normalizeChecksum(value) {
    if (!value) {
      return undefined
    }
    return value.replace(/^md5:/i, '').trim().toLowerCase() || undefined
  }

  isPublished(payload) {
    const record = this.object(payload)
    return record?.submitted === true || record?.state === 'done'
  }

  async persistUpdateState({
    rootUri,
    repository,
    exportTarget,
    depositionId,
    target,
    mapping,
    crate,
    crosswalkId,
  }) {
    const rockitUri = this.vscode.Uri.joinPath(rootUri, '.rockit')
    await this.vscode.workspace.fs.createDirectory(rockitUri)
    await this.writeJson(
      this.vscode.Uri.joinPath(rockitUri, exportTarget.mappingFile),
      mapping,
    )
    const logUri = this.vscode.Uri.joinPath(rockitUri, 'export-log.json')
    const entries = await this.readExportLog(logUri)
    entries.push({
      pid: depositionId,
      target,
      repository: this.normalizeBaseUrl(repository.baseUrl),
      mappingFile: exportTarget.mappingFile,
      crosswalkFile: crosswalkId,
      syncType: 'update',
      remoteState: 'draft',
      status: 'success',
      lastSuccessfulActionAt: this.now().toISOString(),
      datasetName: this.rootDatasetName(crate),
    })
    await this.writeJson(logUri, entries)
  }

  safeMappingFile(value) {
    return (
      typeof value === 'string' &&
      /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(value) &&
      !value.includes('..')
    )
  }

  text(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }

  object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  }
}

module.exports = { ZenodoUpdateOperation }

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const { ZenodoMetadataPreparation } = require('./zenodo-metadata-preparation')
const { METADATA_FILE, ZenodoUploadPackage } = require('./zenodo-upload-package')

const CROSSWALK_FILE = 'arp-zenodo-crosswalk.json'

class ZenodoCreateOperation {
  constructor({
    vscode,
    clientFactory,
    metadataPreparation = new ZenodoMetadataPreparation({ vscode }),
    uploadPackage = new ZenodoUploadPackage({ vscode }),
    now = () => new Date(),
  }) {
    this.vscode = vscode
    this.clientFactory = clientFactory
    this.metadataPreparation = metadataPreparation
    this.uploadPackage = uploadPackage
    this.now = now
  }

  async execute(input, progress = { report() {} }) {
    const repository = input?.repository
    if (!repository || typeof repository !== 'object') {
      throw new Error('The Zenodo repository configuration is missing.')
    }

    const rootUri = this.workspaceRoot()
    progress.report({ message: 'Reading and validating RO-Crate metadata...' })
    const crateBytes = await this.readFile(
      this.vscode.Uri.joinPath(rootUri, METADATA_FILE),
      `The workspace does not contain ${METADATA_FILE}.`,
    )
    const crate = this.parseCrate(crateBytes)
    const client = this.clientFactory(repository)
    const crosswalk = input?.crosswalk?.document
    const metadata = await this.metadataPreparation.prepare(crate, client, crosswalk)
    const upload = await this.uploadPackage.prepare(rootUri, crate)
    const uploadFiles = upload.files

    progress.report({ message: 'Creating Zenodo draft deposition...' })
    const deposition = await client.createDeposition()
    const depositionId = this.depositionId(deposition)
    const bucketUrl = this.link(deposition, 'bucket')
    if (!depositionId || !bucketUrl) {
      throw new Error(
        'Zenodo created a deposition but did not return its id and bucket link.',
      )
    }

    const mapping = {}
    for (const file of uploadFiles) {
      progress.report({ message: `Uploading ${file.filename}...` })
      const response = await client.uploadFile(bucketUrl, file.filename, file.content)
      mapping[file.localFileId || file.entityId] = this.uploadedFileId(response) ?? ''
    }

    progress.report({ message: 'Uploading Zenodo metadata...' })
    await client.updateDepositionMetadata(
      depositionId,
      metadata,
      this.link(deposition, 'self'),
    )

    progress.report({ message: 'Writing local export state...' })
    const target =
      this.link(deposition, 'html') ||
      this.link(deposition, 'latest_draft_html') ||
      `${this.normalizeBaseUrl(repository.baseUrl)}/deposit/${encodeURIComponent(depositionId)}`
    const mappingFile = `zenodo-${this.safeFilePart(depositionId)}-mapping.json`
    await this.persistExportState({
      rootUri,
      mapping,
      mappingFile,
      depositionId,
      repository,
      target,
      crate,
      crosswalkId: input?.crosswalk?.id,
    })

    progress.report({ message: 'Zenodo export complete.' })
    return {
      providerId: 'zenodo',
      remoteId: depositionId,
      state: 'draft',
      landingPage: target,
      mappingFile,
      uploadedFileCount: uploadFiles.length,
    }
  }

  workspaceRoot() {
    const folders = this.vscode.workspace.workspaceFolders
    if (!folders?.length) {
      throw new Error('Open an RO-Crate workspace before exporting to Zenodo.')
    }
    return folders[0].uri
  }

  async readFile(uri, missingMessage) {
    try {
      return await this.vscode.workspace.fs.readFile(uri)
    } catch (error) {
      throw new Error(`${missingMessage} ${this.errorMessage(error)}`.trim())
    }
  }

  parseCrate(bytes) {
    try {
      const crate = JSON.parse(new TextDecoder().decode(bytes))
      if (!crate || typeof crate !== 'object' || !Array.isArray(crate['@graph'])) {
        throw new Error('The JSON does not contain an @graph array.')
      }
      return crate
    } catch (error) {
      throw new Error(`Could not parse ${METADATA_FILE}: ${this.errorMessage(error)}`)
    }
  }

  depositionId(payload) {
    const value = payload && typeof payload === 'object' ? payload.id : undefined
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : undefined
  }

  link(payload, name) {
    if (!payload || typeof payload !== 'object' || !payload.links) {
      return undefined
    }
    const value = payload.links[name]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }

  uploadedFileId(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return undefined
    }
    for (const key of ['id', 'key', 'filename']) {
      const value = payload[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
      if (typeof value === 'number') {
        return String(value)
      }
    }
    return this.link(payload, 'self') || this.link(payload, 'download')
  }

  async persistExportState({
    rootUri,
    mapping,
    mappingFile,
    depositionId,
    repository,
    target,
    crate,
    crosswalkId,
  }) {
    const rockitUri = this.vscode.Uri.joinPath(rootUri, '.rockit')
    await this.vscode.workspace.fs.createDirectory(rockitUri)
    await this.writeJson(this.vscode.Uri.joinPath(rockitUri, mappingFile), mapping)

    const logUri = this.vscode.Uri.joinPath(rockitUri, 'export-log.json')
    const entries = await this.readExportLog(logUri)
    const timestamp = this.now().toISOString()
    entries.push({
      pid: depositionId,
      target,
      repository: this.normalizeBaseUrl(repository.baseUrl),
      mappingFile,
      crosswalkFile: crosswalkId || CROSSWALK_FILE,
      syncType: 'create',
      remoteState: 'draft',
      status: 'success',
      lastSuccessfulActionAt: timestamp,
      datasetName: this.rootDatasetName(crate),
    })
    await this.writeJson(logUri, entries)
  }

  async readExportLog(uri) {
    try {
      const parsed = JSON.parse(
        new TextDecoder().decode(await this.vscode.workspace.fs.readFile(uri)),
      )
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  async writeJson(uri, value) {
    const bytes = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)
    await this.vscode.workspace.fs.writeFile(uri, bytes)
  }

  rootDatasetName(crate) {
    const root = crate['@graph'].find((entity) => entity?.['@id'] === './')
    const value = root?.title ?? root?.name
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }

  normalizeBaseUrl(value) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('A Zenodo base URL is required.')
    }
    return value
      .trim()
      .replace(/\/+$/, '')
      .replace(/\/api$/, '')
  }

  safeFilePart(value) {
    return String(value).replace(/[^a-zA-Z0-9._-]/g, '_')
  }

  errorMessage(error) {
    return error instanceof Error ? error.message : String(error)
  }
}

module.exports = { ZenodoCreateOperation }

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const { randomBytes } = require('node:crypto')

const {
  appendExportLogEvent,
  normalizeExportLogEntries,
  serializeExportLogEntries,
} = require('./export-log')
const { ZenodoCreateOperation } = require('./zenodo-create-operation')

const METADATA_FILE = 'ro-crate-metadata.json'

class ZenodoLinkOperation extends ZenodoCreateOperation {
  constructor(options) {
    super(options)
    this.randomId = options.randomId || (() => randomBytes(8).toString('hex'))
  }

  async execute(input, progress = { report() {} }) {
    const repository = input?.repository
    if (!repository || typeof repository !== 'object') {
      throw new Error('The Zenodo repository configuration is missing.')
    }
    const datasetUrl = this.text(input?.datasetUrl)
    if (!datasetUrl) throw new Error('Enter a Zenodo deposition ID or URL.')
    const depositionId = this.extractDepositionId(datasetUrl, repository.baseUrl)
    if (!depositionId) {
      throw new Error('Could not extract a Zenodo deposition ID from the dataset URL.')
    }
    if (input?.mode !== 'preview' && input?.mode !== 'link') {
      throw new Error("The Zenodo link mode must be either 'preview' or 'link'.")
    }

    const rootUri = this.workspaceRoot()
    const crate = this.parseCrate(
      await this.readFile(
        this.vscode.Uri.joinPath(rootUri, METADATA_FILE),
        `The workspace does not contain ${METADATA_FILE}.`,
      ),
    )
    progress.report({ message: `Loading Zenodo deposition ${depositionId}...` })
    const client = this.clientFactory(repository)
    const deposition = await client.getDeposition(depositionId)
    const remoteFiles = this.normalizeRemoteFiles(
      await client.listDepositionFiles(depositionId),
    )
    const localDatasetTitle = this.rootDatasetName(crate)
    const remoteDatasetTitle = this.text(this.object(deposition)?.metadata?.title)

    if (input.mode === 'preview') {
      return {
        providerId: 'zenodo',
        remoteId: depositionId,
        localDatasetTitle,
        remoteDatasetTitle,
        titleMismatch:
          this.normalizeTitle(localDatasetTitle) !==
          this.normalizeTitle(remoteDatasetTitle),
      }
    }

    progress.report({ message: 'Generating Zenodo entity mapping...' })
    const mapping = this.buildMapping(crate, remoteFiles)
    const mappingFileName =
      (await this.findExistingMappingFile(rootUri, repository.baseUrl, depositionId)) ||
      (await this.createUniqueMappingFile(rootUri))
    await this.writeJson(
      this.vscode.Uri.joinPath(rootUri, '.rockit', mappingFileName),
      mapping,
    )
    const target =
      this.link(deposition, 'html') ||
      this.link(deposition, 'latest_draft_html') ||
      `${this.normalizeBaseUrl(repository.baseUrl)}/deposit/${encodeURIComponent(depositionId)}`
    await this.writeLinkLog(rootUri, {
      pid: depositionId,
      target,
      repository: this.normalizeBaseUrl(repository.baseUrl),
      mappingFile: mappingFileName,
      crosswalkFile: input?.crosswalkId,
      syncType: 'update',
      remoteState: this.isPublished(deposition) ? 'published' : 'draft',
      status: 'success',
      lastSuccessfulActionAt: this.now().toISOString(),
      datasetName: localDatasetTitle || remoteDatasetTitle,
    })

    const unmappedEntityIds = Object.entries(mapping)
      .filter(([, remoteId]) => !remoteId)
      .map(([localId]) => localId)
    return {
      providerId: 'zenodo',
      remoteId: depositionId,
      target,
      repository: this.normalizeBaseUrl(repository.baseUrl),
      mappingFileName,
      mappedEntityCount: Object.keys(mapping).length - unmappedEntityIds.length,
      unmappedEntityIds,
      datasetName: localDatasetTitle || remoteDatasetTitle,
    }
  }

  extractDepositionId(value, baseUrl) {
    const direct = value.match(/^(?:zenodo:)?(\d+)$/i)
    if (direct) return direct[1]
    try {
      const url = new URL(value)
      if (url.origin !== new URL(this.normalizeBaseUrl(baseUrl)).origin) return undefined
      return decodeURIComponent(url.pathname).match(
        /\/(?:deposit|record|uploads)\/(\d+)\/?$/,
      )?.[1]
    } catch {
      return undefined
    }
  }

  normalizeRemoteFiles(payload) {
    if (!Array.isArray(payload)) {
      throw new Error('Zenodo returned an invalid deposition file list.')
    }
    return payload.map((entry) => {
      const record = this.object(entry)
      const filename =
        this.text(record?.filename) || this.text(record?.name) || this.text(record?.key)
      const id =
        this.text(record?.id) ||
        this.text(record?.uuid) ||
        this.text(record?.version_id) ||
        this.text(record?.key) ||
        this.link(record, 'self') ||
        this.link(record, 'download')
      if (!filename || !id) {
        throw new Error('Zenodo returned a deposition file without a filename or id.')
      }
      return { id, filename }
    })
  }

  buildMapping(crate, remoteFiles) {
    const graph = this.graph(crate)
    const fileEntities = graph.filter((entity) => this.isFileEntity(entity))
    const localPaths = Array.from(
      new Set(fileEntities.map((entity) => this.localFilePath(entity)).filter(Boolean)),
    ).sort((left, right) => left.localeCompare(right))
    const filenamesByPath = this.uploadPackage.buildZenodoFilenameMap(localPaths)
    const remoteByFilename = new Map(remoteFiles.map((file) => [file.filename, file.id]))
    const mapping = {}
    const metadataId = remoteByFilename.get(METADATA_FILE)
    if (metadataId) mapping[METADATA_FILE] = metadataId
    for (const entity of fileEntities) {
      const id = this.text(entity['@id'])
      const path = this.localFilePath(entity)
      if (!id || !path) continue
      const filename =
        filenamesByPath.get(path) || this.uploadPackage.sanitizeZenodoFilename(path)
      mapping[id] = remoteByFilename.get(filename) || ''
    }
    return Object.fromEntries(
      Object.entries(mapping).sort(([left], [right]) => left.localeCompare(right)),
    )
  }

  localFilePath(entity) {
    const id = this.text(entity['@id'])
    const workspacePath = this.uploadPackage.workspacePath(id)
    if (workspacePath) return workspacePath
    const name = this.text(entity.name)
    if (!name || name.includes('/') || name.includes('\\')) return undefined
    const directory = this.text(entity.directoryLabel)
      ?.replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '')
    return this.uploadPackage.normalizePackagePath(
      directory ? `${directory}/${name}` : name,
    )
  }

  async findExistingMappingFile(rootUri, repository, depositionId) {
    const entries = normalizeExportLogEntries(
      await this.readExportLog(
        this.vscode.Uri.joinPath(rootUri, '.rockit', 'export-log.json'),
      ),
    )
    const normalizedRepository = this.normalizeBaseUrl(repository).toLowerCase()
    return entries
      .filter(
        (entry) =>
          this.text(entry.pid) === depositionId &&
          this.normalizeBaseUrl(entry.repository).toLowerCase() === normalizedRepository,
      )
      .sort((left, right) =>
        (right.lastSuccessfulActionAt || '').localeCompare(
          left.lastSuccessfulActionAt || '',
        ),
      )[0]?.mappingFile
  }

  async createUniqueMappingFile(rootUri) {
    const rockitUri = this.vscode.Uri.joinPath(rootUri, '.rockit')
    await this.vscode.workspace.fs.createDirectory(rockitUri)
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const filename = `${this.randomId()}.json`
      if (!(await this.exists(this.vscode.Uri.joinPath(rockitUri, filename))))
        return filename
    }
    return `${Date.now()}-${this.randomId()}.json`
  }

  async writeLinkLog(rootUri, entry) {
    const uri = this.vscode.Uri.joinPath(rootUri, '.rockit', 'export-log.json')
    const entries = normalizeExportLogEntries(await this.readExportLog(uri))
    await this.writeJson(
      uri,
      serializeExportLogEntries(appendExportLogEvent(entries, entry)),
    )
  }

  graph(crate) {
    return Array.isArray(crate?.['@graph'])
      ? crate['@graph'].filter((entity) => this.object(entity))
      : []
  }

  isFileEntity(entity) {
    const type = entity['@type']
    return (Array.isArray(type) ? type : [type]).includes('File')
  }

  normalizeTitle(value) {
    return (value || '').trim().replace(/\s+/g, ' ').toLowerCase()
  }

  isPublished(payload) {
    return payload?.submitted === true || payload?.state === 'done'
  }

  async exists(uri) {
    try {
      await this.vscode.workspace.fs.stat(uri)
      return true
    } catch {
      return false
    }
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

module.exports = { ZenodoLinkOperation }

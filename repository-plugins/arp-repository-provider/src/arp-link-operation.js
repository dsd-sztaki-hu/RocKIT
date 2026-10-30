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
const { extendMappingWithMetadataEntities } = require('./ro-crate-metadata-entity-mapping')

const METADATA_FILE = 'ro-crate-metadata.json'

class ArpLinkOperation {
  constructor({ vscode, clientFactory, now = () => new Date(), randomId }) {
    this.vscode = vscode
    this.clientFactory = clientFactory
    this.now = now
    this.randomId = randomId || (() => randomBytes(8).toString('hex'))
  }

  async execute(input, progress = { report() {} }) {
    const repository = this.object(input?.repository)
    if (!repository?.baseUrl) {
      throw new Error('The ARP repository configuration is missing.')
    }
    const datasetUrl = this.text(input?.datasetUrl)
    if (!datasetUrl) throw new Error('Enter an ARP dataset persistent ID or URL.')
    const pid = this.extractDatasetPid(datasetUrl)
    if (!pid) {
      throw new Error('Could not extract an ARP dataset handle or persistent ID from the dataset URL.')
    }
    if (input?.mode !== 'preview' && input?.mode !== 'link') {
      throw new Error("The ARP link mode must be either 'preview' or 'link'.")
    }

    const rootUri = this.workspaceRoot()
    const localCrate = this.parseCrate(await this.readFile(
      this.vscode.Uri.joinPath(rootUri, METADATA_FILE),
      `The workspace does not contain ${METADATA_FILE}.`,
    ))
    progress.report({ message: `Loading ARP dataset ${pid}...` })
    const response = await this.clientFactory(repository).getRoCrate(pid)
    if (!response?.ok || this.object(response.payload)?.status === 'ERROR') {
      const message = this.text(this.object(response?.payload)?.message)
      throw new Error(
        `Failed to retrieve the ARP RO-Crate (${response?.status ?? 'unknown'}) at ${response?.url ?? repository.baseUrl}${message ? `: ${message}` : ''}.`,
      )
    }
    const remoteCrate = this.findCrate(response.payload)
    if (!remoteCrate) {
      throw new Error('The ARP RO-Crate response did not contain a valid @graph.')
    }
    const localDatasetTitle = this.rootDatasetName(localCrate)
    const remoteDatasetTitle = this.rootDatasetName(remoteCrate)

    if (input.mode === 'preview') {
      return {
        providerId: 'arp',
        remoteId: pid,
        localDatasetTitle,
        remoteDatasetTitle,
        titleMismatch: this.normalizeTitle(localDatasetTitle) !==
          this.normalizeTitle(remoteDatasetTitle),
      }
    }

    progress.report({ message: 'Generating ARP entity mapping...' })
    const mapping = this.buildEntityIdMapping(localCrate, remoteCrate)
    const mappingFileName =
      (await this.findExistingMappingFile(rootUri, repository.baseUrl, pid)) ||
      (await this.createUniqueMappingFile(rootUri))
    await this.writeJson(
      this.vscode.Uri.joinPath(rootUri, '.rockit', mappingFileName),
      mapping,
    )
    const target = this.buildDatasetTarget(pid)
    await this.writeLinkLog(rootUri, {
      pid,
      target,
      repository: this.normalizeBaseUrl(repository.baseUrl),
      mappingFile: mappingFileName,
      crosswalkFile: repository.crosswalkId,
      syncType: 'update',
      status: 'success',
      lastSuccessfulActionAt: this.now().toISOString(),
      datasetName: localDatasetTitle || remoteDatasetTitle,
    })

    const unmappedEntityIds = Object.entries(mapping)
      .filter(([, remoteId]) => !remoteId)
      .map(([localId]) => localId)
    return {
      providerId: 'arp',
      remoteId: pid,
      pid,
      target,
      repository: this.normalizeBaseUrl(repository.baseUrl),
      mappingFileName,
      mappedEntityCount: Object.keys(mapping).length - unmappedEntityIds.length,
      unmappedEntityIds,
      datasetName: localDatasetTitle || remoteDatasetTitle,
    }
  }

  buildEntityIdMapping(localCrate, remoteCrate) {
    const remoteFilesByPath = new Map()
    const remoteDatasetsByName = new Map()
    for (const entity of this.graph(remoteCrate)) {
      const id = this.text(entity['@id'])
      if (!id) continue
      if (this.entityTypes(entity).includes('File')) {
        const path = this.filePath(entity)
        if (path) remoteFilesByPath.set(path, id)
      } else if (this.entityTypes(entity).includes('Dataset') && id !== './') {
        const name = this.datasetMatchKey(entity)
        if (name) remoteDatasetsByName.set(name, id)
      }
    }

    const mapping = {}
    for (const entity of this.graph(localCrate)) {
      const id = this.text(entity['@id'])
      if (!id || id === './') continue
      if (this.entityTypes(entity).includes('File')) {
        const path = this.filePath(entity)
        mapping[id] = path ? (remoteFilesByPath.get(path) || '') : ''
      } else if (this.entityTypes(entity).includes('Dataset')) {
        const name = this.datasetMatchKey(entity)
        mapping[id] = name ? (remoteDatasetsByName.get(name) || '') : ''
      }
    }
    return extendMappingWithMetadataEntities(localCrate, remoteCrate, mapping)
  }

  filePath(entity) {
    const idPath = this.localCratePath(this.text(entity['@id']) || '')
    if (idPath) return idPath
    const name = this.text(entity.name)
    if (!name || name.includes('/') || name.includes('\\')) return undefined
    const directory = this.text(entity.directoryLabel)
      ?.replace(/\\/g, '/')
      .replace(/\/+$/, '')
    const path = directory ? `${directory}/${name}` : name
    return this.safeRelativePath(path) ? path : undefined
  }

  localCratePath(id) {
    if (!id || id === './' || id.startsWith('#')) return undefined
    let relative = id
    if (id.startsWith('file://./')) relative = id.slice('file://./'.length)
    else if (id.startsWith('./')) relative = id.slice(2)
    else if (id.includes(':')) return undefined
    return this.safeRelativePath(relative) ? relative.replace(/\\/g, '/') : undefined
  }

  safeRelativePath(value) {
    if (!value || value.includes('\0')) return false
    const normalized = value.replace(/\\/g, '/')
    return !normalized.startsWith('/') && !/^[a-zA-Z]:\//.test(normalized) &&
      !normalized.startsWith('../') && !normalized.includes('/../') && normalized !== '..'
  }

  datasetMatchKey(entity) {
    return (this.text(entity.name) || this.text(entity.title))?.toLowerCase()
  }

  async findExistingMappingFile(rootUri, repository, pid) {
    const entries = normalizeExportLogEntries(await this.readExportLog(
      this.vscode.Uri.joinPath(rootUri, '.rockit', 'export-log.json'),
    ))
    const normalizedRepository = this.normalizeBaseUrl(repository).toLowerCase()
    const normalizedPid = this.normalizePid(pid)
    return entries
      .filter(entry =>
        this.normalizeBaseUrl(entry.repository).toLowerCase() === normalizedRepository &&
        this.normalizePid(entry.pid || entry.target) === normalizedPid)
      .sort((left, right) =>
        (right.lastSuccessfulActionAt || '').localeCompare(left.lastSuccessfulActionAt || ''))[0]
      ?.mappingFile
  }

  async createUniqueMappingFile(rootUri) {
    const rockitUri = this.vscode.Uri.joinPath(rootUri, '.rockit')
    await this.vscode.workspace.fs.createDirectory(rockitUri)
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const filename = `${this.randomId()}.json`
      if (!(await this.exists(this.vscode.Uri.joinPath(rockitUri, filename)))) return filename
    }
    return `${Date.now()}-${this.randomId()}.json`
  }

  async writeLinkLog(rootUri, entry) {
    const uri = this.vscode.Uri.joinPath(rootUri, '.rockit', 'export-log.json')
    const entries = normalizeExportLogEntries(await this.readExportLog(uri))
    await this.writeJson(uri, serializeExportLogEntries(appendExportLogEvent(entries, entry)))
  }

  async readExportLog(uri) {
    try {
      return JSON.parse(new TextDecoder().decode(await this.vscode.workspace.fs.readFile(uri)))
    } catch {
      return []
    }
  }

  async readFile(uri, missingMessage) {
    try {
      return await this.vscode.workspace.fs.readFile(uri)
    } catch {
      throw new Error(missingMessage)
    }
  }

  parseCrate(content) {
    try {
      const crate = JSON.parse(new TextDecoder().decode(content))
      if (!Array.isArray(crate?.['@graph'])) throw new Error('Missing @graph')
      return crate
    } catch (error) {
      throw new Error(`Failed to parse ${METADATA_FILE}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async writeJson(uri, value) {
    await this.vscode.workspace.fs.writeFile(
      uri,
      new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`),
    )
  }

  async exists(uri) {
    try {
      await this.vscode.workspace.fs.stat(uri)
      return true
    } catch {
      return false
    }
  }

  workspaceRoot() {
    const root = this.vscode.workspace.workspaceFolders?.[0]?.uri
    if (!root) throw new Error('No workspace is open.')
    return root
  }

  extractDatasetPid(value) {
    const trimmed = value.trim()
    if (/^(hdl|doi):/i.test(trimmed)) return trimmed
    try {
      const url = new URL(trimmed)
      const persistentId = url.searchParams.get('persistentId')
      if (persistentId?.trim()) return persistentId.trim()
      const path = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      if (url.hostname.toLowerCase() === 'hdl.handle.net' && path) return `hdl:${path}`
      if (url.hostname.toLowerCase() === 'doi.org' && path) return `doi:${path}`
    } catch {
      // Compact identifiers are handled below.
    }
    return trimmed.includes('/') ? undefined : trimmed
  }

  buildDatasetTarget(pid) {
    if (/^https?:\/\//i.test(pid)) return pid
    return /^hdl:/i.test(pid) ? `https://hdl.handle.net/${pid.slice(4)}` : pid
  }

  normalizePid(value) {
    return (this.extractDatasetPid(String(value)) || String(value))
      .replace(/^hdl:/i, '')
      .replace(/^\/+/, '')
      .toLowerCase()
  }

  normalizeBaseUrl(value) {
    const normalized = String(value || '').trim().replace(/\/+$/, '')
    return normalized.endsWith('/api/v1')
      ? normalized.slice(0, -'/api/v1'.length)
      : normalized
  }

  findCrate(value) {
    const record = this.object(value)
    if (!record) return undefined
    if (Array.isArray(record['@graph'])) return record
    const data = this.object(record.data)
    if (Array.isArray(data?.['@graph'])) return data
    const nested = this.object(data?.roCrate)
    return Array.isArray(nested?.['@graph']) ? nested : undefined
  }

  rootDatasetName(crate) {
    const root = this.graph(crate).find(entity => entity['@id'] === './')
    return root ? (this.text(root.title) || this.text(root.name)) : undefined
  }

  normalizeTitle(value) {
    return (value || '').trim().replace(/\s+/g, ' ').toLowerCase()
  }

  graph(crate) {
    return Array.isArray(crate?.['@graph']) ? crate['@graph'].filter(value => this.object(value)) : []
  }

  entityTypes(entity) {
    const value = entity['@type']
    return (Array.isArray(value) ? value : [value]).filter(type => typeof type === 'string')
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

module.exports = { ArpLinkOperation }

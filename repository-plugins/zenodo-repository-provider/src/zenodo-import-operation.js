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
const { ZenodoFileHashStore } = require('./zenodo-file-hash-store')

const METADATA_FILE = 'ro-crate-metadata.json'

class ZenodoImportOperation extends ZenodoCreateOperation {
  constructor(options) {
    super(options)
    this.fileHashStore =
      options.fileHashStore ||
      new ZenodoFileHashStore({ vscode: options.vscode, now: options.now })
    this.randomId = options.randomId || (() => randomBytes(8).toString('hex'))
  }

  async execute(input, progress = { report() {} }) {
    const repository = input?.repository
    if (!repository || typeof repository !== 'object') {
      throw new Error('The Zenodo repository configuration is missing.')
    }
    const recordUrl = await this.recordUrl(input?.recordUrl, repository.baseUrl)
    if (!recordUrl) return { cancelled: true }
    const recordId = this.extractRecordId(recordUrl, repository.baseUrl)
    if (!recordId) {
      throw new Error(
        `Enter a Zenodo upload URL such as ${this.uploadUrlExample(repository.baseUrl)}.`,
      )
    }
    const parentUri = await this.importParent(input?.targetParentUri)
    if (!parentUri) return { cancelled: true }

    progress.report({ message: 'Loading remote Zenodo record...' })
    const client = this.clientFactory(repository)
    const loaded = this.loadRecord(await client.getDeposition(recordId))
    const targetUri = await this.createUniqueImportDirectory(parentUri, recordId)
    const metadataFile = loaded.files.find((file) => file.filename === METADATA_FILE)
    let uploadedCrate
    if (metadataFile) {
      progress.report({ message: `Downloading ${METADATA_FILE}...` })
      uploadedCrate = this.parseCrate(await client.downloadFile(metadataFile.downloadUrl))
    }

    const localPaths = this.buildLocalFilePaths(loaded.files, uploadedCrate)
    for (const file of loaded.files) {
      if (file === metadataFile) continue
      const localPath = localPaths.get(file)
      if (!localPath) continue
      progress.report({ message: `Downloading ${localPath}...` })
      await this.writeRelativeFile(
        targetUri,
        localPath,
        await client.downloadFile(file.downloadUrl),
      )
    }

    progress.report({ message: 'Generating imported RO-Crate metadata...' })
    const crateBase = uploadedCrate || this.createEmptyRoCrate()
    this.addDownloadedFilesToCrate(crateBase, loaded.files, localPaths)
    progress.report({ message: 'Writing local Zenodo link state...' })
    const link = await this.persistImportedRecordLink({
      rootUri: targetUri,
      repository,
      recordId,
      crate: crateBase,
      files: loaded.files,
      localPaths,
      target:
        this.recordHtmlUrl(loaded.payload) ||
        `${this.normalizeBaseUrl(repository.baseUrl)}/deposit/${encodeURIComponent(recordId)}`,
      crosswalkId: input?.crosswalkId,
    })

    return {
      providerId: 'zenodo',
      remoteId: recordId,
      state: this.isPublished(loaded.payload) ? 'published' : 'draft',
      landingPage: link.target,
      mappingFile: link.mappingFile,
      downloadedFileCount: loaded.files.length,
      hasUploadedRoCrateMetadata: Boolean(uploadedCrate),
      importedWorkspaceUri: String(targetUri),
      crate: crateBase,
      repositoryMetadata: this.normalizeRecordMetadata(loaded.metadata),
    }
  }

  async recordUrl(provided, baseUrl) {
    if (typeof provided === 'string' && provided.trim()) return provided.trim()
    return this.vscode.window.showInputBox({
      title: 'Import Zenodo Record',
      prompt: 'Enter the Zenodo upload URL to import',
      placeHolder: this.uploadUrlExample(baseUrl),
      ignoreFocusOut: true,
    })
  }

  async importParent(provided) {
    if (provided) {
      return typeof provided === 'string' ? this.vscode.Uri.parse(provided) : provided
    }
    const selected = await this.vscode.window.showOpenDialog({
      title: 'Select Import Folder',
      openLabel: 'Import Here',
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    })
    return selected?.[0]
  }

  extractRecordId(value, baseUrl) {
    try {
      const url = new URL(value.trim())
      const expected = new URL(this.normalizeBaseUrl(baseUrl))
      if (
        url.protocol !== expected.protocol ||
        url.hostname.toLowerCase() !== expected.hostname.toLowerCase() ||
        url.port !== expected.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        return undefined
      return decodeURIComponent(url.pathname).match(/^\/uploads\/(\d+)\/?$/)?.[1]
    } catch {
      return undefined
    }
  }

  uploadUrlExample(baseUrl) {
    return `${this.normalizeBaseUrl(baseUrl)}/uploads/1234567`
  }

  loadRecord(payload) {
    const record = this.object(payload)
    const metadata = this.object(record?.metadata)
    if (!record) throw new Error('Zenodo returned an invalid record response.')
    if (!metadata)
      throw new Error('Zenodo record response did not include a metadata object.')
    const normalizedMetadata = { ...metadata }
    if (normalizedMetadata.doi === undefined && typeof record.doi === 'string') {
      normalizedMetadata.doi = record.doi
    }
    return {
      payload: record,
      metadata: normalizedMetadata,
      files: this.remoteFiles(record),
    }
  }

  remoteFiles(payload) {
    const value = payload.files
    const entries = Array.isArray(value)
      ? value
      : this.object(value) && Array.isArray(value.entries)
        ? value.entries
        : this.object(value) && this.object(value.entries)
          ? Object.values(value.entries)
          : []
    return entries.map((entry) => {
      const file = this.object(entry)
      if (!file) throw new Error('Zenodo returned an invalid file entry.')
      const links = this.object(file.links)
      const filename =
        this.text(file.key) || this.text(file.filename) || this.text(file.name)
      const downloadUrl =
        this.text(links?.content) || this.text(links?.download) || this.text(links?.self)
      if (!filename || !downloadUrl) {
        throw new Error(
          'A Zenodo file entry did not include a filename and download link.',
        )
      }
      return {
        filename,
        downloadUrl,
        size: Number.isFinite(file.size) ? file.size : undefined,
        checksum: this.text(file.checksum),
        remoteId:
          this.text(file.id) ||
          this.text(file.uuid) ||
          this.text(file.version_id) ||
          this.text(file.key),
      }
    })
  }

  buildLocalFilePaths(files, uploadedCrate) {
    const exportedNames = uploadedCrate
      ? this.uploadPackage.buildZenodoFilenameMap(
          this.uploadPackage.extractWorkspaceFilePaths(uploadedCrate),
        )
      : new Map()
    const localByExportedName = new Map(
      Array.from(exportedNames, ([localPath, exportedName]) => [exportedName, localPath]),
    )
    const result = new Map()
    const used = new Set()
    for (const file of files) {
      if (file.filename === METADATA_FILE) {
        result.set(file, METADATA_FILE)
        used.add(METADATA_FILE)
        continue
      }
      const preferred = localByExportedName.get(file.filename) || file.filename
      const safePath = this.safeRelativePath(preferred)
      let candidate = safePath
      let suffix = 2
      while (used.has(candidate)) {
        candidate = this.uploadPackage.addFilenameSuffix(safePath, suffix++)
      }
      used.add(candidate)
      result.set(file, candidate)
    }
    return result
  }

  createEmptyRoCrate() {
    return {
      '@context': 'https://w3id.org/ro/crate/1.1/context',
      '@graph': [
        {
          '@id': METADATA_FILE,
          '@type': 'CreativeWork',
          about: { '@id': './' },
          conformsTo: { '@id': 'https://w3id.org/ro/crate/1.1' },
        },
        { '@id': './', '@type': 'Dataset' },
      ],
    }
  }

  addDownloadedFilesToCrate(crate, files, localPaths) {
    const graph = crate['@graph']
    let root = graph.find((entity) => entity?.['@id'] === './')
    if (!root) {
      root = { '@id': './', '@type': 'Dataset' }
      graph.push(root)
    }
    const hasPart = this.references(root.hasPart)
    for (const file of files) {
      const localPath = localPaths.get(file)
      if (!localPath || localPath === METADATA_FILE) continue
      let entity = graph.find(
        (candidate) => this.localPath(candidate?.['@id']) === localPath,
      )
      if (!entity) {
        entity = {
          '@id': localPath,
          '@type': 'File',
          name: localPath.split('/').pop() || localPath,
        }
        graph.push(entity)
      }
      if (file.size !== undefined && entity.contentSize === undefined) {
        entity.contentSize = String(file.size)
      }
      const entityId = this.text(entity['@id']) || localPath
      if (!hasPart.some((reference) => reference['@id'] === entityId)) {
        hasPart.push({ '@id': entityId })
      }
    }
    if (hasPart.length) root.hasPart = hasPart
  }

  normalizeRecordMetadata(metadata) {
    const normalized = { ...metadata }
    const resourceType = this.object(metadata.resource_type)
      ? this.text(metadata.resource_type.id)
      : this.text(metadata.resource_type)
    if (resourceType && normalized.upload_type === undefined) {
      normalized.upload_type = resourceType.split('-')[0]
    }
    const accessRight = this.object(metadata.access_right)
      ? this.text(metadata.access_right.id)
      : this.text(metadata.access_right)
    if (accessRight) normalized.access_right = accessRight
    if (normalized.license === undefined && Array.isArray(metadata.rights)) {
      const right = metadata.rights.find((candidate) => this.object(candidate))
      if (right) normalized.license = this.text(right.id) || this.text(right.title)
    }
    if (normalized.keywords === undefined && Array.isArray(metadata.subjects)) {
      normalized.keywords = metadata.subjects.flatMap((subject) => {
        if (typeof subject === 'string') return [subject]
        const value = this.object(subject)
        const keyword =
          this.text(value?.subject) || this.text(value?.term) || this.text(value?.title)
        return keyword ? [keyword] : []
      })
    }
    if (Array.isArray(metadata.creators)) {
      normalized.creators = metadata.creators
        .map((creator) => this.normalizeCreator(creator))
        .filter(Boolean)
    }
    return normalized
  }

  normalizeCreator(value) {
    const creator = this.object(value)
    if (!creator) return undefined
    const person = this.object(creator.person_or_org)
    const name =
      this.text(creator.name) ||
      this.text(person?.name) ||
      this.joinName(person?.family_name, person?.given_name)
    if (!name) return undefined
    const affiliation =
      this.text(creator.affiliation) ||
      (Array.isArray(creator.affiliations)
        ? creator.affiliations
            .map((item) => this.text(this.object(item)?.name) || this.text(item))
            .find(Boolean)
        : undefined)
    const orcid =
      this.text(creator.orcid) ||
      (Array.isArray(person?.identifiers)
        ? person.identifiers
            .map((item) => {
              const identifier = this.object(item)
              return this.text(identifier?.scheme)?.toLowerCase() === 'orcid'
                ? this.text(identifier?.identifier)
                : undefined
            })
            .find(Boolean)
        : undefined)
    return { name, ...(affiliation ? { affiliation } : {}), ...(orcid ? { orcid } : {}) }
  }

  async persistImportedRecordLink({
    rootUri,
    repository,
    recordId,
    crate,
    files,
    localPaths,
    target,
    crosswalkId,
  }) {
    const mapping = {}
    for (const file of files) {
      const localPath = localPaths.get(file)
      if (!localPath) continue
      const entityId =
        localPath === METADATA_FILE
          ? METADATA_FILE
          : this.uploadPackage.findEntityIdForPath(crate, localPath) || localPath
      // Keep the same identifier format as the built-in importer. The update and
      // sync operations can resolve both filenames and Zenodo file ids, while a
      // filename also survives Zenodo replacing a file object during an update.
      mapping[entityId] = file.filename
      if (localPath !== METADATA_FILE && file.checksum) {
        const stat = await this.vscode.workspace.fs.stat(
          this.vscode.Uri.joinPath(rootUri, ...localPath.split('/')),
        )
        if (!this.isDirectory(stat)) {
          await this.fileHashStore.recordKnownHash(
            rootUri,
            entityId,
            stat.mtime,
            stat.size,
            file.checksum,
          )
        }
      }
    }
    const mappingFile = await this.uniqueMappingFile(rootUri)
    await this.writeJson(
      this.vscode.Uri.joinPath(rootUri, '.rockit', mappingFile),
      this.compactMapping(mapping),
    )
    const logUri = this.vscode.Uri.joinPath(rootUri, '.rockit', 'export-log.json')
    const entries = normalizeExportLogEntries(await this.readExportLog(logUri))
    const next = appendExportLogEvent(entries, {
      pid: recordId,
      target,
      repository: this.normalizeBaseUrl(repository.baseUrl),
      mappingFile,
      crosswalkFile: crosswalkId,
      syncType: 'update',
      status: 'cancelled',
      lastSuccessfulActionAt: this.now().toISOString(),
      datasetName: this.rootDatasetName(crate),
    })
    await this.writeJson(logUri, serializeExportLogEntries(next))
    return { mappingFile, target }
  }

  async uniqueMappingFile(rootUri) {
    const rockitUri = this.vscode.Uri.joinPath(rootUri, '.rockit')
    await this.vscode.workspace.fs.createDirectory(rockitUri)
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const filename = `${this.randomId()}.json`
      if (!(await this.exists(this.vscode.Uri.joinPath(rockitUri, filename))))
        return filename
    }
    return `${Date.now()}-${this.randomId()}.json`
  }

  async createUniqueImportDirectory(parentUri, recordId) {
    const base = `zenodo-${recordId}`
    let name = base
    let suffix = 2
    while (await this.exists(this.vscode.Uri.joinPath(parentUri, name))) {
      name = `${base}-${suffix++}`
    }
    const uri = this.vscode.Uri.joinPath(parentUri, name)
    await this.vscode.workspace.fs.createDirectory(uri)
    return uri
  }

  async writeRelativeFile(rootUri, relativePath, content) {
    const safePath = this.safeRelativePath(relativePath)
    const parts = safePath.split('/')
    let parent = rootUri
    for (const part of parts.slice(0, -1)) {
      parent = this.vscode.Uri.joinPath(parent, part)
      await this.vscode.workspace.fs.createDirectory(parent)
    }
    await this.vscode.workspace.fs.writeFile(
      this.vscode.Uri.joinPath(rootUri, ...parts),
      content,
    )
  }

  safeRelativePath(value) {
    const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
    if (
      !normalized ||
      normalized.includes('\0') ||
      normalized.split('/').some((part) => !part || part === '.' || part === '..') ||
      /^[a-zA-Z]:\//.test(normalized)
    )
      throw new Error(`Refusing to import an unsafe Zenodo filename: ${value}`)
    return normalized
  }

  localPath(value) {
    const id = this.text(value)
    if (!id || id === '.' || id === './' || id.startsWith('#') || id.includes(':'))
      return undefined
    try {
      return this.safeRelativePath(id.replace(/^\.\//, ''))
    } catch {
      // RO-Crates commonly contain directory entities whose ids end in '/'.
      // They are not downloadable File paths and must not abort the import while
      // searching the graph for the entity that belongs to a downloaded file.
      return undefined
    }
  }

  references(value) {
    return (Array.isArray(value) ? value : value ? [value] : []).filter(
      (item) => this.object(item) && typeof item['@id'] === 'string',
    )
  }

  compactMapping(mapping) {
    return Object.fromEntries(
      Object.entries(mapping)
        .filter(([, value]) => value)
        .sort(([left], [right]) => left.localeCompare(right)),
    )
  }

  recordHtmlUrl(payload) {
    const links = this.object(payload.links)
    return this.text(links?.html) || this.text(links?.latest_draft_html)
  }

  isPublished(payload) {
    return payload?.submitted === true || payload?.state === 'done'
  }

  isDirectory(stat) {
    const directoryType = this.vscode.FileType?.Directory ?? 2
    return (stat.type & directoryType) === directoryType
  }

  async exists(uri) {
    try {
      await this.vscode.workspace.fs.stat(uri)
      return true
    } catch {
      return false
    }
  }

  joinName(familyName, givenName) {
    const family = this.text(familyName)
    const given = this.text(givenName)
    return family && given ? `${family}, ${given}` : family || given
  }

  text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }

  object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  }
}

module.exports = { ZenodoImportOperation }

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const METADATA_FILE = 'ro-crate-metadata.json'

/**
 * Builds the Zenodo upload representation without changing the workspace crate.
 *
 * This deliberately mirrors the former built-in exporter: workspace files keep
 * their crate paths, readable external local files are represented below
 * imported_resources/, references are rewritten only in the upload clone, and
 * Zenodo filenames are flattened with deterministic collision suffixes.
 */
class ZenodoUploadPackage {
  constructor({ vscode }) {
    this.vscode = vscode
  }

  async prepare(rootUri, crate) {
    const uploadCrate = JSON.parse(JSON.stringify(crate))
    const external = await this.localizeExternalFiles(uploadCrate, rootUri)
    const entries = new Map(external.entries)

    for (const relativePath of this.extractWorkspaceFilePaths(uploadCrate)) {
      if (relativePath === METADATA_FILE || entries.has(relativePath)) {
        continue
      }
      const uri = this.vscode.Uri.joinPath(rootUri, ...relativePath.split('/'))
      const stat = await this.fileStat(uri, `Referenced RO-Crate file not found: ${relativePath}.`)
      this.rejectDirectory(stat, relativePath)
      entries.set(relativePath, uri)
    }

    const filenames = this.buildZenodoFilenameMap(Array.from(entries.keys()))
    const originalByUploadId = new Map(
      Array.from(external.originalToUploadIds, ([originalId, uploadId]) => [uploadId, originalId]),
    )
    const files = []
    for (const [entryPath, uri] of Array.from(entries).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const stat = await this.fileStat(uri, `Referenced RO-Crate file not found: ${entryPath}.`)
      this.rejectDirectory(stat, entryPath)
      const content = await this.vscode.workspace.fs.readFile(uri)
      files.push({
        entityId: entryPath,
        localFileId:
          originalByUploadId.get(entryPath) || this.findEntityIdForPath(crate, entryPath) || entryPath,
        filename: filenames.get(entryPath) || this.sanitizeZenodoFilename(entryPath),
        content,
        size: content.byteLength,
        lastModified: stat.mtime,
      })
    }
    files.push(this.metadataFile(uploadCrate))
    return { crate: uploadCrate, files, originalToUploadIds: external.originalToUploadIds }
  }

  metadataFile(crate) {
    const content = new TextEncoder().encode(`${JSON.stringify(crate, null, 2)}\n`)
    return {
      entityId: METADATA_FILE,
      filename: METADATA_FILE,
      content,
      size: content.byteLength,
    }
  }

  refreshMetadataFile(file, crate) {
    return file.filename === METADATA_FILE ? this.metadataFile(crate) : file
  }

  async localizeExternalFiles(crate, rootUri) {
    const references = this.collectFileReferences(crate)
    const usedPaths = new Set(references.map(({ entryPath }) => entryPath.toLowerCase()))
    const importedBySource = new Map()
    const entries = new Map()
    const originalToUploadIds = new Map()

    for (const reference of references) {
      const localSources = reference.sources.filter(({ kind }) => kind === 'local')
      const resolved = await this.firstReadableLocalSource(localSources)
      if (!resolved) {
        continue
      }
      const sourceKey = resolved.source.value
        .trim()
        .replace(/\\/g, '/')
        .replace(/\/+$/, '')
        .toLowerCase()
      let importedPath = importedBySource.get(sourceKey)
      if (!importedPath) {
        importedPath = this.uniqueImportedPath(reference.entryPath, resolved.source.value, usedPaths)
        importedBySource.set(sourceKey, importedPath)
        usedPaths.add(importedPath.toLowerCase())
      }
      this.rewriteEntityIdReferences(crate, reference.entityId, importedPath)
      entries.set(importedPath, resolved.uri)
      originalToUploadIds.set(reference.entityId, importedPath)
    }
    return { entries, originalToUploadIds }
  }

  collectFileReferences(crate) {
    const references = []
    for (const entity of this.graph(crate)) {
      if (!this.isFileEntity(entity)) {
        continue
      }
      const entityId = this.firstString(entity['@id'])
      const entryPath = this.deriveEntryPath(entity, entityId)
      if (!entryPath || entryPath === METADATA_FILE) {
        continue
      }
      const sources = this.collectSources(entity, entityId, entryPath)
      if (sources.length) {
        references.push({ entityId: entityId || entryPath, entryPath, sources })
      }
    }
    return references
  }

  extractWorkspaceFilePaths(crate) {
    const paths = new Set()
    for (const entity of this.graph(crate).filter((candidate) => this.isFileEntity(candidate))) {
      const id = this.firstString(entity['@id'])
      const path = this.workspacePath(id)
      if (path) {
        paths.add(path)
      } else if (id && id !== './' && !id.startsWith('#') && !this.isLocalReference(id) && !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(id)) {
        throw new Error(`Only files inside the RO-Crate workspace can be uploaded: ${id}`)
      }
    }
    return Array.from(paths).sort((left, right) => left.localeCompare(right))
  }

  collectSources(entity, entityId, entryPath) {
    const values = [
      entryPath,
      entityId,
      ...this.allStrings(entity.contentUrl),
      ...this.allStrings(entity.url),
      ...this.allStrings(entity.sameAs),
    ]
    const seen = new Set()
    const sources = []
    for (const raw of values) {
      const value = raw.trim()
      const kind = this.isLocalReference(value)
        ? 'local'
        : this.workspacePath(value)
          ? 'workspace'
          : undefined
      const key = `${kind}:${value}`
      if (!kind || seen.has(key)) {
        continue
      }
      seen.add(key)
      sources.push({ kind, value: kind === 'workspace' ? value.replace(/\\/g, '/') : value })
    }
    return sources
  }

  async firstReadableLocalSource(sources) {
    for (const source of sources) {
      const uri = this.toLocalFileUri(source.value)
      if (!uri) {
        continue
      }
      try {
        const stat = await this.vscode.workspace.fs.stat(uri)
        if (!this.isDirectory(stat)) {
          return { source, uri }
        }
      } catch {
        // Try the next declared local source, matching the built-in exporter.
      }
    }
    return undefined
  }

  toLocalFileUri(value) {
    const trimmed = value.trim()
    if (/^file:\/\//i.test(trimmed)) {
      return this.vscode.Uri.parse(trimmed)
    }
    if (/^[a-zA-Z]:[\\/]/.test(trimmed) || /^[/\\]{2}[^/\\]/.test(trimmed) || /^\/[^/]/.test(trimmed)) {
      return this.vscode.Uri.file(trimmed)
    }
    return undefined
  }

  deriveEntryPath(entity, entityId) {
    const workspacePath = this.workspacePath(entityId)
    if (workspacePath) {
      return workspacePath
    }
    const directory =
      this.firstString(entity.directoryLabel) || this.reverseHasPartDirectory(entity) || ''
    const name = this.firstString(entity.name) || this.basename(entityId)
    return this.normalizePackagePath(`${directory ? `${directory}/` : ''}${name}`)
  }

  reverseHasPartDirectory(entity) {
    const reverse = entity['@reverse']
    const hasPart = this.record(reverse)?.hasPart
    const id = this.firstString(this.record(hasPart)?.['@id'] ?? hasPart)
    if (!id || id === './' || id === '.') {
      return ''
    }
    return id.replace(/\\/g, '/').replace(/\/$/, '')
  }

  uniqueImportedPath(entryPath, source, usedPaths) {
    const raw = this.basename(entryPath || source) || 'imported_resource'
    const safe = Array.from(raw)
      .map((char) => (char.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(char) ? char : '_'))
      .join('') || 'imported_resource'
    const dot = safe.lastIndexOf('.')
    const base = dot > 0 && dot < safe.length - 1 ? safe.slice(0, dot) : safe
    const extension = dot > 0 && dot < safe.length - 1 ? safe.slice(dot) : ''
    for (let index = 0; index < 10000; index += 1) {
      const name = index === 0 ? `${base}${extension}` : `${base}_${index}${extension}`
      const candidate = `imported_resources/${name}`
      if (!usedPaths.has(candidate.toLowerCase())) {
        return candidate
      }
    }
    throw new Error(`Could not create a unique imported_resources name for ${source}.`)
  }

  buildZenodoFilenameMap(entryPaths) {
    const used = new Set()
    const filenames = new Map()
    for (const entryPath of entryPaths) {
      const preferred = this.sanitizeZenodoFilename(entryPath)
      let candidate = preferred
      let suffix = 2
      while (used.has(candidate)) {
        candidate = this.addFilenameSuffix(preferred, suffix++)
      }
      used.add(candidate)
      filenames.set(entryPath, candidate)
    }
    return filenames
  }

  sanitizeZenodoFilename(value) {
    return value
      .replace(/\\/g, '/')
      .replace(/\//g, '__')
      .replace(/[\u0000-\u001f]/g, '_')
      .trim() || 'file'
  }

  addFilenameSuffix(filename, suffix) {
    const index = filename.lastIndexOf('.')
    return index <= 0
      ? `${filename}-${suffix}`
      : `${filename.slice(0, index)}-${suffix}${filename.slice(index)}`
  }

  findEntityIdForPath(crate, path) {
    return this.graph(crate)
      .map((entity) => this.firstString(entity['@id']))
      .find((id) => this.workspacePath(id) === path)
  }

  workspacePath(value) {
    if (!value || value === './' || value.startsWith('#') || this.isLocalReference(value)) {
      return undefined
    }
    let normalized = value.replace(/\\/g, '/')
    if (normalized.startsWith('file://./')) {
      normalized = normalized.slice('file://./'.length)
    } else if (normalized.startsWith('./')) {
      normalized = normalized.slice(2)
    } else if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(normalized)) {
      return undefined
    }
    return this.normalizePackagePath(normalized)
  }

  normalizePackagePath(value) {
    const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+|\/+$/g, '')
    if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
      return undefined
    }
    return normalized
  }

  isLocalReference(value) {
    return /^file:\/\//i.test(value) || /^[a-zA-Z]:[\\/]/.test(value) || /^[/\\]{2}[^/\\]/.test(value) || /^\/[^/]/.test(value)
  }

  rewriteEntityIdReferences(value, oldId, newId) {
    if (Array.isArray(value)) {
      value.forEach((child) => this.rewriteEntityIdReferences(child, oldId, newId))
      return
    }
    const record = this.record(value)
    if (!record) {
      return
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === '@id' && child === oldId) {
        record[key] = newId
      } else {
        this.rewriteEntityIdReferences(child, oldId, newId)
      }
    }
  }

  async fileStat(uri, missingMessage) {
    try {
      return await this.vscode.workspace.fs.stat(uri)
    } catch (error) {
      throw new Error(`${missingMessage} ${error instanceof Error ? error.message : String(error)}`.trim())
    }
  }

  rejectDirectory(stat, path) {
    if (this.isDirectory(stat)) {
      throw new Error(`RO-Crate File entity points to a directory: ${path}.`)
    }
  }

  isDirectory(stat) {
    const directoryType = this.vscode.FileType?.Directory ?? 2
    return (stat.type & directoryType) === directoryType
  }

  basename(value) {
    try {
      return decodeURIComponent(new URL(value).pathname).split('/').filter(Boolean).pop() || ''
    } catch {
      return value.replace(/\\/g, '/').split('/').filter(Boolean).pop() || ''
    }
  }

  isFileEntity(entity) {
    return this.allStrings(entity?.['@type']).some((type) => type === 'File' || type.endsWith(':File'))
  }

  graph(crate) {
    return Array.isArray(crate?.['@graph'])
      ? crate['@graph'].filter((entity) => this.record(entity))
      : []
  }

  allStrings(value) {
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) return value.flatMap((item) => this.allStrings(item))
    const record = this.record(value)
    return record ? this.allStrings(record['@id']) : []
  }

  firstString(value) {
    return this.allStrings(value)[0] || ''
  }

  record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  }
}

module.exports = { METADATA_FILE, ZenodoUploadPackage }

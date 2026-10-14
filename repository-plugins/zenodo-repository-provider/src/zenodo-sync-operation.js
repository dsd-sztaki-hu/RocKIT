// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const { applyZenodoMetadataToRoCrate } = require('../lib/zenodo-metadata-crosswalk')
const {
  appendExportLogEvent,
  normalizeExportLogEntries,
  serializeExportLogEntries,
} = require('./export-log')
const { mergeRoCratesForSync } = require('./ro-crate-sync-merge')
const { ZenodoCreateOperation } = require('./zenodo-create-operation')
const { ZenodoFileHashStore } = require('./zenodo-file-hash-store')

const CROSSWALK_FILE = 'arp-zenodo-crosswalk.json'
const METADATA_FILE = 'ro-crate-metadata.json'
const SYNC_MODES = new Set(['complete', 'remote-additions', 'local-additions'])

class ZenodoSyncOperation extends ZenodoCreateOperation {
  constructor(options) {
    super(options)
    this.fileHashStore =
      options.fileHashStore || new ZenodoFileHashStore({ vscode: options.vscode, now: options.now })
  }

  async execute(input, progress = { report() {} }) {
    const repository = input?.repository
    const exportTarget = input?.exportTarget
    const mode = input?.syncMode
    if (!repository || typeof repository !== 'object') {
      throw new Error('The Zenodo repository configuration is missing.')
    }
    if (!exportTarget?.pid || !exportTarget?.mappingFile) {
      throw new Error('Select an existing Zenodo export before syncing it.')
    }
    if (!this.safeMappingFile(exportTarget.mappingFile)) {
      throw new Error('The selected Zenodo mapping filename is invalid.')
    }
    if (!SYNC_MODES.has(mode)) {
      throw new Error('Select a valid Zenodo synchronization mode.')
    }

    const rootUri = this.workspaceRoot()
    const metadataUri = this.vscode.Uri.joinPath(rootUri, METADATA_FILE)
    const localCrate = this.parseCrate(
      await this.readFile(metadataUri, `The workspace does not contain ${METADATA_FILE}.`),
    )
    const mappingUri = this.vscode.Uri.joinPath(rootUri, '.rockit', exportTarget.mappingFile)
    const mapping = await this.readMapping(mappingUri)
    const client = this.clientFactory(repository)
    const logEntry = {
      pid: String(exportTarget.pid),
      target: exportTarget.target,
      repository: this.normalizeBaseUrl(repository.baseUrl),
      mappingFile: exportTarget.mappingFile,
      crosswalkFile: CROSSWALK_FILE,
      syncType: 'sync',
      datasetName: exportTarget.datasetName,
      lastSuccessfulActionAt: exportTarget.lastSuccessfulActionAt,
    }
    await this.appendSyncLog(rootUri, { ...logEntry, status: 'cancelled' })

    try {
      progress.report({ message: 'Loading Zenodo deposition...' })
      const deposition = await client.getDeposition(exportTarget.pid)
      const depositionId = this.depositionId(deposition) || String(exportTarget.pid)
      const metadata = await this.syncMetadata(client, deposition, depositionId)
      const remoteFiles = this.normalizeRemoteFiles(
        await client.listDepositionFiles(depositionId),
      )
      const remoteMetadata = remoteFiles.find((file) => file.filename === METADATA_FILE)
      if (!remoteMetadata) {
        throw new Error(`The existing Zenodo export does not contain ${METADATA_FILE}.`)
      }
      const remoteCrate = this.parseCrate(await client.downloadFile(remoteMetadata.downloadUrl))
      const remoteToLocal = this.invertMapping(mapping)
      const plan = []
      const relocatedIds = {}
      let keptLocalFileCount = 0
      const storedFileHashes = await this.fileHashStore.readFileHashes(rootUri)

      for (const remote of remoteFiles.filter((file) => file.filename !== METADATA_FILE)) {
        const remotePath = this.remoteCratePath(remote, remoteCrate)
        const mappedId = this.mappedLocalId(remote, remoteToLocal)
        const fallbackId = this.fallbackPath(remote.filename)
        const localId = mode === 'remote-additions'
          ? mappedId || fallbackId
          : remotePath || mappedId || fallbackId
        const localPath = this.localPath(localId) || fallbackId
        if (!localId || !localPath) continue

        const previousLocalId = this.previousLocalId(remote, mapping)
        const remoteId = this.remoteIdentifiers(remote).find((id) =>
          Object.values(mapping).includes(id),
        ) || remote.id || remote.filename
        if (mode !== 'remote-additions' && previousLocalId && previousLocalId !== localId) {
          relocatedIds[previousLocalId] = localId
          for (const [id, mappedRemoteId] of Object.entries(mapping)) {
            if (mappedRemoteId === remoteId) delete mapping[id]
          }
        }
        mapping[localId] = remoteId

        const targetUri = this.joinRelative(rootUri, localPath)
        const stat = await this.tryStat(targetUri)
        if (!stat) {
          plan.push({ remote, localId, localPath, targetUri, kind: 'new' })
        } else if (
          !this.isDirectory(stat) &&
          this.fileHashStore.isFileRecordUnchanged(storedFileHashes[localId], {
            localLastModified: stat.mtime,
            localSize: stat.size,
            remoteMd5: remote.checksum,
            remoteSize: remote.size,
          })
        ) {
          keptLocalFileCount += 1
        } else if (mode === 'remote-additions') {
          keptLocalFileCount += 1
        } else {
          plan.push({ remote, localId, localPath, targetUri, kind: 'changed' })
        }
      }

      for (const item of plan) {
        progress.report({ message: `Downloading ${item.localPath}...` })
        await this.ensureParentFolders(rootUri, item.localPath)
        await this.vscode.workspace.fs.writeFile(
          item.targetUri,
          await client.downloadFile(item.remote.downloadUrl),
        )
        const downloadedStat = await this.vscode.workspace.fs.stat(item.targetUri)
        await this.fileHashStore.recordKnownHash(
          rootUri,
          item.localId,
          downloadedStat.mtime,
          downloadedStat.size,
          item.remote.checksum,
        )
      }

      progress.report({ message: `Merging ${METADATA_FILE}...` })
      const localizedRemote = this.rewriteIds(remoteCrate, this.invertMapping(mapping))
      const repositoryMetadata = applyZenodoMetadataToRoCrate(localizedRemote, metadata)
      const merged = mergeRoCratesForSync(
        this.rewriteIds(localCrate, relocatedIds),
        repositoryMetadata.crate,
        mode,
      )
      await this.writeJson(metadataUri, merged)
      await this.writeJson(mappingUri, this.compactMapping(mapping))
      await this.appendSyncLog(rootUri, {
        ...logEntry,
        pid: depositionId,
        status: 'success',
        lastSuccessfulActionAt: this.now().toISOString(),
        datasetName: this.rootDatasetName(merged),
      })
      progress.report({ message: 'Zenodo sync complete.' })

      return {
        providerId: 'zenodo',
        remoteId: depositionId,
        state: this.isPublished(deposition) ? 'published' : 'draft',
        landingPage: exportTarget.target,
        mappingFile: exportTarget.mappingFile,
        downloadedFileCount: plan.filter((item) => item.kind === 'new').length,
        replacedFileCount: plan.filter((item) => item.kind === 'changed').length,
        keptLocalFileCount,
        metadataSource: mode,
        updatedMetadataFields: repositoryMetadata.updatedFields,
      }
    } catch (error) {
      try {
        await this.appendSyncLog(rootUri, {
          ...logEntry,
          status: 'failed',
          errorMessage: this.errorMessage(error),
        })
      } catch (logError) {
        console.warn('Failed to record the Zenodo sync failure.', logError)
      }
      throw error
    }
  }

  async syncMetadata(client, deposition, depositionId) {
    const legacy = this.object(deposition)?.metadata
    if (!this.object(legacy)) {
      throw new Error('Zenodo did not return deposition metadata.')
    }
    const recordId = this.text(deposition?.record_id) || this.text(deposition?.recid) || depositionId
    for (const draft of [true, false]) {
      try {
        const record = await client.getRecord(recordId, draft)
        const modern = this.object(record)?.metadata
        if (this.object(modern)) return this.mergeRecordMetadata(legacy, modern)
      } catch {
        // Legacy Zenodo deployments may not expose the records endpoint.
      }
    }
    return legacy
  }

  mergeRecordMetadata(legacy, modern) {
    const merged = { ...legacy }
    const descriptions =
      modern.additional_descriptions ??
      modern.additionalDescriptions ??
      modern.additional_description ??
      modern.additionalDescription
    if (descriptions !== undefined) merged.additional_descriptions = descriptions
    if (Array.isArray(modern.creators) && modern.creators.length) {
      merged.creators = modern.creators.map((creator) => {
        const person = this.object(creator?.person_or_org)
        const affiliation = this.text(creator?.affiliation) ||
          (Array.isArray(creator?.affiliations)
            ? creator.affiliations.map((item) =>
                this.text(this.object(item)?.name) || this.text(item),
              ).find(Boolean)
            : undefined)
        const orcid = this.text(creator?.orcid) ||
          (Array.isArray(person?.identifiers)
            ? person.identifiers.map((item) => {
                const identifier = this.object(item)
                return this.text(identifier?.scheme)?.toLowerCase() === 'orcid'
                  ? this.text(identifier?.identifier)
                  : undefined
              }).find(Boolean)
            : undefined)
        return {
          name: this.text(creator?.name) || this.text(person?.name) ||
            [this.text(person?.family_name), this.text(person?.given_name)].filter(Boolean).join(', '),
          ...(affiliation ? { affiliation } : {}),
          ...(orcid ? { orcid } : {}),
        }
      }).filter((creator) => creator.name)
    }
    const keywords = this.normalizeRecordKeywords(modern.keywords ?? modern.subjects)
    if (keywords.length) merged.keywords = keywords
    return merged
  }

  normalizeRecordKeywords(value) {
    if (!Array.isArray(value)) return []
    return [...new Set(value.map((item) => {
      if (typeof item === 'string') return this.text(item)
      const subject = this.object(item)
      return this.text(subject?.subject) || this.text(subject?.term) || this.text(subject?.title)
    }).filter(Boolean))]
  }

  normalizeRemoteFiles(payload) {
    if (!Array.isArray(payload)) throw new Error('Zenodo returned an invalid deposition file list.')
    return payload.map((entry) => {
      const file = this.object(entry)
      if (!file) throw new Error('Zenodo returned an invalid deposition file entry.')
      const filename = this.text(file?.filename) || this.text(file?.name) || this.text(file?.key)
      const links = this.object(file?.links)
      const downloadUrl = this.text(links?.download) || this.text(links?.content)
      if (!filename || !downloadUrl) {
        throw new Error('Zenodo returned a file without a filename or download link.')
      }
      return {
        id: this.text(file.id),
        filename,
        checksum: this.normalizeChecksum(this.text(file.checksum)),
        size: Number.isFinite(file.size ?? file.filesize) ? file.size ?? file.filesize : undefined,
        downloadUrl,
        response: entry,
      }
    })
  }

  remoteCratePath(file, crate) {
    const flattened = file.filename.replace(/__/g, '/')
    const base = flattened.split('/').pop()
    const candidates = this.graph(crate).filter((entity) =>
      this.types(entity).includes('File') && entity['@id'] !== METADATA_FILE,
    )
    const match = candidates.find((entity) =>
      file.checksum && this.normalizeChecksum(this.text(entity.hash)) === file.checksum,
    ) || candidates.find((entity) => {
      const path = this.localPath(this.text(entity['@id']))
      return path === flattened || entity.name === file.filename || entity.name === base
    })
    return match ? this.text(match['@id']) : undefined
  }

  mappedLocalId(file, inverted) {
    return this.remoteIdentifiers(file).map((id) => inverted[id]).find(Boolean)
  }

  previousLocalId(file, mapping) {
    const ids = new Set(this.remoteIdentifiers(file))
    return Object.entries(mapping).find(([, remoteId]) => ids.has(remoteId))?.[0]
  }

  remoteIdentifiers(file) {
    const links = this.object(file.response?.links)
    return [...new Set([
      file.id,
      file.filename,
      this.text(links?.self),
      this.text(links?.download),
      this.text(links?.content),
    ].filter(Boolean))]
  }

  async readMapping(uri) {
    let parsed
    try {
      parsed = JSON.parse(new TextDecoder().decode(await this.vscode.workspace.fs.readFile(uri)))
    } catch (error) {
      throw new Error(`The Zenodo export mapping could not be read: ${this.errorMessage(error)}`)
    }
    if (!this.object(parsed)) throw new Error('The Zenodo export mapping is invalid.')
    return Object.fromEntries(
      Object.entries(parsed).filter(([key, value]) => key && typeof value === 'string'),
    )
  }

  async tryStat(uri) {
    try { return await this.vscode.workspace.fs.stat(uri) } catch { return undefined }
  }

  isDirectory(stat) {
    const directoryType = this.vscode.FileType?.Directory ?? 2
    return (stat.type & directoryType) === directoryType
  }

  invertMapping(mapping) {
    return Object.fromEntries(Object.entries(mapping).filter(([, value]) => value).map(([key, value]) => [value, key]))
  }

  compactMapping(mapping) {
    return Object.fromEntries(Object.entries(mapping).filter(([, value]) => value).sort(([a], [b]) => a.localeCompare(b)))
  }

  rewriteIds(crate, mapping) {
    const next = JSON.parse(JSON.stringify(crate))
    const visit = (value) => {
      if (Array.isArray(value)) return value.forEach(visit)
      if (!this.object(value)) return
      if (typeof value['@id'] === 'string' && mapping[value['@id']]) value['@id'] = mapping[value['@id']]
      Object.values(value).forEach(visit)
    }
    visit(next)
    return next
  }

  localPath(id) {
    if (!id || id === './' || id.startsWith('#')) return undefined
    let value = id.replace(/\\/g, '/')
    if (value.startsWith('file://./')) value = value.slice('file://./'.length)
    else if (value.startsWith('./')) value = value.slice(2)
    else if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) return undefined
    return this.safeRelativePath(value) ? value : undefined
  }

  fallbackPath(filename) {
    const path = filename.replace(/__/g, '/')
    return this.safeRelativePath(path) ? path : undefined
  }

  safeRelativePath(value) {
    const normalized = value.replace(/\\/g, '/')
    return Boolean(normalized && !normalized.includes('\0') && !normalized.startsWith('/') &&
      !/^[a-zA-Z]:\//.test(normalized) &&
      normalized.split('/').every((part) => part && part !== '.' && part !== '..'))
  }

  joinRelative(rootUri, path) {
    if (!this.safeRelativePath(path)) throw new Error(`Refusing to write unsafe sync path: ${path}`)
    return this.vscode.Uri.joinPath(rootUri, ...path.replace(/\\/g, '/').split('/'))
  }

  async ensureParentFolders(rootUri, path) {
    const parts = path.replace(/\\/g, '/').split('/').slice(0, -1)
    let current = rootUri
    for (const part of parts) {
      current = this.vscode.Uri.joinPath(current, part)
      try { await this.vscode.workspace.fs.stat(current) } catch {
        await this.vscode.workspace.fs.createDirectory(current)
      }
    }
  }

  graph(crate) {
    return Array.isArray(crate?.['@graph']) ? crate['@graph'].filter((entity) => this.object(entity)) : []
  }

  types(entity) {
    const value = entity?.['@type']
    return typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
  }

  normalizeChecksum(value) {
    const normalized = value?.replace(/^md5:/i, '').trim().toLowerCase()
    return /^[a-f0-9]{32}$/.test(normalized || '') ? normalized : undefined
  }

  isPublished(payload) {
    return payload?.submitted === true || payload?.state === 'done'
  }

  async appendSyncLog(rootUri, entry) {
    const logUri = this.vscode.Uri.joinPath(rootUri, '.rockit', 'export-log.json')
    const entries = normalizeExportLogEntries(await this.readExportLog(logUri))
    await this.writeJson(logUri, serializeExportLogEntries(appendExportLogEvent(entries, entry)))
  }

  safeMappingFile(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(value) && !value.includes('..')
  }

  text(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }

  object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  }
}

module.exports = { SYNC_MODES, ZenodoSyncOperation }

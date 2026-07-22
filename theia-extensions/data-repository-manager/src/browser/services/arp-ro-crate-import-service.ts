import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import { nls } from '@theia/core/lib/common/nls'
import URI from '@theia/core/lib/common/uri'
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { inject, injectable } from 'inversify'
import JSZip = require('jszip')

import { DataRepositoryConfig } from '../types'

type RoCrate = Record<string, any>
type RoCrateEntity = Record<string, any>
type RoCrateEntityIdMapping = Record<string, string>

export interface ArpRoCrateImportResult {
  datasetPid: string
  targetDirectory: URI
  zipPath: URI
  extractedFileCount: number
  mappingFileName?: string
}

interface ExportLogEntry {
  target: string
  repository: string
  mappingFile: string
  syncType: 'create' | 'update'
  syncedAt: string
  datasetName?: string
}

const EXPORT_LOG_FILE_NAME = 'export-log.json'

@injectable()
export class ArpRoCrateImportService {
  constructor(
    @inject(FileDialogService) protected readonly fileDialogService: FileDialogService,
    @inject(FileService) protected readonly fileService: FileService,
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
  ) {}

  public async importFromDatasetUrl(
    repository: DataRepositoryConfig,
    datasetUrl: string,
  ): Promise<ArpRoCrateImportResult | undefined> {
    const datasetPid = this.extractDatasetPid(datasetUrl)
    if (!datasetPid) {
      throw new Error(nls.localize('rockit/dataRepository/extractDatasetIdFailed', 'Could not extract a dataset handle or persistent ID from the dataset URL.'))
    }

    const importParentDirectory = await this.fileDialogService.showOpenDialog({
      title: nls.localize('rockit/dataRepository/selectImportFolder', 'Select Import Folder'),
      openLabel: nls.localize('rockit/dataRepository/importHere', 'Import Here'),
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    })
    if (!importParentDirectory) {
      return undefined
    }

    const targetDirectory = await this.createUniqueImportDirectory(
      importParentDirectory,
      datasetPid,
    )
    const zipBytes = await this.downloadRoCrateZip(repository, datasetPid)
    const zipPath = targetDirectory.resolve('rocrate.zip')
    await this.fileService.writeFile(zipPath, BinaryBuffer.wrap(zipBytes))

    const extractedFileCount = await this.extractZip(zipBytes, targetDirectory)
    const metadataUri = targetDirectory.resolve('ro-crate-metadata.json')
    if (!(await this.fileService.exists(metadataUri))) {
      throw new Error(nls.localize('rockit/dataRepository/missingDownloadedMetadata', 'The downloaded ZIP did not contain ro-crate-metadata.json.'))
    }
    const crate = await this.readRoCrate(metadataUri)
    const mappingFileName = await this.persistImportedExportState(
      targetDirectory,
      repository,
      datasetPid,
      crate,
    )

    this.workspaceService.open(targetDirectory, { preserveWindow: false })

    return {
      datasetPid,
      targetDirectory,
      zipPath,
      extractedFileCount,
      mappingFileName,
    }
  }

  protected async downloadRoCrateZip(
    repository: DataRepositoryConfig,
    datasetPid: string,
  ): Promise<Uint8Array> {
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const url = new URL(
      `/api/access/datafiles/rocrate/${this.encodeDatasetPidPath(datasetPid)}`,
      `${baseUrl}/`,
    )
    const headers: Record<string, string> = { accept: 'application/zip' }
    if (repository.apiKey) {
      headers['x-dataverse-key'] = repository.apiKey
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
    })
    if (!response.ok) {
      const message = await this.readErrorResponseMessage(response)
      throw new Error(
        nls.localize(
          'rockit/dataRepository/arpZipDownloadFailed',
          'ARP RO-Crate ZIP download failed ({0}): {1}',
          response.status,
          message,
        ),
      )
    }

    return new Uint8Array(await response.arrayBuffer())
  }

  protected async extractZip(zipBytes: Uint8Array, targetDirectory: URI): Promise<number> {
    const zip = await JSZip.loadAsync(zipBytes)
    let extractedFileCount = 0

    for (const entry of Object.values(zip.files)) {
      const relativePath = this.normalizeZipEntryPath(entry.name)
      if (!relativePath) {
        continue
      }

      const target = this.resolveSafeChild(targetDirectory, relativePath)
      if (entry.dir) {
        await this.ensureFolder(target)
        continue
      }

      await this.ensureFolder(target.parent)
      const content = await entry.async('uint8array')
      await this.fileService.writeFile(target, BinaryBuffer.wrap(content))
      extractedFileCount += 1
    }

    return extractedFileCount
  }

  protected async ensureFolder(uri: URI): Promise<void> {
    if (await this.fileService.exists(uri)) {
      return
    }
    const parent = uri.parent
    if (parent.toString() !== uri.toString() && !(await this.fileService.exists(parent))) {
      await this.ensureFolder(parent)
    }
    await this.fileService.createFolder(uri)
  }

  protected async createUniqueImportDirectory(parent: URI, datasetPid: string): Promise<URI> {
    const baseName = this.createImportDirectoryName(datasetPid)
    let candidate = parent.resolve(baseName)
    let suffix = 2

    while (await this.fileService.exists(candidate)) {
      candidate = parent.resolve(`${baseName}-${suffix}`)
      suffix += 1
    }

    await this.fileService.createFolder(candidate)
    return candidate
  }

  protected createImportDirectoryName(datasetPid: string): string {
    const tail = datasetPid
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
      .pop()

    const rawName = tail || datasetPid
    const sanitized = rawName
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+$/, '')

    return sanitized || 'ro-crate-import'
  }

  protected resolveSafeChild(root: URI, relativePath: string): URI {
    const target = relativePath
      .split('/')
      .filter((segment) => segment.length > 0)
      .reduce((uri, segment) => uri.resolve(segment), root)

    if (!root.isEqualOrParent(target)) {
      throw new Error(nls.localize(
        'rockit/dataRepository/zipEntryOutsideTarget',
        'Refusing to extract ZIP entry outside target folder: {0}',
        relativePath,
      ))
    }
    return target
  }

  protected normalizeZipEntryPath(value: string): string | undefined {
    const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '')
    if (
      normalized === '' ||
      normalized.includes('\0') ||
      normalized === '..' ||
      normalized.startsWith('../') ||
      normalized.includes('/../') ||
      /^[a-zA-Z]:\//.test(normalized)
    ) {
      throw new Error(nls.localize(
        'rockit/dataRepository/unsafeZipEntry',
        'Refusing to extract unsafe ZIP entry: {0}',
        value,
      ))
    }
    return normalized
  }

  protected extractDatasetPid(value: string): string | undefined {
    const trimmed = value.trim()
    if (!trimmed) {
      return undefined
    }
    if (/^(hdl|doi):/i.test(trimmed)) {
      return trimmed
    }
    try {
      const url = new URL(trimmed)
      const persistentId = url.searchParams.get('persistentId')
      if (persistentId?.trim()) {
        return persistentId.trim()
      }
      const path = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      if (url.hostname.toLowerCase() === 'hdl.handle.net' && path) {
        return `hdl:${path}`
      }
      if (url.hostname.toLowerCase() === 'doi.org' && path) {
        return `doi:${path}`
      }
    } catch {
      // Not a URL; fall back to treating it as a PID-like value.
    }
    return trimmed.includes('/') ? undefined : trimmed
  }

  protected encodeDatasetPidPath(datasetPid: string): string {
    return datasetPid
      .split('/')
      .map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ':'))
      .join('/')
  }

  protected async readRoCrate(metadataUri: URI): Promise<RoCrate> {
    const content = await this.fileService.readFile(metadataUri)
    try {
      return JSON.parse(content.value.toString()) as RoCrate
    } catch (error) {
      throw new Error(
        nls.localize(
          'rockit/dataRepository/parseImportedMetadataFailed',
          'Failed to parse imported ro-crate-metadata.json: {0}',
          error instanceof Error ? error.message : String(error),
        ),
      )
    }
  }

  protected async readErrorResponseMessage(response: Response): Promise<string> {
    const text = await response.text().catch(() => '')
    if (!text.trim()) {
      return response.statusText || nls.localize(
        'rockit/dataRepository/noResponseBody',
        'No response body.',
      )
    }
    try {
      return this.payloadSummary(JSON.parse(text))
    } catch {
      return text.slice(0, 500)
    }
  }

  protected payloadSummary(payload: unknown): string {
    const messages = this.collectPayloadMessages(payload)
    if (messages.length) {
      return messages.join('; ').slice(0, 500)
    }
    if (typeof payload === 'string') {
      return payload.slice(0, 500)
    }
    try {
      return JSON.stringify(payload).slice(0, 500)
    } catch {
      return String(payload).slice(0, 500)
    }
  }

  protected collectPayloadMessages(payload: unknown): string[] {
    if (!payload || typeof payload !== 'object') {
      return typeof payload === 'string' && payload.trim() ? [payload.trim()] : []
    }
    if (Array.isArray(payload)) {
      return payload.flatMap((item) => this.collectPayloadMessages(item))
    }

    const record = payload as Record<string, unknown>
    const directMessages = [
      record.message,
      record.error,
      record.status,
      record.reason,
      record.details,
    ].filter(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0,
    )

    const nestedMessages = [
      record.data,
      record.errors,
      record.errorMessages,
      record.messages,
    ].flatMap((value) => this.collectPayloadMessages(value))

    return [...directMessages, ...nestedMessages]
  }

  protected async persistImportedExportState(
    rootUri: URI,
    repository: DataRepositoryConfig,
    datasetPid: string,
    crate: RoCrate,
  ): Promise<string | undefined> {
    const mapping = this.buildImportedEntityIdMapping(crate, datasetPid)
    if (Object.keys(mapping).length === 0) {
      return undefined
    }

    const mappingFileName = await this.createUniqueMappingFileName(rootUri)
    await this.saveEntityIdMapping(rootUri, mappingFileName, mapping)
    await this.appendExportLog(rootUri, {
      target: this.buildDatasetPidTarget(datasetPid),
      repository: this.normalizeBaseUrl(repository.baseUrl),
      mappingFile: mappingFileName,
      syncType: 'update',
      syncedAt: new Date().toISOString(),
      datasetName: this.getRootDatasetName(crate),
    })
    return mappingFileName
  }

  protected buildImportedEntityIdMapping(
    crate: RoCrate,
    datasetPid: string,
  ): RoCrateEntityIdMapping {
    const mapping: RoCrateEntityIdMapping = {}
    for (const entity of this.readGraphEntities(crate)) {
      if (!this.entityTypes(entity).includes('File')) {
        continue
      }
      const remoteId = this.readOptionalEntityString(entity, '@id')
      if (!remoteId || !this.isArpFileEntityId(remoteId, datasetPid)) {
        continue
      }
      const localPath = this.computeRelativePathFromDirectoryLabelAndName(entity)
      if (!localPath) {
        continue
      }
      mapping[localPath] = remoteId
    }
    return Object.fromEntries(
      Object.entries(mapping).sort((a, b) => a[0].localeCompare(b[0])),
    )
  }

  protected computeRelativePathFromDirectoryLabelAndName(
    entity: RoCrateEntity,
  ): string | undefined {
    const name = this.readOptionalEntityString(entity, 'name')
    if (!name) {
      return undefined
    }
    const directoryLabel = this.readOptionalEntityString(entity, 'directoryLabel')
    if (!directoryLabel) {
      return this.normalizeRelativePath(name)
    }
    return this.normalizeRelativePath(`${directoryLabel.replace(/\/+$/, '')}/${name.replace(/^\/+/, '')}`)
  }

  protected normalizeRelativePath(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/').trim()
  }

  protected isArpFileEntityId(id: string, datasetPid: string): boolean {
    const prefixes = [
      `https://w3id.org/arp/ro-id/${datasetPid}/file/`,
      `https://w3id.org/arp/dev/ro-id/${datasetPid}/file/`,
    ]
    return prefixes.some((prefix) => id.startsWith(prefix) && id.length > prefix.length)
  }

  protected async createUniqueMappingFileName(rootUri: URI): Promise<string> {
    const rockitUri = rootUri.resolve('.rockit')
    await this.ensureFolder(rockitUri)
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const fileName = `${this.randomId(16)}.json`
      if (!(await this.fileService.exists(rockitUri.resolve(fileName)))) {
        return fileName
      }
    }
    return `${Date.now()}-${this.randomId(16)}.json`
  }

  protected async saveEntityIdMapping(
    rootUri: URI,
    mappingFileName: string,
    mapping: RoCrateEntityIdMapping,
  ): Promise<void> {
    const rockitUri = rootUri.resolve('.rockit')
    await this.ensureFolder(rockitUri)
    await this.fileService.writeFile(
      rockitUri.resolve(mappingFileName),
      BinaryBuffer.fromString(`${JSON.stringify(mapping, null, 2)}\n`),
    )
  }

  protected async appendExportLog(rootUri: URI, entry: ExportLogEntry): Promise<void> {
    const rockitUri = rootUri.resolve('.rockit')
    await this.ensureFolder(rockitUri)
    const historyUri = rockitUri.resolve(EXPORT_LOG_FILE_NAME)
    const entries = await this.readExportLogEntries(historyUri)
    const entryPid = this.normalizePid(entry.target)
    const existingIndex = entries.findIndex(
      (existing) =>
        this.normalizeBaseUrl(existing.repository) === this.normalizeBaseUrl(entry.repository) &&
        this.normalizePid(existing.target) === entryPid,
    )
    const nextEntries = [...entries]
    if (existingIndex >= 0) {
      nextEntries[existingIndex] = entry
    } else {
      nextEntries.push(entry)
    }
    await this.fileService.writeFile(
      historyUri,
      BinaryBuffer.fromString(`${JSON.stringify(nextEntries, null, 2)}\n`),
    )
  }

  protected async readExportLogEntries(historyUri: URI): Promise<ExportLogEntry[]> {
    if (!(await this.fileService.exists(historyUri))) {
      return []
    }
    try {
      const parsed = JSON.parse((await this.fileService.readFile(historyUri)).value.toString())
      return Array.isArray(parsed)
        ? parsed.filter(
            (entry): entry is ExportLogEntry =>
              !!entry && typeof entry === 'object' && !Array.isArray(entry),
          )
        : []
    } catch (error) {
      console.warn('Failed to parse .rockit/export-log.json; starting a new export log.', error)
      return []
    }
  }

  protected buildDatasetPidTarget(pid: string): string {
    const trimmed = pid.trim()
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed
    }
    if (/^hdl:/i.test(trimmed)) {
      return `https://hdl.handle.net/${trimmed.slice('hdl:'.length)}`
    }
    return trimmed
  }

  protected normalizePid(value: string): string {
    const extracted = this.extractDatasetPid(value) ?? value
    return extracted.replace(/^hdl:/i, '').replace(/^\/+/, '').toLowerCase()
  }

  protected getRootDatasetName(crate: RoCrate): string | undefined {
    const root = this.readGraphEntities(crate).find((entity) => entity['@id'] === './')
    if (!root) {
      return undefined
    }
    return (
      this.readOptionalEntityString(root, 'title') ??
      this.readOptionalEntityString(root, 'name')
    )
  }

  protected readGraphEntities(crate: RoCrate): RoCrateEntity[] {
    const graph = crate['@graph']
    return Array.isArray(graph)
      ? graph.filter(
          (entity): entity is RoCrateEntity =>
            !!entity && typeof entity === 'object' && !Array.isArray(entity),
        )
      : []
  }

  protected entityTypes(entity: RoCrateEntity): string[] {
    const value = entity['@type']
    if (typeof value === 'string') {
      return [value]
    }
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  }

  protected readOptionalEntityString(
    entity: RoCrateEntity,
    key: string,
  ): string | undefined {
    const value = entity[key]
    if (typeof value === 'string') {
      return value.trim() || undefined
    }
    return undefined
  }

  protected randomId(length: number): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const bytes = new Uint8Array(length)
    window.crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
  }

  protected normalizeBaseUrl(baseUrl: string): string {
    const normalized = baseUrl.trim().replace(/\/+$/, '')
    if (!normalized) {
      throw new Error(nls.localize(
        'rockit/dataRepository/emptyRepositoryBaseUrl',
        'Repository base URL is empty.',
      ))
    }
    return normalized.endsWith('/api/v1') ? normalized.slice(0, -'/api/v1'.length) : normalized
  }
}

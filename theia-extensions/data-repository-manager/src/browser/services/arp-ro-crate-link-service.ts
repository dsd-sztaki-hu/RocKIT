import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import URI from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { inject, injectable } from 'inversify'

import { DataRepositoryConfig } from '../types'
import {
  appendExportLogEvent,
  ExportLogEntry,
  normalizeExportLogEntries,
  serializeExportLogEntries,
} from './export-log'

type RoCrate = Record<string, any>
type RoCrateEntity = Record<string, any>
type RoCrateEntityIdMapping = Record<string, string>

export interface ArpRoCrateLinkResult {
  pid: string
  target: string
  repository: string
  mappingFileName: string
  mappedEntityCount: number
  unmappedEntityIds: string[]
  datasetName?: string
}

export interface ArpRoCrateLinkPreview {
  pid: string
  localDatasetTitle?: string
  remoteDatasetTitle?: string
  titleMismatch: boolean
}

const EXPORT_LOG_FILE_NAME = 'export-log.json'

@injectable()
export class ArpRoCrateLinkService {
  constructor(
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
    @inject(FileService) protected readonly fileService: FileService,
  ) {}

  public async linkLocalDatasetToRemote(
    repository: DataRepositoryConfig,
    datasetUrl: string,
  ): Promise<ArpRoCrateLinkResult> {
    const pid = this.extractDatasetPid(datasetUrl)
    if (!pid) {
      throw new Error('Could not extract a dataset handle or persistent ID from the dataset URL.')
    }

    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const rootUri = this.getWorkspaceRoot()
    const localCrate = await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json'))
    const remoteCrate = await this.fetchRemoteRoCrate(baseUrl, repository.apiKey, pid)
    const mapping = this.buildEntityIdMapping(localCrate, remoteCrate)
    const mappingFileName =
      (await this.findExistingMappingFile(rootUri, baseUrl, pid)) ??
      (await this.createUniqueMappingFileName(rootUri))
    await this.saveEntityIdMapping(rootUri, mappingFileName, mapping)

    const target = this.buildDatasetPidTarget(pid) || this.buildDataverseDatasetUrl(baseUrl, pid) || datasetUrl.trim()
    await this.appendExportLog(rootUri, {
      target,
      repository: baseUrl,
      mappingFile: mappingFileName,
      syncType: 'update',
      syncedAt: new Date().toISOString(),
      datasetName: this.getRootDatasetName(localCrate) ?? this.getRootDatasetName(remoteCrate),
    })

    const unmappedEntityIds = Object.entries(mapping)
      .filter(([, remoteId]) => !remoteId)
      .map(([localId]) => localId)

    return {
      pid,
      target,
      repository: baseUrl,
      mappingFileName,
      mappedEntityCount: Object.keys(mapping).length - unmappedEntityIds.length,
      unmappedEntityIds,
      datasetName: this.getRootDatasetName(localCrate) ?? this.getRootDatasetName(remoteCrate),
    }
  }

  public async previewLocalDatasetLink(
    repository: DataRepositoryConfig,
    datasetUrl: string,
  ): Promise<ArpRoCrateLinkPreview> {
    const pid = this.extractDatasetPid(datasetUrl)
    if (!pid) {
      throw new Error('Could not extract a dataset handle or persistent ID from the dataset URL.')
    }

    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const rootUri = this.getWorkspaceRoot()
    const localCrate = await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json'))
    const remoteCrate = await this.fetchRemoteRoCrate(baseUrl, repository.apiKey, pid)
    const localDatasetTitle = this.getRootDatasetName(localCrate)
    const remoteDatasetTitle = this.getRootDatasetName(remoteCrate)

    return {
      pid,
      localDatasetTitle,
      remoteDatasetTitle,
      titleMismatch: this.normalizeTitle(localDatasetTitle) !== this.normalizeTitle(remoteDatasetTitle),
    }
  }

  protected buildEntityIdMapping(
    localCrate: RoCrate,
    remoteCrate: RoCrate,
  ): RoCrateEntityIdMapping {
    const remoteFilesByPath = new Map<string, string>()
    const remoteDatasetsByName = new Map<string, string>()
    for (const entity of this.readGraphEntities(remoteCrate)) {
      const id = this.readOptionalEntityString(entity, '@id')
      if (!id) {
        continue
      }
      if (this.entityTypes(entity).includes('File')) {
        const path = this.dataverseFilePathFromEntity(entity)
        if (path) {
          remoteFilesByPath.set(path, id)
        }
      } else if (this.entityTypes(entity).includes('Dataset') && id !== './') {
        const name = this.datasetMatchKey(entity)
        if (name) {
          remoteDatasetsByName.set(name, id)
        }
      }
    }

    const mapping: RoCrateEntityIdMapping = {}
    for (const entity of this.readGraphEntities(localCrate)) {
      const id = this.readOptionalEntityString(entity, '@id')
      if (!id || id === './') {
        continue
      }
      if (this.entityTypes(entity).includes('File')) {
        const path = this.dataverseFilePathFromEntity(entity)
        mapping[id] = path ? remoteFilesByPath.get(path) ?? '' : ''
      } else if (this.entityTypes(entity).includes('Dataset')) {
        const name = this.datasetMatchKey(entity)
        mapping[id] = name ? remoteDatasetsByName.get(name) ?? '' : ''
      }
    }

    return Object.fromEntries(
      Object.entries(mapping).sort((a, b) => a[0].localeCompare(b[0])),
    )
  }

  protected datasetMatchKey(entity: RoCrateEntity): string | undefined {
    const value =
      this.readOptionalEntityString(entity, 'name') ??
      this.readOptionalEntityString(entity, 'title')
    return value?.trim().toLowerCase()
  }

  protected async fetchRemoteRoCrate(
    baseUrl: string,
    apiKey: string | undefined,
    pid: string,
  ): Promise<RoCrate> {
    const requestUrl = `${baseUrl}/api/arp/rocrate/${pid}`
    const headers: Record<string, string> = { accept: 'application/json' }
    if (apiKey) {
      headers['x-dataverse-key'] = apiKey
    }
    const response = await this.fetchWithTimeout(requestUrl, { headers })
    const payload = await this.readResponsePayload(response)
    if (!response.ok) {
      throw new Error(
        `Failed to retrieve remote RO-Crate (${response.status}) at ${response.url || requestUrl}: ${this.payloadSummary(payload)}`,
      )
    }
    const crate = this.extractDataverseCrate(payload)
    if (!crate) {
      throw new Error('The ARP RO-Crate response did not contain a valid @graph.')
    }
    return crate
  }

  protected async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = 120000,
  ): Promise<Response> {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(url, {
        ...init,
        redirect: 'follow',
        signal: controller.signal,
      })
    } finally {
      window.clearTimeout(timeout)
    }
  }

  protected async readResponsePayload(response: Response): Promise<unknown> {
    const text = await response.text()
    if (!text) {
      return {}
    }
    try {
      return JSON.parse(text) as unknown
    } catch {
      return text
    }
  }

  protected extractDataverseCrate(payload: unknown): RoCrate | undefined {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>
      if (Array.isArray(record['@graph'])) {
        return record as RoCrate
      }
      const data = record.data
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const dataRecord = data as Record<string, unknown>
        if (Array.isArray(dataRecord['@graph'])) {
          return data as RoCrate
        }
        const roCrate = dataRecord.roCrate
        if (
          roCrate &&
          typeof roCrate === 'object' &&
          !Array.isArray(roCrate) &&
          Array.isArray((roCrate as Record<string, unknown>)['@graph'])
        ) {
          return roCrate as RoCrate
        }
      }
    }
    return undefined
  }

  protected dataverseFilePathFromEntity(entity: RoCrateEntity): string | undefined {
    if (!this.entityTypes(entity).includes('File')) {
      return undefined
    }
    const localIdPath = this.localCratePathFromEntityId(
      typeof entity['@id'] === 'string' ? entity['@id'] : '',
    )
    if (localIdPath) {
      return localIdPath
    }
    const name = this.readOptionalEntityString(entity, 'name')
    if (!name || name.includes('/') || name.includes('\\')) {
      return undefined
    }
    const directoryLabel = this.readOptionalEntityString(entity, 'directoryLabel')
    const relativePath = directoryLabel
      ? `${directoryLabel.replace(/\\/g, '/').replace(/\/+$/, '')}/${name}`
      : name
    return this.isSafeRelativePath(relativePath) ? relativePath : undefined
  }

  protected localCratePathFromEntityId(id: string): string | undefined {
    if (id === '' || id === './' || id.startsWith('#')) {
      return undefined
    }
    let rel = id
    if (id.startsWith('file://./')) {
      rel = id.slice('file://./'.length)
    } else if (id.startsWith('./')) {
      rel = id.slice(2)
    } else if (id.includes(':')) {
      return undefined
    }
    return this.isSafeRelativePath(rel) ? rel.replace(/\\/g, '/') : undefined
  }

  protected async readRoCrate(metadataUri: URI): Promise<RoCrate> {
    if (!(await this.fileService.exists(metadataUri))) {
      throw new Error('ro-crate-metadata.json was not found in the workspace root.')
    }
    const content = await this.fileService.readFile(metadataUri)
    try {
      return JSON.parse(content.value.toString()) as RoCrate
    } catch (error) {
      throw new Error(
        `Failed to parse ro-crate-metadata.json: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  protected getWorkspaceRoot(): URI {
    const roots = this.workspaceService.tryGetRoots()
    const root = roots?.[0]?.resource
    if (!root) {
      throw new Error('No workspace is open.')
    }
    return root
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
    const nextEntries = appendExportLogEvent(entries, entry)
    await this.fileService.writeFile(
      historyUri,
      BinaryBuffer.fromString(`${JSON.stringify(serializeExportLogEntries(nextEntries), null, 2)}\n`),
    )
  }

  protected async findExistingMappingFile(
    rootUri: URI,
    repository: string,
    pid: string,
  ): Promise<string | undefined> {
    const entries = await this.readExportLogEntries(
      rootUri.resolve('.rockit').resolve(EXPORT_LOG_FILE_NAME),
    )
    const normalizedRepository = this.normalizeBaseUrl(repository)
    const normalizedPid = this.normalizePid(pid)
    return entries
      .filter(
        (entry) =>
          this.normalizeBaseUrl(entry.repository) === normalizedRepository &&
          this.normalizePid(entry.target) === normalizedPid,
      )
      .sort((a, b) => b.syncedAt.localeCompare(a.syncedAt))[0]?.mappingFile
  }

  protected async readExportLogEntries(historyUri: URI): Promise<ExportLogEntry[]> {
    if (!(await this.fileService.exists(historyUri))) {
      return []
    }
    try {
      const parsed = JSON.parse((await this.fileService.readFile(historyUri)).value.toString())
      return normalizeExportLogEntries(parsed)
    } catch (error) {
      console.warn('Failed to parse .rockit/export-log.json; starting a new export log.', error)
      return []
    }
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
      // Not a URL; fall through to compact PID handling.
    }
    return trimmed.includes('/') ? undefined : trimmed
  }

  protected buildDatasetPidTarget(pid?: string): string | undefined {
    if (!pid) {
      return undefined
    }
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

  protected normalizeBaseUrl(baseUrl: string): string {
    const normalized = baseUrl.trim().replace(/\/+$/, '')
    if (!normalized) {
      throw new Error('Repository base URL is empty.')
    }
    return normalized.endsWith('/api/v1') ? normalized.slice(0, -'/api/v1'.length) : normalized
  }

  protected buildDataverseDatasetUrl(baseUrl: string, pid?: string): string | undefined {
    return pid
      ? `${baseUrl}/dataset.xhtml?persistentId=${encodeURIComponent(pid)}`
      : undefined
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

  protected normalizeTitle(value: string | undefined): string {
    return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
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
    const raw = entity['@type']
    if (typeof raw === 'string') {
      return [raw]
    }
    return Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === 'string')
      : []
  }

  protected readOptionalEntityString(
    entity: RoCrateEntity,
    key: string,
  ): string | undefined {
    const value = entity[key]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }

  protected isSafeRelativePath(value: string): boolean {
    if (value === '' || value.includes('\0')) {
      return false
    }
    const normalized = value.replace(/\\/g, '/')
    return (
      !normalized.startsWith('/') &&
      !/^[a-zA-Z]:\//.test(normalized) &&
      !normalized.startsWith('../') &&
      !normalized.includes('/../') &&
      normalized !== '..'
    )
  }

  protected payloadSummary(payload: unknown): string {
    if (typeof payload === 'string') {
      return payload.slice(0, 500)
    }
    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>
      const message = record.message ?? record.error ?? record.details
      if (typeof message === 'string') {
        return message.slice(0, 500)
      }
    }
    return JSON.stringify(payload).slice(0, 500)
  }

  protected randomId(length: number): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const bytes = new Uint8Array(length)
    window.crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
  }
}

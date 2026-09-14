// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import URI from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { nls } from '@theia/core/lib/common/nls'
import { inject, injectable } from 'inversify'

import { DataRepositoryCapabilities, DataRepositoryConfig } from '../types'
import {
  appendExportLogEvent,
  ExportLogEntry,
  normalizeExportLogEntries,
  serializeExportLogEntries,
} from './export-log'

type RoCrate = Record<string, any>
type RoCrateEntity = Record<string, any>
type RoCrateEntityIdMapping = Record<string, string>

interface LocalDatasetLinkState {
  pid: string
  target: string
  localCrate: RoCrate
  remoteDatasetTitle?: string
  mapping: RoCrateEntityIdMapping
}

interface NativeDataverseRemoteFileRecord {
  id: string
  path: string
}

interface ZenodoRemoteFileRecord {
  id: string
  filename: string
}

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
    capabilities: DataRepositoryCapabilities,
    datasetUrl: string,
  ): Promise<ArpRoCrateLinkResult> {
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const rootUri = this.getWorkspaceRoot()
    const state = await this.resolveLinkState(repository, capabilities, datasetUrl)
    const mappingFileName =
      (await this.findExistingMappingFile(rootUri, baseUrl, state.pid)) ??
      (await this.createUniqueMappingFileName(rootUri))
    await this.saveEntityIdMapping(rootUri, mappingFileName, state.mapping)

    await this.appendExportLog(rootUri, {
      target: state.target,
      repository: baseUrl,
      mappingFile: mappingFileName,
      syncType: 'update',
      status: 'success',
      lastSuccessfulActionAt: new Date().toISOString(),
      datasetName: this.getRootDatasetName(state.localCrate) ?? state.remoteDatasetTitle,
    })

    const unmappedEntityIds = Object.entries(state.mapping)
      .filter(([, remoteId]) => !remoteId)
      .map(([localId]) => localId)

    return {
      pid: state.pid,
      target: state.target,
      repository: baseUrl,
      mappingFileName,
      mappedEntityCount: Object.keys(state.mapping).length - unmappedEntityIds.length,
      unmappedEntityIds,
      datasetName: this.getRootDatasetName(state.localCrate) ?? state.remoteDatasetTitle,
    }
  }

  public async previewLocalDatasetLink(
    repository: DataRepositoryConfig,
    capabilities: DataRepositoryCapabilities,
    datasetUrl: string,
  ): Promise<ArpRoCrateLinkPreview> {
    const state = await this.resolveLinkState(repository, capabilities, datasetUrl)
    const localDatasetTitle = this.getRootDatasetName(state.localCrate)

    return {
      pid: state.pid,
      localDatasetTitle,
      remoteDatasetTitle: state.remoteDatasetTitle,
      titleMismatch: this.normalizeTitle(localDatasetTitle) !== this.normalizeTitle(state.remoteDatasetTitle),
    }
  }

  protected async resolveLinkState(
    repository: DataRepositoryConfig,
    capabilities: DataRepositoryCapabilities,
    datasetUrl: string,
  ): Promise<LocalDatasetLinkState> {
    if (capabilities.supportsZenodoApi) {
      return this.resolveZenodoLinkState(repository, datasetUrl)
    }
    if (capabilities.supportsArpRoCrateZipUpload) {
      return this.resolveArpDataverseLinkState(repository, datasetUrl)
    }
    if (capabilities.supportsNativeDataverseApi) {
      return this.resolveNativeDataverseLinkState(repository, datasetUrl)
    }
    throw new Error(nls.localize(
      'rockit/dataRepository/linkUnsupportedRepository',
      "Repository '{0}' does not expose a supported API for linking local datasets.",
      repository.title,
    ))
  }

  protected async resolveArpDataverseLinkState(
    repository: DataRepositoryConfig,
    datasetUrl: string,
  ): Promise<LocalDatasetLinkState> {
    const pid = this.extractDatasetPid(datasetUrl)
    if (!pid) {
      throw new Error(nls.localize('rockit/dataRepository/extractDatasetIdFailed', 'Could not extract a dataset handle or persistent ID from the dataset URL.'))
    }

    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const rootUri = this.getWorkspaceRoot()
    const localCrate = await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json'))
    const remoteCrate = await this.fetchRemoteRoCrate(baseUrl, repository.apiKey, pid)

    return {
      pid,
      target: this.buildDatasetPidTarget(pid) || this.buildDataverseDatasetUrl(baseUrl, pid) || datasetUrl.trim(),
      localCrate,
      remoteDatasetTitle: this.getRootDatasetName(remoteCrate),
      mapping: this.buildArpEntityIdMapping(localCrate, remoteCrate),
    }
  }

  protected async resolveNativeDataverseLinkState(
    repository: DataRepositoryConfig,
    datasetUrl: string,
  ): Promise<LocalDatasetLinkState> {
    const pid = this.extractDatasetPid(datasetUrl)
    if (!pid) {
      throw new Error(nls.localize('rockit/dataRepository/extractPersistentIdFailed', 'Could not extract a dataset persistent ID from the dataset URL.'))
    }

    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const rootUri = this.getWorkspaceRoot()
    const localCrate = await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json'))
    const remoteDataset = await this.fetchNativeDataverseDataset(baseUrl, repository.apiKey, pid)

    return {
      pid,
      target: this.buildDatasetPidTarget(pid) || this.buildDataverseDatasetUrl(baseUrl, pid) || datasetUrl.trim(),
      localCrate,
      remoteDatasetTitle: remoteDataset.title,
      mapping: this.buildNativeDataverseEntityIdMapping(localCrate, remoteDataset.files),
    }
  }

  protected async resolveZenodoLinkState(
    repository: DataRepositoryConfig,
    datasetUrl: string,
  ): Promise<LocalDatasetLinkState> {
    const depositionId = this.extractZenodoDepositionId(datasetUrl)
    if (!depositionId) {
      throw new Error(nls.localize('rockit/dataRepository/extractZenodoDepositionIdFailed', 'Could not extract a Zenodo deposition ID from the dataset URL.'))
    }
    const token = repository.apiKey?.trim()
    if (!token) {
      throw new Error(nls.localize('rockit/dataRepository/zenodoTokenMissing', 'Zenodo API token is missing.'))
    }

    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const rootUri = this.getWorkspaceRoot()
    const localCrate = await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json'))
    const deposition = await this.fetchZenodoDeposition(baseUrl, token, depositionId)
    const files = await this.fetchZenodoDepositionFiles(baseUrl, token, depositionId)
    const target = this.readNestedString(deposition, ['links', 'html']) ?? `${baseUrl}/deposit/${encodeURIComponent(depositionId)}`

    return {
      pid: depositionId,
      target,
      localCrate,
      remoteDatasetTitle: this.readNestedString(deposition, ['metadata', 'title']),
      mapping: this.buildZenodoEntityIdMapping(localCrate, files),
    }
  }

  protected buildArpEntityIdMapping(
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

  protected buildNativeDataverseEntityIdMapping(
    localCrate: RoCrate,
    remoteFiles: NativeDataverseRemoteFileRecord[],
  ): RoCrateEntityIdMapping {
    const remoteFilesByPath = new Map(remoteFiles.map((file) => [file.path, file.id]))
    const mapping: RoCrateEntityIdMapping = {}
    for (const entity of this.readGraphEntities(localCrate)) {
      if (!this.entityTypes(entity).includes('File')) {
        continue
      }
      const id = this.readOptionalEntityString(entity, '@id')
      const path = this.dataverseFilePathFromEntity(entity)
      if (id && path) {
        mapping[id] = remoteFilesByPath.get(path) ?? ''
      }
    }
    const metadataFileId = remoteFilesByPath.get('ro-crate-metadata.json')
    if (metadataFileId) {
      mapping['ro-crate-metadata.json'] = metadataFileId
    }
    return Object.fromEntries(
      Object.entries(mapping).sort((a, b) => a[0].localeCompare(b[0])),
    )
  }

  protected buildZenodoEntityIdMapping(
    localCrate: RoCrate,
    remoteFiles: ZenodoRemoteFileRecord[],
  ): RoCrateEntityIdMapping {
    const localPaths = this.extractCrateFilePaths(localCrate)
    const filenamesByPath = this.buildZenodoFilenameMap(localPaths)
    const remoteFilesByFilename = new Map(remoteFiles.map((file) => [file.filename, file.id]))
    const mapping: RoCrateEntityIdMapping = {}
    const metadataFileId = remoteFilesByFilename.get('ro-crate-metadata.json')
    if (metadataFileId) {
      mapping['ro-crate-metadata.json'] = metadataFileId
    }
    for (const entity of this.readGraphEntities(localCrate)) {
      if (!this.entityTypes(entity).includes('File')) {
        continue
      }
      const id = this.readOptionalEntityString(entity, '@id')
      const path = this.dataverseFilePathFromEntity(entity)
      if (id && path) {
        const filename = filenamesByPath.get(path) ?? this.sanitizeZenodoFilename(path)
        mapping[id] = remoteFilesByFilename.get(filename) ?? ''
      }
    }
    return Object.fromEntries(
      Object.entries(mapping).sort((a, b) => a[0].localeCompare(b[0])),
    )
  }

  protected async fetchNativeDataverseDataset(
    baseUrl: string,
    apiKey: string | undefined,
    pid: string,
  ): Promise<{ title?: string; files: NativeDataverseRemoteFileRecord[] }> {
    const data = await this.fetchNativeDataverseDatasetVersion(baseUrl, apiKey, pid, ':draft')
      .catch(() => this.fetchNativeDataverseDatasetVersion(baseUrl, apiKey, pid, ':latest'))
    return {
      title: this.extractNativeDataverseDatasetTitle(data),
      files: this.extractNativeDataverseFileRecords(data),
    }
  }

  protected async fetchNativeDataverseDatasetVersion(
    baseUrl: string,
    apiKey: string | undefined,
    pid: string,
    version: ':draft' | ':latest',
  ): Promise<Record<string, unknown>> {
    const requestUrl = `${baseUrl}/api/datasets/:persistentId/versions/${version}?persistentId=${encodeURIComponent(pid)}`
    const headers: Record<string, string> = { accept: 'application/json' }
    if (apiKey) {
      headers['x-dataverse-key'] = apiKey
    }
    const response = await this.fetchWithTimeout(requestUrl, { headers })
    const payload = await this.readResponsePayload(response)
    if (!response.ok || this.payloadHasErrorStatus(payload)) {
      throw new Error(nls.localize(
        'rockit/dataRepository/datasetMetadataFetchFailed',
        'Failed to retrieve Dataverse dataset metadata ({0}): {1}',
        response.status,
        this.payloadSummary(payload),
      ))
    }
    const data = this.readObjectProperty(payload, 'data')
    if (!data) {
      throw new Error(nls.localize(
        'rockit/dataRepository/datasetMetadataMissingData',
        'Dataverse dataset metadata response did not contain a data object.',
      ))
    }
    return data
  }

  protected extractNativeDataverseDatasetTitle(data: Record<string, unknown>): string | undefined {
    const fields = this.extractObjects(data).filter((item) => item.typeName === 'title')
    for (const field of fields) {
      const value = field.value
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }
    return undefined
  }

  protected extractNativeDataverseFileRecords(value: unknown): NativeDataverseRemoteFileRecord[] {
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.extractNativeDataverseFileRecords(item))
    }
    if (!value || typeof value !== 'object') {
      return []
    }
    const record = value as Record<string, unknown>
    const dataFile = this.readObjectProperty(record, 'dataFile')
    if (dataFile) {
      const id = this.readOptionalString(dataFile.id)
      const label =
        this.readOptionalString(record.label) ??
        this.readOptionalString(dataFile.filename)
      if (id && label) {
        const directoryLabel =
          this.readOptionalString(record.directoryLabel) ??
          this.readOptionalString(dataFile.directoryLabel)
        return [{ id, path: this.joinRemoteFilePath(directoryLabel, label) }]
      }
    }
    return Object.values(record).flatMap((child) => this.extractNativeDataverseFileRecords(child))
  }

  protected async fetchZenodoDeposition(
    baseUrl: string,
    token: string,
    depositionId: string,
  ): Promise<Record<string, unknown>> {
    const requestUrl = new URL(
      `/api/deposit/depositions/${encodeURIComponent(depositionId)}`,
      `${baseUrl}/`,
    ).toString()
    const response = await this.fetchWithTimeout(requestUrl, {
      headers: this.zenodoAuthorizationHeaders(token),
    })
    const payload = await this.readResponsePayload(response)
    if (!response.ok) {
      throw new Error(nls.localize(
        'rockit/dataRepository/zenodoLookupFailedWithStatus',
        'Zenodo deposition lookup failed ({0}) at {1}: {2}',
        response.status,
        response.url || requestUrl,
        this.payloadSummary(payload),
      ))
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error(nls.localize(
        'rockit/dataRepository/invalidZenodoDepositionResponse',
        'Zenodo returned an invalid deposition response.',
      ))
    }
    return payload as Record<string, unknown>
  }

  protected async fetchZenodoDepositionFiles(
    baseUrl: string,
    token: string,
    depositionId: string,
  ): Promise<ZenodoRemoteFileRecord[]> {
    const requestUrl = new URL(
      `/api/deposit/depositions/${encodeURIComponent(depositionId)}/files`,
      `${baseUrl}/`,
    ).toString()
    const response = await this.fetchWithTimeout(requestUrl, {
      headers: this.zenodoAuthorizationHeaders(token),
    })
    const payload = await this.readResponsePayload(response)
    if (!response.ok) {
      throw new Error(nls.localize(
        'rockit/dataRepository/zenodoFileListingFailedWithStatus',
        'Zenodo file listing failed ({0}) at {1}: {2}',
        response.status,
        response.url || requestUrl,
        this.payloadSummary(payload),
      ))
    }
    if (!Array.isArray(payload)) {
      throw new Error(nls.localize(
        'rockit/dataRepository/invalidZenodoFileList',
        'Zenodo returned an invalid deposition file list.',
      ))
    }
    return payload.map((item) => this.toZenodoRemoteFileRecord(item))
  }

  protected toZenodoRemoteFileRecord(value: unknown): ZenodoRemoteFileRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(nls.localize(
        'rockit/dataRepository/invalidZenodoFileEntry',
        'Zenodo returned an invalid deposition file entry.',
      ))
    }
    const record = value as Record<string, unknown>
    const filename = this.readOptionalString(record.filename) ?? this.readOptionalString(record.name) ?? this.readOptionalString(record.key)
    if (!filename) {
      throw new Error(nls.localize(
        'rockit/dataRepository/zenodoFileMissingFilename',
        'Zenodo returned a deposition file without a filename.',
      ))
    }
    return {
      id: this.readOptionalString(record.id) ?? this.extractUploadedFileRemoteId(record) ?? filename,
      filename,
    }
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
        nls.localize(
          'rockit/dataRepository/remoteRoCrateFetchFailed',
          'Failed to retrieve remote RO-Crate ({0}) at {1}: {2}',
          response.status,
          response.url || requestUrl,
          this.payloadSummary(payload),
        ),
      )
    }
    const crate = this.extractDataverseCrate(payload)
    if (!crate) {
      throw new Error(nls.localize('rockit/dataRepository/invalidRemoteRoCrateResponse', 'The ARP RO-Crate response did not contain a valid @graph.'))
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
      throw new Error(nls.localize('rockit/dataRepository/workspaceMetadataNotFound', 'ro-crate-metadata.json was not found in the workspace root.'))
    }
    const content = await this.fileService.readFile(metadataUri)
    try {
      return JSON.parse(content.value.toString()) as RoCrate
    } catch (error) {
      throw new Error(
        nls.localize(
          'rockit/dataRepository/parseWorkspaceMetadataFailed',
          'Failed to parse ro-crate-metadata.json: {0}',
          error instanceof Error ? error.message : String(error),
        ),
      )
    }
  }

  protected getWorkspaceRoot(): URI {
    const roots = this.workspaceService.tryGetRoots()
    const root = roots?.[0]?.resource
    if (!root) {
      throw new Error(nls.localize('rockit/dataRepository/noWorkspace', 'No workspace is open.'))
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
      .sort((a, b) => (b.lastSuccessfulActionAt ?? '').localeCompare(a.lastSuccessfulActionAt ?? ''))[0]?.mappingFile
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

  protected extractZenodoDepositionId(value: string): string | undefined {
    const trimmed = value.trim()
    const direct = trimmed.match(/^(?:zenodo:)?(\d+)$/i)
    if (direct) {
      return direct[1]
    }
    try {
      const url = new URL(trimmed)
      const match = url.pathname.match(/\/(?:deposit|record)\/(\d+)/)
      return match?.[1]
    } catch {
      return undefined
    }
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
      throw new Error(nls.localize('rockit/dataRepository/emptyRepositoryBaseUrl', 'Repository base URL is empty.'))
    }
    return normalized.endsWith('/api/v1') ? normalized.slice(0, -'/api/v1'.length) : normalized
  }

  protected buildDataverseDatasetUrl(baseUrl: string, pid?: string): string | undefined {
    return pid
      ? `${baseUrl}/dataset.xhtml?persistentId=${encodeURIComponent(pid)}`
      : undefined
  }

  protected extractCrateFilePaths(crate: RoCrate): string[] {
    const files = new Set<string>()
    for (const entity of this.readGraphEntities(crate)) {
      if (!this.entityTypes(entity).includes('File')) {
        continue
      }
      const path = this.dataverseFilePathFromEntity(entity)
      if (path && path !== 'ro-crate-metadata.json') {
        files.add(path)
      }
    }
    return Array.from(files).sort((a, b) => a.localeCompare(b))
  }

  protected buildZenodoFilenameMap(entryPaths: string[]): Map<string, string> {
    const used = new Set<string>()
    const filenames = new Map<string, string>()
    for (const entryPath of entryPaths) {
      const preferred = this.sanitizeZenodoFilename(entryPath)
      let candidate = preferred
      let suffix = 2
      while (used.has(candidate)) {
        candidate = this.addFilenameSuffix(preferred, suffix)
        suffix += 1
      }
      used.add(candidate)
      filenames.set(entryPath, candidate)
    }
    return filenames
  }

  protected sanitizeZenodoFilename(filename: string): string {
    const sanitized = filename
      .replace(/\\/g, '/')
      .replace(/\//g, '__')
      .replace(/[\u0000-\u001f]/g, '_')
      .trim()
    return sanitized || 'file'
  }

  protected addFilenameSuffix(filename: string, suffix: number): string {
    const index = filename.lastIndexOf('.')
    if (index <= 0) {
      return `${filename}-${suffix}`
    }
    return `${filename.slice(0, index)}-${suffix}${filename.slice(index)}`
  }

  protected extractUploadedFileRemoteId(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return undefined
    }
    const record = payload as Record<string, unknown>
    for (const key of ['id', 'key', 'filename']) {
      const value = this.readOptionalString(record[key])
      if (value) {
        return value
      }
    }
    return (
      this.readNestedString(record, ['links', 'self']) ??
      this.readNestedString(record, ['links', 'download'])
    )
  }

  protected joinRemoteFilePath(directoryLabel: string | undefined, label: string): string {
    const name = label.replace(/^\/+/, '')
    const directory = directoryLabel?.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
    return directory ? `${directory}/${name}` : name
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

  protected extractObjects(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.extractObjects(item))
    }
    if (!value || typeof value !== 'object') {
      return []
    }
    const record = value as Record<string, unknown>
    return [record, ...Object.values(record).flatMap((child) => this.extractObjects(child))]
  }

  protected readObjectProperty(
    value: unknown,
    key: string,
  ): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined
    }
    const property = (value as Record<string, unknown>)[key]
    return property && typeof property === 'object' && !Array.isArray(property)
      ? property as Record<string, unknown>
      : undefined
  }

  protected readNestedString(value: unknown, path: string[]): string | undefined {
    let current = value
    for (const segment of path) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return undefined
      }
      current = (current as Record<string, unknown>)[segment]
    }
    return this.readOptionalString(current)
  }

  protected readOptionalString(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
    return undefined
  }

  protected payloadHasErrorStatus(payload: unknown): boolean {
    return (
      !!payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      (payload as Record<string, unknown>).status === 'ERROR'
    )
  }

  protected zenodoAuthorizationHeaders(token: string): Record<string, string> {
    return { accept: 'application/json', authorization: `Bearer ${token}` }
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

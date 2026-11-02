// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import { nls } from '@theia/core/lib/common/nls'
import { FileUri } from '@theia/core/lib/common/file-uri'
import { URI } from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import {
  localizeExternalRoCrateFileReferences,
  RoCrateExportFileSource,
} from 'rockit-common/lib/common/ro-crate-export-file-references'
import { inject, injectable } from 'inversify'
import { RoCratePersistenceService } from 'save-ro-crate/lib/browser/ro-crate-persistence-service'
import {
  DataRepositoryConfig,
  DataRepositoryExportTarget,
  DataverseCollection,
  RepositorySyncMode,
} from '../types'
import type { NativeDataverseDatasetMetadata } from './native-dataverse-export-service'
import {
  appendExportLogEvent,
  ExportLogEntry,
  normalizeExportLogEntries,
  serializeExportLogEntries,
} from './export-log'
import { DataverseMetadataMappingService } from './dataverse-metadata-mapping-service'
import { buildArpDatasetCreationPayload } from './arp-dataset-creation-payload'
import { FileHashStoreService } from './file-hash-store-service'
import { mergeRoCratesForSync } from './ro-crate-sync-merge'
import { extendMappingWithMetadataEntities } from './ro-crate-metadata-entity-mapping'

type RoCrateEntity = Record<string, any>
type RoCrate = Record<string, any>
type RoCrateEntityIdMapping = Record<string, string>

export interface ArpRoCrateValidationIssue {
  errorField?: string
  errorMessage?: string
  errorSuggestion?: string
}

export interface ArpRoCrateValidationEntityError {
  errorEntity: string
  errors: ArpRoCrateValidationIssue[]
}

export class ArpRoCrateValidationError extends Error {
  constructor(
    public readonly status: number,
    public readonly requestUrl: string,
    public readonly validationErrors: ArpRoCrateValidationEntityError[],
    public readonly payload: unknown,
  ) {
    super(
      `Server RO-Crate validation failed with ${validationErrors.length} invalid entit${validationErrors.length === 1 ? 'y' : 'ies'}.`,
    )
    this.name = 'ArpRoCrateValidationError'
    Object.setPrototypeOf(this, ArpRoCrateValidationError.prototype)
  }
}

interface LocalizedExternalFileReferences {
  entries: Map<string, URI>
  originalToUploadIds: Map<string, string>
}

export interface PreparedArpCreateExport {
  crate: RoCrate
  uploadCrate: RoCrate
  fileSources: Array<{
    entityId: string
    entryPath: string
    sourceUri: string
    lastModified?: number
    sourceSize?: number
  }>
  originalToUploadIds: Record<string, string>
}

export interface ArpProviderCreateResult {
  pid: string
  creationResponse: unknown
  processedRemoteCrate?: RoCrate
  uploadCrate: RoCrate
  uploadIdMapping: RoCrateEntityIdMapping
  interrupted?: boolean
  errorMessage?: string
  fileResults: Array<{
    entityId: string
    entryPath: string
    remoteId: string
    md5?: string
    lastModified?: number
    sourceSize?: number
  }>
}

export interface ArpProviderCreateValidationResult {
  validationFailure: {
    status: number
    url: string
    validationErrors: ArpRoCrateValidationEntityError[]
    payload: unknown
  }
}

export interface ArpProviderCreateCheckpoint {
  operationId: string
  providerId: 'arp'
  stage: 'datasetCreated' | 'fileUploaded'
  pid: string
  creationResponse?: unknown
  fileResult?: ArpProviderCreateResult['fileResults'][number]
}

export interface PreparedArpUpdateFile {
  metadataEntityId: string
  uploadEntityId: string
  entryPath: string
  sourceUri: string
  lastModified?: number
  sourceSize?: number
  remoteId?: string
  remoteFileId?: number
  description?: string
}

export interface PreparedArpUpdateExport {
  pid: string
  target: string
  crate: RoCrate
  uploadCrate: RoCrate
  remoteCrate: RoCrate
  mappingFileName: string
  metadataIdMapping: RoCrateEntityIdMapping
  uploadIdMapping: RoCrateEntityIdMapping
  originalToUploadIds: Record<string, string>
  addedFiles: PreparedArpUpdateFile[]
  changedFiles: PreparedArpUpdateFile[]
  removedFiles: Array<{ remoteId: string; remoteFileId: number }>
}

export interface ArpProviderUpdateFileResult {
  kind: 'added' | 'changed'
  metadataEntityId: string
  uploadEntityId: string
  entryPath: string
  remoteId: string
  md5?: string
  lastModified?: number
  sourceSize?: number
}

export interface ArpProviderUpdateResult {
  providerId: 'arp'
  pid: string
  processedRemoteCrate: RoCrate
  uploadCrate: RoCrate
  uploadIdMapping: RoCrateEntityIdMapping
  fileResults: ArpProviderUpdateFileResult[]
  removedRemoteIds: string[]
}

export interface ArpProviderUpdateCheckpoint {
  operationId: string
  providerId: 'arp'
  stage: 'fileUploaded' | 'fileReplaced' | 'fileRemoved'
  pid: string
  fileResult?: ArpProviderUpdateFileResult
  remoteId?: string
}

export interface PreparedArpSyncFile {
  remoteId: string
  remoteFileId: number
  localId: string
  localPath: string
  targetUri: string
  targetParentUri: string
  md5?: string
  kind: 'new' | 'changed'
}

export interface PreparedArpSyncExport {
  pid: string
  target: string
  localCrate: RoCrate
  remoteCrate: RoCrate
  exportLogEntry: ExportLogEntry
  mappingFileName: string
  initialMetadataMapping: RoCrateEntityIdMapping
  metadataMapping: RoCrateEntityIdMapping
  relocatedLocalIds: RoCrateEntityIdMapping
  metadataMode: RepositorySyncMode
  files: PreparedArpSyncFile[]
  keptLocalFileCount: number
  removedRemoteFileCount: number
}

export interface ArpProviderSyncResult {
  providerId: 'arp'
  pid: string
  downloadedFiles: PreparedArpSyncFile[]
}

export interface ArpProviderSyncCheckpoint {
  operationId: string
  providerId: 'arp'
  stage: 'fileDownloaded'
  pid: string
  file: PreparedArpSyncFile
}

interface ActiveArpProviderCreate {
  rootUri: URI
  repository: DataRepositoryConfig
  plan: PreparedArpCreateExport
  mappingFileName: string
  originalToUploadIds: Map<string, string>
  uploadIdMapping: RoCrateEntityIdMapping
  checkpointedFiles: Set<string>
  pid?: string
  target?: string
  logStarted: boolean
}

interface ActiveArpProviderUpdate {
  rootUri: URI
  plan: PreparedArpUpdateExport
  metadataIdMapping: RoCrateEntityIdMapping
  uploadIdMapping: RoCrateEntityIdMapping
  checkpointedFiles: Set<string>
  removedRemoteIds: Set<string>
}

interface ActiveArpProviderSync {
  rootUri: URI
  plan: PreparedArpSyncExport
  metadataMapping: RoCrateEntityIdMapping
  checkpointedFiles: Set<string>
}

interface ArpUploadFileSource {
  entityId: string
  entryPath: string
  uri: URI
  lastModified?: number
  sourceSize?: number
}

interface ArpExportTarget {
  pid: string
  exportLogEntry?: ExportLogEntry
  mapping?: RoCrateEntityIdMapping
}

export interface ArpRoCrateExportResult {
  pid?: string
  target?: string
  dataverseUrl?: string
  requestUrl: string
  response: unknown
  ingestedCrate?: RoCrate
  mappingFileName: string
  unmappedEntityIds: string[]
}

export interface ArpRoCrateUpdateAnalysisResult {
  pid: string
  target: string
  addedFileCount: number
  removedFileCount: number
  changedFileCount: number
  mappingFileName?: string
  unmappedEntityIds: string[]
}

export interface ArpRoCrateSyncResult {
  pid: string
  target: string
  downloadedFileCount: number
  replacedFileCount: number
  removedRemoteFileCount: number
  mappingFileName: string
  unmappedEntityIds: string[]
}

export interface ArpRoCrateUpdateProgress {
  completedSteps: number
  totalSteps: number
  message: string
}

export type ArpRoCrateUpdateProgressReporter = (update: ArpRoCrateUpdateProgress) => void
export type ArpRoCrateExportProgressReporter = (update: ArpRoCrateUpdateProgress) => void

const DATAVERSE_FILE_CONTEXT: Record<string, string> = {
  contentSize: 'https://schema.org/contentSize',
  dateModified: 'https://schema.org/dateModified',
  description: 'https://schema.org/description',
  directoryLabel: 'https://dataverse.org/schema/file/directoryLabel',
  encodingFormat: 'https://schema.org/encodingFormat',
  hash: 'https://dataverse.org/schema/file/hash',
  url: 'https://schema.org/url',
}
const EXPORT_LOG_FILE_NAME = 'export-log.json'
const DATAVERSE_CROSSWALK_FILE_NAME = 'arp-dataverse-crosswalk.json'

@injectable()
export class ArpRoCrateExportService {
  protected activeExportLogEntry: ExportLogEntry | undefined
  protected readonly activeProviderCreates = new Map<string, ActiveArpProviderCreate>()
  protected readonly activeProviderUpdates = new Map<string, ActiveArpProviderUpdate>()
  protected readonly activeProviderSyncs = new Map<string, ActiveArpProviderSync>()
  constructor(
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
    @inject(FileService) protected readonly fileService: FileService,
    @inject(DataverseMetadataMappingService)
    protected readonly metadataMappingService: DataverseMetadataMappingService,
    @inject(FileHashStoreService)
    protected readonly fileHashStoreService: FileHashStoreService,
    @inject(AppStateService)
    protected readonly appStateService: AppStateService,
    @inject(RoCratePersistenceService)
    protected readonly roCratePersistenceService: RoCratePersistenceService,
  ) {}

  public async listExportTargets(
    repositories: DataRepositoryConfig[],
  ): Promise<Record<string, DataRepositoryExportTarget[]>> {
    const rootUri = this.getWorkspaceRoot()
    const currentDatasetName = await this.tryReadCurrentRootDatasetName(rootUri)
    const entries = await this.readExportLogEntries(
      rootUri.resolve('.rockit').resolve(EXPORT_LOG_FILE_NAME),
    )
    const targetsByRepositoryId: Record<string, DataRepositoryExportTarget[]> = {}

    for (const repository of repositories) {
      const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
      const latestByMappingFile = new Map<string, DataRepositoryExportTarget>()
      for (const entry of entries) {
        if (this.normalizeBaseUrl(entry.repository) !== baseUrl) {
          continue
        }
        const pid = this.extractPidFromTarget(entry.target)
        if (!pid || !entry.mappingFile) {
          continue
        }
        latestByMappingFile.set(entry.mappingFile, {
          pid,
          target: this.buildDataverseDatasetUrl(baseUrl, pid) ?? entry.target,
          repository: entry.repository,
          mappingFile: entry.mappingFile,
          crosswalkFile: entry.crosswalkFile,
          lastSuccessfulActionAt: entry.lastSuccessfulActionAt,
          syncType: entry.syncType,
          status: entry.status,
          errorMessage: entry.errorMessage,
          datasetName: entry.datasetName ?? currentDatasetName,
        })
      }
      targetsByRepositoryId[repository.id] = Array.from(latestByMappingFile.values())
        .sort((a, b) => (b.lastSuccessfulActionAt ?? '').localeCompare(a.lastSuccessfulActionAt ?? ''))
    }

    return targetsByRepositoryId
  }

  protected getWorkspaceRoot(): URI {
    const roots = this.workspaceService.tryGetRoots()
    const root = roots?.[0]?.resource
    if (!root) {
      throw new Error(nls.localize('rockit/dataRepository/noWorkspace', 'No workspace is open.'))
    }
    return root
  }

  protected async readRoCrate(metadataUri: URI): Promise<RoCrate> {
    if (!(await this.fileService.exists(metadataUri))) {
      throw new Error(nls.localize(
        'rockit/dataRepository/metadataFileNotFound',
        'ro-crate-metadata.json was not found in the workspace root.',
      ))
    }
    const content = await this.fileService.readFile(metadataUri)
    try {
      return JSON.parse(content.value.toString()) as RoCrate
    } catch (error) {
      throw new Error(
        nls.localize(
          'rockit/dataRepository/parseMetadataFailed',
          'Failed to parse ro-crate-metadata.json: {0}',
          error instanceof Error ? error.message : String(error),
        ),
      )
    }
  }

  /** Prepare local content without making a repository API request. */
  public async prepareCreateExport(rootUri: URI): Promise<PreparedArpCreateExport> {
    const crate = await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json'))
    const uploadCrate = await this.buildDataverseUploadCrate(crate, rootUri)
    this.removeRootArpPid(uploadCrate)
    const localized = await this.localizeExternalLocalFileReferences(uploadCrate, rootUri)
    const fileSources = await this.collectUploadFileSources(
      uploadCrate,
      rootUri,
      localized.entries,
      localized.originalToUploadIds,
    )
    return {
      crate,
      uploadCrate,
      fileSources: fileSources.map(source => ({
        entityId: source.entityId,
        entryPath: source.entryPath,
        sourceUri: source.uri.toString(),
        lastModified: source.lastModified,
        sourceSize: source.sourceSize,
      })),
      originalToUploadIds: Object.fromEntries(localized.originalToUploadIds),
    }
  }

  /** RocKIT owns preparation and local state; the provider only performs remote requests. */
  public async exportToArpWithProvider(
    repository: DataRepositoryConfig,
    collection: DataverseCollection,
    datasetMetadata: NativeDataverseDatasetMetadata,
    invokeProvider: (input: {
      repository: DataRepositoryConfig
      collectionId: string
      datasetCreationPayload: Record<string, unknown>
      plan: PreparedArpCreateExport
      operationId: string
    }) => Promise<ArpProviderCreateResult | ArpProviderCreateValidationResult>,
  ): Promise<ArpRoCrateExportResult> {
    const rootUri = this.getWorkspaceRoot()
    const plan = await this.prepareCreateExport(rootUri)
    const collectionId = collection.alias || collection.id
    const originalToUploadIds = new Map(Object.entries(plan.originalToUploadIds))
    const mappingFileName = await this.createUniqueMappingFileName(rootUri)
    const operationId = this.randomId(32)
    const checkpoint: ActiveArpProviderCreate = {
      rootUri, repository, plan, mappingFileName, originalToUploadIds,
      uploadIdMapping: this.buildInitialUploadEntityIdMapping(plan.uploadCrate),
      checkpointedFiles: new Set(), logStarted: false,
    }
    this.activeProviderCreates.set(operationId, checkpoint)
    try {
      const remote = await invokeProvider({
        repository,
        collectionId,
        datasetCreationPayload: buildArpDatasetCreationPayload(
          datasetMetadata,
          this.metadataMappingService.requiredFields('citation'),
        ),
        plan,
        operationId,
      })
      if ('validationFailure' in remote) {
        const failure = remote.validationFailure
        throw new ArpRoCrateValidationError(
          failure.status, failure.url, failure.validationErrors, failure.payload)
      }
      if (!remote?.pid || !Array.isArray(remote.uploadCrate?.['@graph']) ||
          !remote.uploadIdMapping || !Array.isArray(remote.fileResults) ||
          (!remote.interrupted && (remote.fileResults.length !== plan.fileSources.length ||
            !Array.isArray(remote.processedRemoteCrate?.['@graph'])))) {
        throw new Error('The ARP provider did not return a complete dataset creation result.')
      }
      if (!checkpoint.logStarted) {
        await this.handleProviderCreateCheckpoint({
          operationId, providerId: 'arp', stage: 'datasetCreated', pid: remote.pid,
          creationResponse: remote.creationResponse,
        })
      }

      const uploadedFileHashes: Array<{
        localEntityId: string
        uploadEntityId: string
        md5: string
      }> = []
      for (const file of remote.fileResults) {
        const planned = plan.fileSources.find(source =>
          source.entityId === file.entityId && source.entryPath === file.entryPath)
        if (!planned || !file.remoteId || remote.uploadIdMapping[file.entityId] !== file.remoteId) {
          throw new Error('The ARP provider returned an inconsistent uploaded-file mapping.')
        }
        const fileKey = this.providerCreateFileKey(file.entityId, file.entryPath)
        if (!checkpoint.checkpointedFiles.has(fileKey)) {
          await this.handleProviderCreateCheckpoint({
            operationId, providerId: 'arp', stage: 'fileUploaded', pid: remote.pid,
            fileResult: file,
          })
        }
        if (file.md5) {
          uploadedFileHashes.push({
            localEntityId: file.entityId,
            uploadEntityId: originalToUploadIds.get(file.entityId) ?? file.entityId,
            md5: file.md5,
          })
        }
      }
      await this.persistUploadedFileHashes(
        rootUri, plan.crate, remote.uploadCrate, uploadedFileHashes)

      if (remote.interrupted) {
        throw new Error(remote.errorMessage || 'ARP export stopped after creating the remote dataset.')
      }

      const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
      const dataverseUrl = this.buildDataverseDatasetUrl(baseUrl, remote.pid)
      const target = dataverseUrl || checkpoint.target ||
        this.buildDatasetPidTarget(remote.pid) || remote.pid
      const completeMapping = extendMappingWithMetadataEntities(
        remote.uploadCrate, remote.processedRemoteCrate!, remote.uploadIdMapping)
      const metadataIdMapping = this.toMetadataEntityIdMapping(plan.crate, completeMapping, originalToUploadIds)
      await this.saveEntityIdMapping(rootUri, mappingFileName, metadataIdMapping)
      const restoredCrate = this.buildRestoredCreatedCrate(remote.uploadCrate, remote.uploadIdMapping, remote.pid)
      await this.appendExportLog(rootUri, {
        target, repository: baseUrl, mappingFile: mappingFileName,
        crosswalkFile: repository.crosswalkId ?? DATAVERSE_CROSSWALK_FILE_NAME,
        syncType: 'create', status: 'success', lastSuccessfulActionAt: new Date().toISOString(),
        datasetName: this.getRootDatasetName(plan.crate),
      })
      return {
        pid: remote.pid, target, dataverseUrl,
        requestUrl: `${baseUrl}/api/v1/dataverses/${encodeURIComponent(collectionId)}/datasets`,
        response: remote.creationResponse,
        ingestedCrate: restoredCrate,
        mappingFileName,
        unmappedEntityIds: Object.entries(metadataIdMapping)
          .filter(([, ingestedId]) => !ingestedId)
          .map(([metadataId]) => metadataId),
      }
    } finally {
      this.activeProviderCreates.delete(operationId)
    }
  }

  public async handleProviderCreateCheckpoint(value: ArpProviderCreateCheckpoint): Promise<void> {
    if (!value || value.providerId !== 'arp' || typeof value.operationId !== 'string') {
      throw new Error('The ARP export checkpoint is invalid.')
    }
    const active = this.activeProviderCreates.get(value.operationId)
    if (!active) {
      throw new Error('The ARP export checkpoint no longer has an active RocKIT export.')
    }
    if (typeof value.pid !== 'string' || !value.pid.trim()) {
      throw new Error('The ARP export checkpoint does not contain a dataset PID.')
    }
    if (active.pid && active.pid !== value.pid) {
      throw new Error('The ARP export checkpoint refers to a different dataset PID.')
    }
    active.pid = value.pid

    if (!active.logStarted) {
      const baseUrl = this.normalizeBaseUrl(active.repository.baseUrl)
      active.target = this.buildDataverseDatasetUrl(baseUrl, value.pid) ||
        this.buildDatasetPidTarget(value.pid) || value.pid
      await this.saveEntityIdMapping(
        active.rootUri, active.mappingFileName,
        this.toMetadataEntityIdMapping(
          active.plan.crate, active.uploadIdMapping, active.originalToUploadIds),
      )
      await this.appendExportLog(active.rootUri, {
        target: active.target, repository: baseUrl, mappingFile: active.mappingFileName,
        crosswalkFile: active.repository.crosswalkId ?? DATAVERSE_CROSSWALK_FILE_NAME,
        syncType: 'create', status: 'cancelled',
        datasetName: this.getRootDatasetName(active.plan.crate),
      })
      active.logStarted = true
    }

    if (value.stage === 'datasetCreated') {
      return
    }
    const file = value.fileResult
    const planned = file && active.plan.fileSources.find(source =>
      source.entityId === file.entityId && source.entryPath === file.entryPath)
    if (!file || !planned || typeof file.remoteId !== 'string' || !file.remoteId.trim()) {
      throw new Error('The ARP uploaded-file checkpoint is inconsistent with the export plan.')
    }
    active.uploadIdMapping[file.entityId] = file.remoteId
    if (file.entryPath !== file.entityId) {
      active.uploadIdMapping[file.entryPath] = file.remoteId
    }
    await this.saveEntityIdMapping(
      active.rootUri, active.mappingFileName,
      this.toMetadataEntityIdMapping(
        active.plan.crate, active.uploadIdMapping, active.originalToUploadIds),
    )
    await this.fileHashStoreService.recordKnownHash(
      active.rootUri, file.entityId, planned.lastModified, planned.sourceSize, file.md5)
    active.checkpointedFiles.add(this.providerCreateFileKey(file.entityId, file.entryPath))
  }

  protected providerCreateFileKey(entityId: string, entryPath: string): string {
    return `${entityId}\0${entryPath}`
  }

  /** Prepare the local diff while leaving every repository HTTP request to the provider. */
  public async prepareUpdateExport(
    repository: DataRepositoryConfig,
    remoteCrate: RoCrate,
    exportTargetSelection?: DataRepositoryExportTarget,
  ): Promise<PreparedArpUpdateExport | undefined> {
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const rootUri = this.getWorkspaceRoot()
    const metadataCrate = await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json'))
    const exportTarget = await this.resolveExistingArpExportTarget(
      rootUri, repository, metadataCrate, exportTargetSelection)
    if (!exportTarget) return undefined
    if (!exportTarget.exportLogEntry?.mappingFile || !exportTarget.mapping) {
      throw new Error(nls.localize(
        'rockit/dataRepository/arpMissingExportMapping',
        'This workspace has an ARP PID, but no existing export-log mapping file could be loaded for this repository. Update will not create a second mapping file.',
      ))
    }

    const uploadCrate = await this.buildDataverseUploadCrate(metadataCrate, rootUri)
    const localized = await this.localizeExternalLocalFileReferences(uploadCrate, rootUri)
    const metadataIdMapping = { ...exportTarget.mapping }
    const uploadIdMapping = extendMappingWithMetadataEntities(
      uploadCrate,
      remoteCrate,
      this.toUploadEntityIdMapping(metadataIdMapping, localized.originalToUploadIds),
    )
    const diff = this.diffRoCrates(uploadCrate, remoteCrate, uploadIdMapping, {
      pid: exportTarget.pid,
      repository: baseUrl,
      exportLogEntry: exportTarget.exportLogEntry,
    })
    const localEntitiesById = new Map(this.readGraphEntities(uploadCrate)
      .map(entity => [this.requireEntityId(entity), entity]))
    const remoteEntitiesById = new Map(this.readGraphEntities(remoteCrate)
      .map(entity => [this.requireEntityId(entity), entity]))
    const uploadIdToMetadataId = this.toOriginalEntityIdMapping(localized.originalToUploadIds)
    const newFileDiffs = diff.newFiles as Array<{ localId: string }>
    const removedFileDiffs = diff.removedFiles as Array<{ remoteId: string }>
    const newLocalFileIds = new Set<string>(newFileDiffs.map(file => file.localId))
    const changedIds: Array<{ localId: string; remoteId: string }> = []
    const storedFileHashes = await this.fileHashStoreService.readFileHashes(rootUri)
    for (const [localId, localEntity] of localEntitiesById) {
      if (!this.entityTypes(localEntity).includes('File') || newLocalFileIds.has(localId)) continue
      const remoteId = uploadIdMapping[localId] || localId
      const remoteEntity = remoteEntitiesById.get(remoteId)
      if (!remoteEntity) continue
      const source = await this.resolveUploadFileSource(
        localEntity, rootUri, localized.entries, localized.originalToUploadIds)
      const remoteSizeValue = this.readOptionalEntityString(remoteEntity, 'contentSize')
      const remoteSize = remoteSizeValue === undefined ? undefined : Number(remoteSizeValue)
      if (!this.fileHashStoreService.isFileRecordUnchanged(storedFileHashes[source.entityId], {
        localLastModified: source.lastModified,
        localSize: source.sourceSize,
        remoteMd5: this.readOptionalEntityString(remoteEntity, 'hash'),
        remoteSize: remoteSize !== undefined && Number.isFinite(remoteSize) ? remoteSize : undefined,
      })) {
        changedIds.push({ localId, remoteId })
      }
    }

    const toPreparedFile = async (
      localId: string,
      remoteId?: string,
    ): Promise<PreparedArpUpdateFile> => {
      const entity = localEntitiesById.get(localId)
      if (!entity) throw new Error(`Cannot prepare ARP update file '${localId}'.`)
      const source = await this.resolveUploadFileSource(
        entity, rootUri, localized.entries, localized.originalToUploadIds)
      const remoteEntity = remoteId ? remoteEntitiesById.get(remoteId) : undefined
      return {
        metadataEntityId: uploadIdToMetadataId[localId] ?? localId,
        uploadEntityId: localId,
        entryPath: source.entryPath,
        sourceUri: source.uri.toString(),
        lastModified: source.lastModified,
        sourceSize: source.sourceSize,
        ...(remoteId ? { remoteId } : {}),
        ...(remoteEntity ? { remoteFileId: this.requireDataverseFileId(remoteEntity) } : {}),
        ...(this.readOptionalEntityString(entity, 'description')
          ? { description: this.readOptionalEntityString(entity, 'description') }
          : {}),
      }
    }

    const addedFiles = await Promise.all(newFileDiffs.map(
      file => toPreparedFile(file.localId)))
    const changedFiles = await Promise.all(changedIds.map(
      file => toPreparedFile(file.localId, file.remoteId)))
    const removedFiles = removedFileDiffs.map(file => {
      const remoteEntity = remoteEntitiesById.get(file.remoteId)
      if (!remoteEntity) throw new Error(`Cannot prepare removal of remote file '${file.remoteId}'.`)
      return { remoteId: file.remoteId, remoteFileId: this.requireDataverseFileId(remoteEntity) }
    })
    const target = this.buildDataverseDatasetUrl(baseUrl, exportTarget.pid) ||
      this.buildDatasetPidTarget(exportTarget.pid) || exportTarget.pid
    return {
      pid: exportTarget.pid,
      target,
      crate: metadataCrate,
      uploadCrate,
      remoteCrate,
      mappingFileName: exportTarget.exportLogEntry.mappingFile,
      metadataIdMapping,
      uploadIdMapping,
      originalToUploadIds: Object.fromEntries(localized.originalToUploadIds),
      addedFiles,
      changedFiles,
      removedFiles,
    }
  }

  public async updateArpWithProvider(
    repository: DataRepositoryConfig,
    exportTarget: DataRepositoryExportTarget,
    invokeProvider: (input: Record<string, unknown>) => Promise<unknown>,
  ): Promise<ArpRoCrateUpdateAnalysisResult | undefined> {
    const lookup = await invokeProvider({
      phase: 'loadRemote', repository, pid: exportTarget.pid,
    })
    const lookupRecord = lookup && typeof lookup === 'object' && !Array.isArray(lookup)
      ? lookup as Record<string, unknown>
      : undefined
    const remoteCrate = lookupRecord?.remoteCrate as RoCrate | undefined
    if (!remoteCrate || !Array.isArray(remoteCrate['@graph'])) {
      throw new Error('The ARP provider did not return the remote RO-Crate needed for update analysis.')
    }
    const plan = await this.prepareUpdateExport(repository, remoteCrate, exportTarget)
    if (!plan) return undefined

    const rootUri = this.getWorkspaceRoot()
    const operationId = this.randomId(32)
    const active: ActiveArpProviderUpdate = {
      rootUri,
      plan,
      metadataIdMapping: { ...plan.metadataIdMapping },
      uploadIdMapping: { ...plan.uploadIdMapping },
      checkpointedFiles: new Set(),
      removedRemoteIds: new Set(),
    }
    this.activeProviderUpdates.set(operationId, active)
    await this.saveEntityIdMapping(rootUri, plan.mappingFileName, active.metadataIdMapping)
    await this.appendExportLog(rootUri, {
      target: plan.target,
      repository: this.normalizeBaseUrl(repository.baseUrl),
      mappingFile: plan.mappingFileName,
      crosswalkFile: repository.crosswalkId ?? DATAVERSE_CROSSWALK_FILE_NAME,
      syncType: 'update',
      status: 'cancelled',
      datasetName: this.getRootDatasetName(plan.crate),
    })

    try {
      const rawResult = await invokeProvider({
        phase: 'apply', repository, plan, operationId,
      })
      const result = rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
        ? rawResult as ArpProviderUpdateResult
        : undefined
      if (!result || result.providerId !== 'arp' || result.pid !== plan.pid ||
          !Array.isArray(result.processedRemoteCrate?.['@graph']) ||
          !Array.isArray(result.uploadCrate?.['@graph']) || !result.uploadIdMapping ||
          !Array.isArray(result.fileResults) || !Array.isArray(result.removedRemoteIds)) {
        throw new Error('The ARP provider did not return a complete update result.')
      }

      const completeUploadMapping = extendMappingWithMetadataEntities(
        result.uploadCrate, result.processedRemoteCrate, result.uploadIdMapping)
      const completeMetadataMapping = this.toMetadataEntityIdMapping(
        plan.crate, completeUploadMapping, new Map(Object.entries(plan.originalToUploadIds)))
      await this.saveEntityIdMapping(rootUri, plan.mappingFileName, completeMetadataMapping)
      await this.appendExportLog(rootUri, {
        target: plan.target,
        repository: this.normalizeBaseUrl(repository.baseUrl),
        mappingFile: plan.mappingFileName,
        crosswalkFile: repository.crosswalkId ?? DATAVERSE_CROSSWALK_FILE_NAME,
        syncType: 'update',
        status: 'success',
        lastSuccessfulActionAt: new Date().toISOString(),
        datasetName: this.getRootDatasetName(plan.crate),
      })
      return {
        pid: plan.pid,
        target: plan.target,
        addedFileCount: plan.addedFiles.length,
        changedFileCount: plan.changedFiles.length,
        removedFileCount: plan.removedFiles.length,
        mappingFileName: plan.mappingFileName,
        unmappedEntityIds: Object.entries(completeMetadataMapping)
          .filter(([, remoteId]) => !remoteId).map(([metadataId]) => metadataId),
      }
    } finally {
      this.activeProviderUpdates.delete(operationId)
    }
  }

  public async handleProviderUpdateCheckpoint(value: ArpProviderUpdateCheckpoint): Promise<void> {
    if (!value || value.providerId !== 'arp' || typeof value.operationId !== 'string') {
      throw new Error('The ARP update checkpoint is invalid.')
    }
    const active = this.activeProviderUpdates.get(value.operationId)
    if (!active) throw new Error('The ARP update checkpoint no longer has an active update.')
    if (value.pid !== active.plan.pid) {
      throw new Error('The ARP update checkpoint refers to a different dataset PID.')
    }

    if (value.stage === 'fileRemoved') {
      if (!value.remoteId || !active.plan.removedFiles.some(file => file.remoteId === value.remoteId)) {
        throw new Error('The ARP removed-file checkpoint is inconsistent with the update plan.')
      }
      this.removeMappingEntriesByRemoteId(active.uploadIdMapping, value.remoteId)
      this.removeMappingEntriesByRemoteId(active.metadataIdMapping, value.remoteId)
      active.removedRemoteIds.add(value.remoteId)
      await this.saveEntityIdMapping(
        active.rootUri, active.plan.mappingFileName, active.metadataIdMapping)
      return
    }

    const file = value.fileResult
    const planned = file && [...active.plan.addedFiles, ...active.plan.changedFiles].find(
      item => item.metadataEntityId === file.metadataEntityId &&
        item.uploadEntityId === file.uploadEntityId && item.entryPath === file.entryPath)
    if (!file || !planned || !file.remoteId) {
      throw new Error('The ARP updated-file checkpoint is inconsistent with the update plan.')
    }
    active.uploadIdMapping[file.uploadEntityId] = file.remoteId
    active.metadataIdMapping[file.metadataEntityId] = file.remoteId
    await this.saveEntityIdMapping(
      active.rootUri, active.plan.mappingFileName, active.metadataIdMapping)
    if (file.md5) {
      await this.fileHashStoreService.recordKnownHash(
        active.rootUri, file.metadataEntityId, file.lastModified, file.sourceSize, file.md5)
      await this.persistUploadedFileHash(
        active.rootUri, active.plan.crate, file.metadataEntityId,
        active.plan.uploadCrate, file.uploadEntityId, file.md5)
    }
    active.checkpointedFiles.add(`${file.kind}\0${file.uploadEntityId}`)
  }

  public async prepareSyncExport(
    repository: DataRepositoryConfig,
    remoteCrate: RoCrate,
    exportTargetSelection: DataRepositoryExportTarget,
    metadataMode: RepositorySyncMode,
  ): Promise<PreparedArpSyncExport> {
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const rootUri = this.getWorkspaceRoot()
    const localCrate = await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json'))
    const exportTarget = await this.resolveExistingArpExportTarget(
      rootUri, repository, localCrate, exportTargetSelection)
    if (!exportTarget?.exportLogEntry?.mappingFile || !exportTarget.mapping) {
      throw new Error(nls.localize(
        'rockit/dataRepository/arpMissingExportMappingForSync',
        'This ARP export target has no local mapping file. Sync cannot safely place remote files in the workspace.',
      ))
    }
    const initialMetadataMapping = extendMappingWithMetadataEntities(
      localCrate, remoteCrate, exportTarget.mapping)
    const metadataMapping = { ...initialMetadataMapping }
    const remoteToLocalMapping = this.invertEntityIdMapping(metadataMapping)
    const syncDiff = this.diffRoCrates(remoteCrate, localCrate, remoteToLocalMapping, {
      pid: exportTarget.pid,
      repository: baseUrl,
      exportLogEntry: exportTarget.exportLogEntry,
    })
    const remoteEntitiesById = new Map(this.readGraphEntities(remoteCrate)
      .map(entity => [this.requireEntityId(entity), entity]))
    const relocatedLocalIds: RoCrateEntityIdMapping = {}
    const storedFileHashes = await this.fileHashStoreService.readFileHashes(rootUri)
    const files: PreparedArpSyncFile[] = []
    let keptLocalFileCount = 0
    for (const [remoteId, remoteFile] of remoteEntitiesById) {
      if (remoteId === 'ro-crate-metadata.json' ||
          !this.entityTypes(remoteFile).includes('File')) continue
      const localTarget = this.localTargetForRemoteFile(
        remoteFile, metadataMapping, metadataMode !== 'remote-additions')
      if (metadataMode !== 'remote-additions') {
        const previousLocalId = Object.entries(metadataMapping)
          .find(([, mappedRemoteId]) => mappedRemoteId === remoteId)?.[0]
        if (previousLocalId && previousLocalId !== localTarget.entityId) {
          relocatedLocalIds[previousLocalId] = localTarget.entityId
        }
        this.removeMappingEntriesByRemoteId(metadataMapping, remoteId)
        metadataMapping[localTarget.entityId] = remoteId
      }
      const targetUri = rootUri.resolve(localTarget.path)
      const md5 = this.readOptionalEntityString(remoteFile, 'hash')
      let kind: 'new' | 'changed' | undefined
      if (!(await this.fileService.exists(targetUri))) {
        kind = 'new'
      } else {
        const stat = await this.fileService.resolve(targetUri)
        const remoteSizeValue = this.readOptionalEntityString(remoteFile, 'contentSize')
        const remoteSize = remoteSizeValue === undefined ? undefined : Number(remoteSizeValue)
        const unchanged = !stat.isDirectory && this.fileHashStoreService.isFileRecordUnchanged(
          storedFileHashes[localTarget.entityId], {
            localLastModified: stat.mtime,
            localSize: stat.size,
            remoteMd5: md5,
            remoteSize: remoteSize !== undefined && Number.isFinite(remoteSize)
              ? remoteSize : undefined,
          })
        if (!unchanged && metadataMode !== 'remote-additions') kind = 'changed'
        else keptLocalFileCount += 1
      }
      if (kind) {
        files.push({
          remoteId,
          remoteFileId: this.requireDataverseFileId(remoteFile),
          localId: localTarget.entityId,
          localPath: localTarget.path,
          targetUri: targetUri.toString(),
          targetParentUri: targetUri.parent.toString(),
          md5,
          kind,
        })
      }
    }
    return {
      pid: exportTarget.pid,
      target: this.buildDataverseDatasetUrl(baseUrl, exportTarget.pid) ||
        this.buildDatasetPidTarget(exportTarget.pid) || exportTarget.pid,
      localCrate,
      remoteCrate,
      exportLogEntry: exportTarget.exportLogEntry,
      mappingFileName: exportTarget.exportLogEntry.mappingFile,
      initialMetadataMapping,
      metadataMapping,
      relocatedLocalIds,
      metadataMode,
      files,
      keptLocalFileCount,
      removedRemoteFileCount: syncDiff.removedFiles.length,
    }
  }

  public async syncArpWithProvider(
    repository: DataRepositoryConfig,
    exportTarget: DataRepositoryExportTarget,
    metadataMode: RepositorySyncMode,
    invokeProvider: (input: Record<string, unknown>) => Promise<unknown>,
  ): Promise<ArpRoCrateSyncResult> {
    const lookup = await invokeProvider({
      phase: 'loadRemote', repository, pid: exportTarget.pid,
    })
    const lookupRecord = lookup && typeof lookup === 'object' && !Array.isArray(lookup)
      ? lookup as Record<string, unknown> : undefined
    const remoteCrate = lookupRecord?.remoteCrate as RoCrate | undefined
    if (!remoteCrate || !Array.isArray(remoteCrate['@graph'])) {
      throw new Error('The ARP provider did not return the remote RO-Crate needed for sync.')
    }
    const plan = await this.prepareSyncExport(
      repository, remoteCrate, exportTarget, metadataMode)
    const rootUri = this.getWorkspaceRoot()
    const operationId = this.randomId(32)
    this.activeProviderSyncs.set(operationId, {
      rootUri,
      plan,
      metadataMapping: { ...plan.initialMetadataMapping },
      checkpointedFiles: new Set(),
    })
    await this.appendExportLog(rootUri, {
      ...plan.exportLogEntry,
      target: plan.target,
      repository: this.normalizeBaseUrl(repository.baseUrl),
      crosswalkFile: repository.crosswalkId ?? plan.exportLogEntry.crosswalkFile,
      syncType: 'sync',
      status: 'cancelled',
    })
    try {
      const rawResult = await invokeProvider({
        phase: 'apply', repository, plan: {
          pid: plan.pid, files: plan.files,
        }, operationId,
      })
      const result = rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
        ? rawResult as ArpProviderSyncResult : undefined
      if (!result || result.providerId !== 'arp' || result.pid !== plan.pid ||
          !Array.isArray(result.downloadedFiles) ||
          result.downloadedFiles.length !== plan.files.length ||
          plan.files.some(file => !result.downloadedFiles.some(downloaded =>
            downloaded.remoteId === file.remoteId &&
            downloaded.localId === file.localId &&
            downloaded.localPath === file.localPath))) {
        throw new Error('The ARP provider did not return a complete sync result.')
      }
      for (const file of result.downloadedFiles) {
        this.removeMappingEntriesByRemoteId(plan.metadataMapping, file.remoteId)
        plan.metadataMapping[file.localId] = file.remoteId
      }
      const localizedRemoteCrate = this.rewriteCrateEntityIds(
        plan.remoteCrate, this.invertEntityIdMapping(plan.metadataMapping))
      const synchronizedCrate = mergeRoCratesForSync(
        this.rewriteCrateEntityIds(plan.localCrate, plan.relocatedLocalIds),
        localizedRemoteCrate,
        plan.metadataMode,
      )
      const completeMetadataMapping = extendMappingWithMetadataEntities(
        synchronizedCrate, plan.remoteCrate, plan.metadataMapping)
      await this.fileService.writeFile(
        rootUri.resolve('ro-crate-metadata.json'),
        BinaryBuffer.fromString(`${JSON.stringify(synchronizedCrate, null, 2)}\n`),
      )
      await this.saveEntityIdMapping(rootUri, plan.mappingFileName, completeMetadataMapping)
      await this.appendExportLog(rootUri, {
        target: plan.target,
        repository: this.normalizeBaseUrl(repository.baseUrl),
        mappingFile: plan.mappingFileName,
        crosswalkFile: repository.crosswalkId ?? plan.exportLogEntry.crosswalkFile,
        syncType: 'sync',
        status: 'success',
        lastSuccessfulActionAt: new Date().toISOString(),
        datasetName: this.getRootDatasetName(synchronizedCrate),
      })
      return {
        pid: plan.pid,
        target: plan.target,
        downloadedFileCount: plan.files.filter(file => file.kind === 'new').length,
        replacedFileCount: plan.files.filter(file => file.kind === 'changed').length,
        removedRemoteFileCount: plan.removedRemoteFileCount,
        mappingFileName: plan.mappingFileName,
        unmappedEntityIds: Object.entries(completeMetadataMapping)
          .filter(([, remoteId]) => !remoteId).map(([metadataId]) => metadataId),
      }
    } finally {
      this.activeProviderSyncs.delete(operationId)
    }
  }

  public async handleProviderSyncCheckpoint(value: ArpProviderSyncCheckpoint): Promise<void> {
    if (!value || value.providerId !== 'arp' || value.stage !== 'fileDownloaded' ||
        typeof value.operationId !== 'string') {
      throw new Error('The ARP sync checkpoint is invalid.')
    }
    const active = this.activeProviderSyncs.get(value.operationId)
    if (!active) throw new Error('The ARP sync checkpoint no longer has an active sync.')
    if (value.pid !== active.plan.pid) {
      throw new Error('The ARP sync checkpoint refers to a different dataset PID.')
    }
    const file = active.plan.files.find(candidate =>
      candidate.remoteId === value.file?.remoteId &&
      candidate.localId === value.file?.localId &&
      candidate.localPath === value.file?.localPath)
    if (!file || file.targetUri !== value.file.targetUri) {
      throw new Error('The ARP sync checkpoint is inconsistent with the sync plan.')
    }
    const targetUri = new URI(file.targetUri)
    const stat = await this.fileService.resolve(targetUri)
    if (stat.isDirectory) throw new Error(`ARP sync wrote a directory for '${file.localPath}'.`)
    await this.fileHashStoreService.recordKnownHash(
      active.rootUri, file.localId, stat.mtime, stat.size, file.md5)
    this.removeMappingEntriesByRemoteId(active.metadataMapping, file.remoteId)
    active.metadataMapping[file.localId] = file.remoteId
    await this.saveEntityIdMapping(
      active.rootUri, active.plan.mappingFileName, active.metadataMapping)
    active.checkpointedFiles.add(`${file.kind}\0${file.remoteId}\0${file.localId}`)
  }

  protected async buildDataverseUploadCrate(
    crate: RoCrate,
    rootUri: URI,
  ): Promise<RoCrate> {
    const uploadCrate = JSON.parse(JSON.stringify(crate)) as RoCrate
    const graph = Array.isArray(uploadCrate['@graph']) ? uploadCrate['@graph'] : []
    let enrichedFileCount = 0

    for (const entity of graph) {
      if (
        !entity ||
        typeof entity !== 'object' ||
        Array.isArray(entity) ||
        !this.entityTypes(entity).includes('File')
      ) {
        continue
      }
      const relativePath = this.dataverseFilePathFromEntity(entity)
      if (!relativePath) {
        continue
      }
      const fileUri = rootUri.resolve(relativePath)
      if (
        !this.isInsideRoot(rootUri, fileUri) ||
        !(await this.fileService.exists(fileUri))
      ) {
        continue
      }
      const stat = await this.fileService.resolve(fileUri)
      if (stat.isDirectory) {
        continue
      }
      const parsed = this.parsePosixPath(relativePath)
      entity.name = this.readOptionalEntityString(entity, 'name') ?? parsed.base
      entity.contentSize =
        this.readOptionalEntityString(entity, 'contentSize') ??
        String(stat.size ?? 0)
      entity.encodingFormat =
        this.readOptionalEntityString(entity, 'encodingFormat') ??
        this.mimeTypeFromFilename(relativePath)
      if (!this.readOptionalEntityString(entity, 'directoryLabel') && parsed.dir) {
        entity.directoryLabel = parsed.dir
      }
      enrichedFileCount += 1
    }

    this.ensureDataverseFileContext(uploadCrate)
    return uploadCrate
  }

  protected async collectUploadFileSources(
    crate: RoCrate,
    rootUri: URI,
    externalFileEntries: Map<string, URI>,
    originalToUploadIds: Map<string, string>,
  ): Promise<ArpUploadFileSource[]> {
    const entitiesByPath = new Map<string, RoCrateEntity>()
    for (const entity of this.readGraphEntities(crate)) {
      if (!this.entityTypes(entity).includes('File')) {
        continue
      }
      const entryPath = this.dataverseFilePathFromEntity(entity)
      if (entryPath && entryPath !== 'ro-crate-metadata.json') {
        entitiesByPath.set(entryPath, entity)
      }
    }
    return Promise.all(
      Array.from(entitiesByPath.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([, entity]) =>
          this.resolveUploadFileSource(entity, rootUri, externalFileEntries, originalToUploadIds),
        ),
    )
  }

  protected extractMetadataLanguageOptions(
    payload: unknown,
  ): Array<{ value: string; label: string }> {
    const data =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).data
        : undefined
    const rawItems = Array.isArray(data) ? data : []
    const options = rawItems.flatMap((item) => {
      if (typeof item === 'string') {
        return [{ value: item, label: this.metadataLanguageLabel(item) }]
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return []
      }
      const record = item as Record<string, unknown>
      const value = this.readStrings(
        record.locale ?? record.value ?? record.langCode ?? record.code,
      )[0]
      if (!value) {
        return []
      }
      const label = this.readStrings(record.title ?? record.displayName ?? record.label)[0]
      return [{ value, label: this.metadataLanguageLabel(value, label) }]
    })
    const seen = new Set<string>()
    return options.filter((option) => {
      const key = option.value.toLowerCase()
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  }

  public metadataLanguageOptionsFromPayload(payload: unknown): Array<{ value: string; label: string }> {
    const options = this.extractMetadataLanguageOptions(payload)
    return options.length ? options : this.defaultMetadataLanguageOptions()
  }

  protected defaultMetadataLanguageOptions(): Array<{ value: string; label: string }> {
    return [
      {
        value: 'en',
        label: nls.localize('rockit/dataRepository/languageEnglish', 'English'),
      },
      {
        value: 'hu',
        label: nls.localize('rockit/dataRepository/languageHungarian', 'Hungarian'),
      },
    ]
  }

  protected metadataLanguageLabel(value: string, fallbackLabel?: string): string {
    const normalized = value.toLowerCase()
    if (normalized === 'en') {
      return nls.localize('rockit/dataRepository/languageEnglish', 'English')
    }
    if (normalized === 'hu') {
      return nls.localize('rockit/dataRepository/languageHungarian', 'Hungarian')
    }
    return fallbackLabel ?? value
  }

  protected async localizeExternalLocalFileReferences(
    crate: RoCrate,
    rootUri: URI,
  ): Promise<LocalizedExternalFileReferences> {
    const externalFileEntries = new Map<string, URI>()
    const originalToUploadIds = new Map<string, string>()
    const localizedReferences = await localizeExternalRoCrateFileReferences(crate, {
      existingEntryPaths: this.extractCrateFilePaths(crate),
      resolveLocalSource: async (sources) => {
        const resolved = await this.resolveFirstReadableLocalSource(sources)
        return resolved ? { source: resolved.source, value: resolved.uri } : undefined
      },
    })

    for (const reference of localizedReferences) {
      externalFileEntries.set(reference.importedPath, reference.resolvedSource)
      originalToUploadIds.set(reference.reference.entityId, reference.importedPath)
    }

    await this.enrichLocalizedExternalFiles(crate, externalFileEntries)
    return { entries: externalFileEntries, originalToUploadIds }
  }

  protected async enrichLocalizedExternalFiles(
    crate: RoCrate,
    entries: Map<string, URI>,
  ): Promise<void> {
    const entitiesById = new Map(
      this.readGraphEntities(crate).map((entity) => [
        this.requireEntityId(entity),
        entity,
      ]),
    )
    for (const [entryPath, uri] of entries) {
      const entity = entitiesById.get(entryPath)
      if (!entity || !this.entityTypes(entity).includes('File')) {
        continue
      }
      const stat = await this.fileService.resolve(uri)
      const parsed = this.parsePosixPath(entryPath)
      entity.name = parsed.base
      entity.contentSize =
        this.readOptionalEntityString(entity, 'contentSize') ??
        String(stat.size ?? 0)
      entity.encodingFormat =
        this.readOptionalEntityString(entity, 'encodingFormat') ??
        this.mimeTypeFromFilename(entryPath)
      if (!this.readOptionalEntityString(entity, 'directoryLabel') && parsed.dir) {
        entity.directoryLabel = parsed.dir
      }
    }
  }

  protected async resolveExistingArpExportTarget(
    rootUri: URI,
    repository: DataRepositoryConfig,
    crate: RoCrate,
    selectedTarget?: DataRepositoryExportTarget,
  ): Promise<ArpExportTarget | undefined> {
    const cratePid = this.extractArpPid(crate)
    const rockitUri = rootUri.resolve('.rockit')
    const entries = await this.readExportLogEntries(
      rockitUri.resolve(EXPORT_LOG_FILE_NAME),
    )
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const matchingEntries = [...entries]
      .reverse()
      .filter((entry) => this.normalizeBaseUrl(entry.repository) === baseUrl)
    const selectedEntry = selectedTarget
      ? matchingEntries.find(
          (candidate) =>
            candidate.mappingFile === selectedTarget.mappingFile &&
            this.normalizePid(candidate.target) === this.normalizePid(selectedTarget.pid),
        )
      : undefined
    const selectedFallbackEntry: ExportLogEntry | undefined =
      selectedTarget && !selectedEntry
        ? {
            target: selectedTarget.target,
            repository: selectedTarget.repository,
            mappingFile: selectedTarget.mappingFile,
            crosswalkFile: selectedTarget.crosswalkFile,
            syncType: selectedTarget.syncType,
            lastSuccessfulActionAt: selectedTarget.lastSuccessfulActionAt,
            datasetName: selectedTarget.datasetName,
          }
        : undefined
    const entry = selectedEntry ?? selectedFallbackEntry ?? (cratePid
      ? matchingEntries.find(
          (candidate) =>
            this.normalizePid(candidate.target) === this.normalizePid(cratePid),
        )
      : matchingEntries.find((candidate) => !!this.extractPidFromTarget(candidate.target)))
    const pid =
      selectedTarget?.pid ??
      cratePid ??
      (entry ? this.extractPidFromTarget(entry.target) : undefined)
    if (!pid) {
      return undefined
    }
    return {
      pid,
      exportLogEntry: entry,
      mapping: entry
        ? await this.readEntityIdMapping(rockitUri.resolve(entry.mappingFile))
        : undefined,
    }
  }

  protected removeRootArpPid(crate: RoCrate): void {
    const root = this.readGraphEntities(crate).find((entity) => entity['@id'] === './')
    if (root) {
      delete root['@arpPid']
    }
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

  protected async tryReadCurrentRootDatasetName(
    rootUri: URI,
  ): Promise<string | undefined> {
    try {
      return this.getRootDatasetName(
        await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json')),
      )
    } catch (error) {
      console.warn('Failed to read current RO-Crate dataset name.', error)
      return undefined
    }
  }

  protected rewriteCrateEntityIds(
    crate: RoCrate,
    idMapping: RoCrateEntityIdMapping,
  ): RoCrate {
    const rewritten = JSON.parse(JSON.stringify(crate)) as RoCrate
    this.rewriteEntityIdReferences(rewritten, idMapping)
    return rewritten
  }

  protected buildRestoredCreatedCrate(
    sourceCrate: RoCrate,
    idMapping: RoCrateEntityIdMapping,
    pid: string,
  ): RoCrate {
    const restored = this.rewriteCrateEntityIds(sourceCrate, idMapping)
    const restoredRoot = this.readGraphEntities(restored).find(
      (entity) => entity['@id'] === './',
    )
    if (!restoredRoot) {
      throw new Error(
        nls.localize(
          'rockit/dataRepository/arpCreatedRootMissing',
          'ARP export completed, but the local upload crate did not contain the root Dataset needed for metadata restoration.',
        ),
      )
    }
    restoredRoot['@arpPid'] = pid
    return restored
  }

  protected buildInitialUploadEntityIdMapping(crate: RoCrate): RoCrateEntityIdMapping {
    const mapping: RoCrateEntityIdMapping = { './': './' }
    for (const entity of this.readGraphEntities(crate)) {
      const id = this.requireEntityId(entity)
      if (id === './') {
        continue
      }
      if (this.entityTypes(entity).includes('Dataset')) {
        mapping[id] = id
      }
    }
    return mapping
  }

  protected rewriteEntityIdReferences(
    value: unknown,
    idMapping: RoCrateEntityIdMapping,
  ): void {
    if (Array.isArray(value)) {
      for (const item of value) {
        this.rewriteEntityIdReferences(item, idMapping)
      }
      return
    }
    if (!value || typeof value !== 'object') {
      return
    }
    const record = value as Record<string, unknown>
    for (const [key, child] of Object.entries(record)) {
      if (key === '@id' && typeof child === 'string') {
        const mappedId = idMapping[child]
        if (mappedId) {
          record[key] = mappedId
        }
        continue
      }
      this.rewriteEntityIdReferences(child, idMapping)
    }
  }

  protected async resolveUploadFileSource(
    entity: RoCrateEntity,
    rootUri: URI,
    externalFileEntries: Map<string, URI>,
    originalToUploadIds = new Map<string, string>(),
  ): Promise<ArpUploadFileSource> {
    const entryPath = this.dataverseFilePathFromEntity(entity)
    if (!entryPath) {
      throw new Error(
        nls.localize(
          'rockit/dataRepository/fileUploadPathUnknown',
          "Cannot determine upload path for File entity '{0}'.",
          this.requireEntityId(entity),
        ),
      )
    }
    const externalUri = externalFileEntries.get(entryPath)
    const uri = externalUri ?? rootUri.resolve(entryPath)
    if (!externalUri && !this.isInsideRoot(rootUri, uri)) {
      throw new Error(nls.localize(
        'rockit/dataRepository/uploadPathOutsideCrate',
        'Refusing to upload path outside crate root: {0}',
        entryPath,
      ))
    }
    if (!(await this.fileService.exists(uri))) {
      throw new Error(nls.localize(
        'rockit/dataRepository/uploadFileMissing',
        'Referenced file not found for upload: {0}',
        entryPath,
      ))
    }
    const stat = await this.fileService.resolve(uri)
    if (stat.isDirectory) {
      throw new Error(nls.localize(
        'rockit/dataRepository/cannotUploadDirectory',
        "Cannot upload '{0}' because it is a directory.",
        entryPath,
      ))
    }
    const uploadEntityId = this.requireEntityId(entity)
    const entityId = Array.from(originalToUploadIds.entries())
      .find(([, uploadId]) => uploadId === uploadEntityId)?.[0] ?? uploadEntityId
    return {
      entityId,
      entryPath,
      uri,
      lastModified: stat.mtime,
      sourceSize: stat.size,
    }
  }

  protected localTargetForRemoteFile(
    remoteFile: RoCrateEntity,
    metadataMapping: RoCrateEntityIdMapping,
    preferRemotePath = false,
  ): { entityId: string; path: string } {
    const remoteId = this.requireEntityId(remoteFile)
    const remotePath = this.dataverseFilePathFromEntity(remoteFile)
    if (preferRemotePath && remotePath && this.isSafeRelativePath(remotePath)) {
      return { entityId: remotePath, path: remotePath }
    }
    const mappedEntityId = Object.entries(metadataMapping)
      .find(([, mappedRemoteId]) => mappedRemoteId === remoteId)?.[0]
    if (mappedEntityId) {
      const mappedPath = this.localCratePathFromEntityId(mappedEntityId)
      if (mappedPath) {
        return { entityId: mappedEntityId, path: mappedPath }
      }
      if (this.isSafeRelativePath(mappedEntityId)) {
        return {
          entityId: mappedEntityId,
          path: mappedEntityId.replace(/\\/g, '/'),
        }
      }
    }
    if (remotePath && this.isSafeRelativePath(remotePath)) {
      return { entityId: remotePath, path: remotePath }
    }
    throw new Error(
      nls.localize(
        'rockit/dataRepository/syncLocalPathUnknown',
        "Cannot determine a safe local path for remote File entity '{0}'.",
        remoteId,
      ),
    )
  }

  protected async persistUploadedFileHash(
    rootUri: URI,
    localCrate: RoCrate,
    localEntityId: string,
    uploadCrate: RoCrate,
    uploadEntityId: string,
    md5: string | undefined,
  ): Promise<void> {
    if (!md5) {
      return
    }

    const appStateCrate = this.appStateService.roCrate ?? localCrate
    const nextAppStateCrate = JSON.parse(JSON.stringify(appStateCrate)) as RoCrate
    const appStateEntity = this.readGraphEntities(nextAppStateCrate).find(
      (entity) => this.readOptionalEntityString(entity, '@id') === localEntityId,
    )
    const localEntity = this.readGraphEntities(localCrate).find(
      (entity) => this.readOptionalEntityString(entity, '@id') === localEntityId,
    )
    const uploadEntity = this.readGraphEntities(uploadCrate).find(
      (entity) => this.readOptionalEntityString(entity, '@id') === uploadEntityId,
    )
    if (!appStateEntity || !localEntity || !uploadEntity) {
      throw new Error(
        nls.localize(
          'rockit/dataRepository/uploadedFileHashEntityMissing',
          "The uploaded file hash could not be saved because File entity '{0}' was not found in the RO-Crate metadata.",
          localEntityId,
        ),
      )
    }

    appStateEntity.hash = md5
    localEntity.hash = md5
    uploadEntity.hash = md5
    this.ensureDataverseFileContext(nextAppStateCrate)
    this.ensureDataverseFileContext(localCrate)
    this.appStateService.roCrate = nextAppStateCrate
    await this.roCratePersistenceService.write(rootUri, nextAppStateCrate)
  }

  protected async persistUploadedFileHashes(
    rootUri: URI,
    localCrate: RoCrate,
    uploadCrate: RoCrate,
    files: Array<{ localEntityId: string; uploadEntityId: string; md5: string }>,
  ): Promise<void> {
    if (!files.length) {
      return
    }

    const nextAppStateCrate = JSON.parse(JSON.stringify(
      this.appStateService.roCrate ?? localCrate,
    )) as RoCrate
    const appStateEntities = new Map(this.readGraphEntities(nextAppStateCrate)
      .map(entity => [this.readOptionalEntityString(entity, '@id'), entity]))
    const localEntities = new Map(this.readGraphEntities(localCrate)
      .map(entity => [this.readOptionalEntityString(entity, '@id'), entity]))
    const uploadEntities = new Map(this.readGraphEntities(uploadCrate)
      .map(entity => [this.readOptionalEntityString(entity, '@id'), entity]))

    for (const file of files) {
      const appStateEntity = appStateEntities.get(file.localEntityId)
      const localEntity = localEntities.get(file.localEntityId)
      const uploadEntity = uploadEntities.get(file.uploadEntityId)
      if (!appStateEntity || !localEntity || !uploadEntity) {
        throw new Error(nls.localize(
          'rockit/dataRepository/uploadedFileHashEntityMissing',
          "The uploaded file hash could not be saved because File entity '{0}' was not found in the RO-Crate metadata.",
          file.localEntityId,
        ))
      }
      appStateEntity.hash = file.md5
      localEntity.hash = file.md5
      uploadEntity.hash = file.md5
    }

    this.ensureDataverseFileContext(nextAppStateCrate)
    this.ensureDataverseFileContext(localCrate)
    this.appStateService.roCrate = nextAppStateCrate
    await this.roCratePersistenceService.write(rootUri, nextAppStateCrate)
  }

  protected removeMappingEntriesByRemoteId(
    mapping: RoCrateEntityIdMapping,
    remoteId: string,
  ): void {
    for (const [localId, mappedId] of Object.entries(mapping)) {
      if (mappedId === remoteId) {
        delete mapping[localId]
      }
    }
  }

  protected requireDataverseFileId(entity: RoCrateEntity): number {
    for (const value of [
      this.readOptionalEntityString(entity, '@id'),
      this.readOptionalEntityString(entity, 'url'),
    ]) {
      const match = value?.match(/\/file\/(\d+)(?:$|[/?#])/)
      if (match) {
        return Number(match[1])
      }
      if (value && /^\d+$/.test(value)) {
        return Number(value)
      }
    }
    throw new Error(nls.localize(
      'rockit/dataRepository/dataverseFileIdUnknown',
      "Cannot determine Dataverse file ID for remote File entity '{0}'.",
      this.requireEntityId(entity),
    ))
  }

  protected diffRoCrates(
    localCrate: RoCrate,
    remoteCrate: RoCrate,
    localToRemoteEntityIds: RoCrateEntityIdMapping,
    context: Record<string, unknown>,
  ): Record<string, any> {
    const localEntities = this.readGraphEntities(localCrate)
    const remoteEntitiesById = new Map(
      this.readGraphEntities(remoteCrate).map((entity) => [
        this.requireEntityId(entity),
        entity,
      ]),
    )
    const matchedRemoteIds = new Set<string>(['./', 'ro-crate-metadata.json'])
    const newFiles: any[] = []
    const removedFiles: any[] = []
    const changedFiles: any[] = []
    const newDatasets: any[] = []
    const removedDatasets: any[] = []
    const changedDatasetHasPart: any[] = []
    const changedMetadataEntities: any[] = []
    const localMetadataEntities = localEntities.filter((entity) =>
      this.shouldCompareMetadataEntity(entity),
    )
    const remoteMetadataEntities = this.readGraphEntities(remoteCrate).filter((entity) =>
      this.shouldCompareMetadataEntity(entity),
    )
    const matchedRemoteMetadataIds = new Set<string>()

    for (const localEntity of localEntities) {
      const types = this.entityTypes(localEntity)
      if (!types.includes('File') && !types.includes('Dataset')) {
        continue
      }
      const localId = this.requireEntityId(localEntity)
      const remoteId =
        localId === './' ? './' : localToRemoteEntityIds[localId] || localId
      const remoteEntity = remoteEntitiesById.get(remoteId)
      if (!remoteEntity) {
        if (types.includes('File')) {
          newFiles.push(this.fileDiffSummary(localEntity, localId, remoteId))
        } else if (localId !== './') {
          newDatasets.push(
            this.datasetDiffSummary(
              localEntity,
              localToRemoteEntityIds,
              localId,
              remoteId,
            ),
          )
        }
        continue
      }
      matchedRemoteIds.add(remoteId)
      if (types.includes('File')) {
        const fileChanges = this.compareFileMetadata(localEntity, remoteEntity)
        if (Object.keys(fileChanges).length) {
          changedFiles.push({
            localId,
            remoteId,
            changes: fileChanges,
          })
        }
        continue
      }
      const localChildren = this.mappedReferenceSet(
        localEntity['hasPart'],
        localToRemoteEntityIds,
      )
      const remoteChildren = this.mappedReferenceSet(remoteEntity['hasPart'])
      const addedChildren = [...localChildren]
        .filter((id) => !remoteChildren.has(id))
        .sort((a, b) => a.localeCompare(b))
      const removedChildren = [...remoteChildren]
        .filter((id) => !localChildren.has(id))
        .sort((a, b) => a.localeCompare(b))
      if (addedChildren.length || removedChildren.length) {
        changedDatasetHasPart.push({
          localId,
          remoteId,
          addHasPart: addedChildren,
          removeHasPart: removedChildren,
        })
      }
    }

    for (const remoteEntity of this.readGraphEntities(remoteCrate)
      .filter((entity) => !matchedRemoteIds.has(this.requireEntityId(entity)))
      .filter((entity) => this.requireEntityId(entity) !== 'ro-crate-metadata.json')) {
      const types = this.entityTypes(remoteEntity)
      const remoteId = this.requireEntityId(remoteEntity)
      if (types.includes('File')) {
        removedFiles.push(this.fileDiffSummary(remoteEntity, undefined, remoteId))
      } else if (types.includes('Dataset') && remoteId !== './') {
        removedDatasets.push(
          this.datasetDiffSummary(remoteEntity, {}, undefined, remoteId),
        )
      }
    }

    for (const localEntity of localMetadataEntities) {
      const localId = this.requireEntityId(localEntity)
      const match = this.findRemoteMetadataEntity(
        localEntity,
        remoteMetadataEntities,
        localToRemoteEntityIds,
        matchedRemoteMetadataIds,
      )
      if (!match) {
        changedMetadataEntities.push({
          status: 'new',
          localId,
          type: this.entityTypes(localEntity),
          local: this.meaningfulMetadataValues(localEntity),
        })
        continue
      }
      matchedRemoteMetadataIds.add(this.requireEntityId(match))
      const changes = this.compareMeaningfulMetadata(localEntity, match)
      if (Object.keys(changes).length) {
        changedMetadataEntities.push({
          status: 'changed',
          localId,
          remoteId: this.requireEntityId(match),
          type: this.entityTypes(localEntity),
          changes,
        })
      }
    }
    for (const remoteEntity of remoteMetadataEntities) {
      const remoteId = this.requireEntityId(remoteEntity)
      if (!matchedRemoteMetadataIds.has(remoteId)) {
        changedMetadataEntities.push({
          status: 'removed',
          remoteId,
          type: this.entityTypes(remoteEntity),
          remote: this.meaningfulMetadataValues(remoteEntity),
        })
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      perspective:
        'local ro-crate-metadata.json is treated as latest; only mapped real differences are listed.',
      ...context,
      summary: {
        localDatasets: localEntities.filter((entity) =>
          this.entityTypes(entity).includes('Dataset'),
        ).length,
        localFiles: localEntities.filter((entity) =>
          this.entityTypes(entity).includes('File'),
        ).length,
        localMetadataEntities: localMetadataEntities.length,
        remoteDatasets: this.readGraphEntities(remoteCrate).filter((entity) =>
          this.entityTypes(entity).includes('Dataset'),
        ).length,
        remoteFiles: this.readGraphEntities(remoteCrate).filter((entity) =>
          this.entityTypes(entity).includes('File'),
        ).length,
        remoteMetadataEntities: remoteMetadataEntities.length,
        newFiles: newFiles.length,
        removedFiles: removedFiles.length,
        changedFiles: changedFiles.length,
        newDatasets: newDatasets.length,
        removedDatasets: removedDatasets.length,
        changedDatasetHasPart: changedDatasetHasPart.length,
        changedMetadataEntities: changedMetadataEntities.length,
      },
      newFiles,
      removedFiles,
      changedFiles,
      newDatasets,
      removedDatasets,
      changedDatasetHasPart,
      changedMetadataEntities,
    }
  }

  protected compareFileMetadata(
    localEntity: RoCrateEntity,
    remoteEntity: RoCrateEntity,
  ): Record<string, { local: unknown; remote: unknown }> {
    const changes: Record<string, { local: unknown; remote: unknown }> = {}
    for (const key of [
      'name',
      'hash',
      'contentSize',
      'encodingFormat',
      'directoryLabel',
    ]) {
      const localValue = this.readOptionalEntityString(localEntity, key)
      const remoteValue = this.readOptionalEntityString(remoteEntity, key)
      if ((localValue ?? '') !== (remoteValue ?? '')) {
        changes[key] = { local: localValue ?? null, remote: remoteValue ?? null }
      }
    }
    return changes
  }

  protected fileDiffSummary(
    entity: RoCrateEntity,
    localId?: string,
    remoteId?: string,
  ): Record<string, unknown> {
    return {
      ...(localId ? { localId } : {}),
      ...(remoteId ? { remoteId } : {}),
      name: this.readOptionalEntityString(entity, 'name'),
      hash: this.readOptionalEntityString(entity, 'hash'),
      contentSize: this.readOptionalEntityString(entity, 'contentSize'),
      encodingFormat: this.readOptionalEntityString(entity, 'encodingFormat'),
      directoryLabel: this.readOptionalEntityString(entity, 'directoryLabel'),
    }
  }

  protected datasetDiffSummary(
    entity: RoCrateEntity,
    idMapping: RoCrateEntityIdMapping,
    localId?: string,
    remoteId?: string,
  ): Record<string, unknown> {
    return {
      ...(localId ? { localId } : {}),
      ...(remoteId ? { remoteId } : {}),
      name: this.readOptionalEntityString(entity, 'name'),
      hasPart: [...this.mappedReferenceSet(entity['hasPart'], idMapping)].sort((a, b) =>
        a.localeCompare(b),
      ),
    }
  }

  protected mappedReferenceSet(
    value: unknown,
    idMapping: RoCrateEntityIdMapping = {},
  ): Set<string> {
    return new Set(this.readEntityReferenceIds(value).map((id) => idMapping[id] || id))
  }

  protected shouldCompareMetadataEntity(entity: RoCrateEntity): boolean {
    const types = this.entityTypes(entity)
    const id = this.requireEntityId(entity)
    return (
      id !== './' &&
      id !== 'ro-crate-metadata.json' &&
      !types.includes('Dataset') &&
      !types.includes('File')
    )
  }

  protected findRemoteMetadataEntity(
    localEntity: RoCrateEntity,
    remoteEntities: RoCrateEntity[],
    idMapping: RoCrateEntityIdMapping,
    matchedRemoteIds: Set<string>,
  ): RoCrateEntity | undefined {
    const mappedId = idMapping[this.requireEntityId(localEntity)]
    if (mappedId) {
      const mappedMatch = remoteEntities.find(
        (entity) => this.requireEntityId(entity) === mappedId,
      )
      if (mappedMatch && !matchedRemoteIds.has(mappedId)) {
        return mappedMatch
      }
    }
    const localSignature = this.metadataEntitySignature(localEntity)
    const matches = remoteEntities.filter(
      (entity) =>
        !matchedRemoteIds.has(this.requireEntityId(entity)) &&
        this.metadataEntitySignature(entity) === localSignature,
    )
    return matches.length === 1 ? matches[0] : undefined
  }

  protected metadataEntitySignature(entity: RoCrateEntity): string {
    return JSON.stringify({
      type: this.entityTypes(entity).sort((a, b) => a.localeCompare(b)),
      values: this.meaningfulMetadataValues(entity),
    })
  }

  protected compareMeaningfulMetadata(
    localEntity: RoCrateEntity,
    remoteEntity: RoCrateEntity,
  ): Record<string, { local: unknown; remote: unknown }> {
    const localValues = this.meaningfulMetadataValues(localEntity)
    const remoteValues = this.meaningfulMetadataValues(remoteEntity)
    const changes: Record<string, { local: unknown; remote: unknown }> = {}
    for (const key of Array.from(
      new Set([...Object.keys(localValues), ...Object.keys(remoteValues)]),
    ).sort((a, b) => a.localeCompare(b))) {
      const localValue = localValues[key] ?? null
      const remoteValue = remoteValues[key] ?? null
      if (JSON.stringify(localValue) !== JSON.stringify(remoteValue)) {
        changes[key] = { local: localValue, remote: remoteValue }
      }
    }
    return changes
  }

  protected meaningfulMetadataValues(entity: RoCrateEntity): Record<string, unknown> {
    const values: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(entity)) {
      if (key === '@id' || key === '@type' || key === '@reverse' || key === 'url') {
        continue
      }
      if (this.isEntityReferenceValue(value)) {
        continue
      }
      values[key] = this.stableMetadataValue(value)
    }
    return Object.fromEntries(
      Object.entries(values).sort((a, b) => a[0].localeCompare(b[0])),
    )
  }

  protected stableMetadataValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value
        .map((item) => this.stableMetadataValue(item))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    }
    if (!value || typeof value !== 'object') {
      return value
    }
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(record)
        .filter(([key, child]) => key !== '@id' && !this.isEntityReferenceValue(child))
        .map(([key, child]): [string, unknown] => [key, this.stableMetadataValue(child)])
        .sort((a, b) => a[0].localeCompare(b[0])),
    )
  }

  protected isEntityReferenceValue(value: unknown): boolean {
    if (Array.isArray(value)) {
      return value.every((item) => this.isEntityReferenceValue(item))
    }
    return (
      !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof (value as Record<string, unknown>)['@id'] === 'string' &&
      Object.keys(value as Record<string, unknown>).length === 1
    )
  }

  protected toMetadataEntityIdMapping(
    metadataCrate: RoCrate,
    uploadIdMapping: RoCrateEntityIdMapping,
    originalToUploadIds: Map<string, string>,
  ): RoCrateEntityIdMapping {
    const mapping: RoCrateEntityIdMapping = {}
    for (const entity of this.readGraphEntities(metadataCrate)) {
      if (!this.shouldPersistEntityMapping(entity)) {
        continue
      }
      const metadataId = this.requireEntityId(entity)
      const uploadId = originalToUploadIds.get(metadataId) ?? metadataId
      mapping[metadataId] = uploadIdMapping[uploadId] ?? ''
    }
    return Object.fromEntries(
      Object.entries(mapping).sort((a, b) => a[0].localeCompare(b[0])),
    )
  }

  protected shouldPersistEntityMapping(entity: RoCrateEntity): boolean {
    const id = this.requireEntityId(entity)
    return id !== './' && id !== 'ro-crate-metadata.json'
  }

  protected readEntityReferenceIds(value: unknown): string[] {
    const values = Array.isArray(value) ? value : value ? [value] : []
    return values.flatMap((item) => {
      if (typeof item === 'string') {
        return item.trim() ? [item.trim()] : []
      }
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return []
      }
      const id = this.readOptionalEntityString(item as RoCrateEntity, '@id')
      return id ? [id] : []
    })
  }

  protected async createUniqueMappingFileName(rootUri: URI): Promise<string> {
    const rockitUri = rootUri.resolve('.rockit')
    if (!(await this.fileService.exists(rockitUri))) {
      await this.fileService.createFolder(rockitUri)
    }
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
    if (!(await this.fileService.exists(rockitUri))) {
      await this.fileService.createFolder(rockitUri)
    }
    await this.fileService.writeFile(
      rockitUri.resolve(mappingFileName),
      BinaryBuffer.fromString(`${JSON.stringify(this.compactEntityIdMapping(mapping), null, 2)}\n`),
    )
  }

  protected compactEntityIdMapping(mapping: RoCrateEntityIdMapping): RoCrateEntityIdMapping {
    return Object.fromEntries(
      Object.entries(mapping)
        .filter(([, remoteId]) => !!remoteId)
        .sort((a, b) => a[0].localeCompare(b[0])),
    )
  }

  protected async readEntityIdMapping(
    mappingUri: URI,
  ): Promise<RoCrateEntityIdMapping | undefined> {
    if (!(await this.fileService.exists(mappingUri))) {
      return undefined
    }
    try {
      const parsed = JSON.parse(
        (await this.fileService.readFile(mappingUri)).value.toString(),
      )
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return undefined
      }
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] =>
            typeof entry[0] === 'string' && typeof entry[1] === 'string',
        ),
      )
    } catch (error) {
      console.warn('Failed to parse ARP mapping file for update analysis.', error)
      return undefined
    }
  }

  protected toUploadEntityIdMapping(
    metadataIdMapping: RoCrateEntityIdMapping,
    originalToUploadIds: Map<string, string>,
  ): RoCrateEntityIdMapping {
    const mapping: RoCrateEntityIdMapping = { ...metadataIdMapping }
    for (const [originalId, uploadId] of originalToUploadIds) {
      mapping[uploadId] = metadataIdMapping[originalId] ?? ''
      delete mapping[originalId]
    }
    return mapping
  }

  protected toOriginalEntityIdMapping(
    originalToUploadIds: Map<string, string>,
  ): RoCrateEntityIdMapping {
    const mapping: RoCrateEntityIdMapping = {}
    for (const [originalId, uploadId] of originalToUploadIds) {
      mapping[uploadId] = originalId
    }
    return mapping
  }

  protected invertEntityIdMapping(mapping: RoCrateEntityIdMapping): RoCrateEntityIdMapping {
    const inverted: RoCrateEntityIdMapping = {}
    for (const [localId, remoteId] of Object.entries(mapping)) {
      if (remoteId) {
        inverted[remoteId] = localId
      }
    }
    return inverted
  }

  protected async appendExportLog(rootUri: URI, entry: ExportLogEntry): Promise<void> {
    const rockitUri = rootUri.resolve('.rockit')
    if (!(await this.fileService.exists(rockitUri))) {
      await this.fileService.createFolder(rockitUri)
    }
    const historyUri = rockitUri.resolve(EXPORT_LOG_FILE_NAME)
    const entries = await this.readExportLogEntries(historyUri)
    const nextEntries = appendExportLogEvent(entries, entry)
    await this.fileService.writeFile(
      historyUri,
      BinaryBuffer.fromString(`${JSON.stringify(serializeExportLogEntries(nextEntries), null, 2)}\n`),
    )
    this.activeExportLogEntry = entry.status === 'cancelled' ? entry : undefined
  }

  public async markActiveExportFailed(error: unknown): Promise<void> {
    const entry = this.activeExportLogEntry
    if (!entry) {
      return
    }
    await this.appendExportLog(this.getWorkspaceRoot(), {
      ...entry,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  }

  public async markExportTargetFailed(target: DataRepositoryExportTarget, message: string): Promise<void> {
    await this.appendExportLog(this.getWorkspaceRoot(), {
      ...target,
      status: 'failed',
      errorMessage: message,
    })
  }

  protected async readExportLogEntries(historyUri: URI): Promise<ExportLogEntry[]> {
    if (!(await this.fileService.exists(historyUri))) {
      return []
    }
    try {
      const parsed = JSON.parse(
        (await this.fileService.readFile(historyUri)).value.toString(),
      )
      return normalizeExportLogEntries(parsed)
    } catch (error) {
      console.warn(
        'Failed to parse .rockit/export-log.json; starting a new export log.',
        error,
      )
      return []
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
    return `https://hdl.handle.net/${trimmed.replace(/^\/+/, '')}`
  }

  protected normalizePid(value: string): string {
    const extracted = this.extractPidFromTarget(value) ?? value
    const pid = extracted.replace(/^hdl:/i, '')
    return pid.replace(/^\/+/, '').toLowerCase()
  }

  protected extractPidFromTarget(value: string): string | undefined {
    let trimmed = value.trim()
    try {
      trimmed = decodeURIComponent(trimmed)
    } catch {
      // Keep the original target if it contains malformed URL encoding.
    }
    const handleMatch = trimmed.match(/hdl\.handle\.net\/(.+)$/i)
    if (handleMatch) {
      return `hdl:${handleMatch[1]}`
    }
    if (/^hdl:/i.test(trimmed)) {
      return trimmed
    }
    try {
      const persistentId = new URL(trimmed).searchParams.get('persistentId')
      return persistentId?.trim() || undefined
    } catch {
      return undefined
    }
  }

  protected randomId(length: number): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const bytes = new Uint8Array(length)
    window.crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
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

  protected requireEntityId(entity: RoCrateEntity): string {
    const id = this.readOptionalEntityString(entity, '@id')
    if (!id) {
      throw new Error(
        nls.localize(
          'rockit/dataRepository/arpEntityMappingMissingId',
          'ARP upload completed, but an entity mapping file could not be created. An RO-Crate entity has no @id.',
        ),
      )
    }
    return id
  }

  protected async resolveFirstReadableLocalSource(
    sources: readonly RoCrateExportFileSource[],
  ): Promise<{ uri: URI; source: RoCrateExportFileSource } | undefined> {
    for (const source of sources) {
      const uri = this.toLocalFileUri(source.value)
      if (!uri) {
        continue
      }
      try {
        if (!(await this.fileService.exists(uri))) {
          continue
        }
        const stat = await this.fileService.resolve(uri)
        if (stat.isDirectory) {
          continue
        }
        return { uri, source }
      } catch (error) {
        console.warn(
          'Failed to resolve external RO-Crate file reference',
          source.value,
          error,
        )
      }
    }
    return undefined
  }

  protected extractArpPid(crate: RoCrate): string | undefined {
    const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
    const root = graph.find(
      (entity) =>
        entity &&
        typeof entity === 'object' &&
        !Array.isArray(entity) &&
        entity['@id'] === './',
    )
    if (!root || typeof root !== 'object' || Array.isArray(root)) {
      return undefined
    }
    const pid = root['@arpPid']
    return typeof pid === 'string' && pid.trim() !== '' ? pid.trim() : undefined
  }

  protected extractCrateFilePaths(crate: RoCrate): string[] {
    const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
    const files = new Set<string>()
    for (const entity of graph) {
      if (
        !entity ||
        typeof entity !== 'object' ||
        Array.isArray(entity) ||
        !this.entityTypes(entity).includes('File')
      ) {
        continue
      }
      const localPath = this.dataverseFilePathFromEntity(entity)
      if (localPath) {
        files.add(localPath)
      }
    }
    return Array.from(files).sort((a, b) => a.localeCompare(b))
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

  protected toLocalFileUri(value: string): URI | undefined {
    const trimmed = value.trim()
    if (!trimmed) {
      return undefined
    }
    if (/^file:\/\//i.test(trimmed)) {
      return new URI(trimmed)
    }
    if (
      /^[a-zA-Z]:[\\/]/.test(trimmed) ||
      /^[/\\]{2}[^/\\]/.test(trimmed) ||
      /^\/[^/]/.test(trimmed)
    ) {
      return new URI(FileUri.create(trimmed).toString())
    }
    return undefined
  }

  protected ensureDataverseFileContext(crate: RoCrate): void {
    const context = crate['@context']
    if (Array.isArray(context)) {
      const existingObject = context.find(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object' && !Array.isArray(item),
      )
      if (existingObject) {
        Object.assign(existingObject, DATAVERSE_FILE_CONTEXT)
      } else {
        context.push({ ...DATAVERSE_FILE_CONTEXT })
      }
      return
    }
    if (context && typeof context === 'object' && !Array.isArray(context)) {
      Object.assign(context as Record<string, unknown>, DATAVERSE_FILE_CONTEXT)
      return
    }
    crate['@context'] = context
      ? [context, { ...DATAVERSE_FILE_CONTEXT }]
      : ['https://w3id.org/ro/crate/1.1/context', { ...DATAVERSE_FILE_CONTEXT }]
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

  protected isInsideRoot(rootUri: URI, resourceUri: URI): boolean {
    return rootUri.isEqualOrParent(resourceUri)
  }

  protected normalizeBaseUrl(baseUrl: string): string {
    const normalized = baseUrl.trim().replace(/\/+$/, '')
    if (!normalized) {
      throw new Error(nls.localize(
        'rockit/dataRepository/emptyRepositoryBaseUrl',
        'Repository base URL is empty.',
      ))
    }
    return normalized
  }

  protected buildDataverseDatasetUrl(baseUrl: string, pid?: string): string | undefined {
    if (!pid) {
      return undefined
    }
    const encodedPid = encodeURIComponent(pid)
      .replace(/%3A/gi, ':')
      .replace(/%2F/gi, '/')
    return `${baseUrl}/dataset.xhtml?persistentId=${encodedPid}`
  }

  protected readOptionalEntityString(
    entity: RoCrateEntity,
    key: string,
  ): string | undefined {
    const value = entity[key]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }

  protected readStrings(value: unknown): string[] {
    if (typeof value === 'string') {
      return value.trim() ? [value.trim()] : []
    }
    if (Array.isArray(value)) {
      return this.uniqueStrings(value.flatMap((item) => this.readStrings(item)))
    }
    return []
  }

  protected uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter((value) => value.trim() !== '')))
  }

  protected parsePosixPath(value: string): { dir: string; base: string } {
    const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
    const index = normalized.lastIndexOf('/')
    return index === -1
      ? { dir: '', base: normalized }
      : { dir: normalized.slice(0, index), base: normalized.slice(index + 1) }
  }

  protected mimeTypeFromFilename(filename: string): string {
    const lower = filename.toLowerCase()
    if (lower.endsWith('.json')) return 'application/json'
    if (lower.endsWith('.csv')) return 'text/csv'
    if (lower.endsWith('.tsv')) return 'text/tab-separated-values'
    if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain'
    if (lower.endsWith('.png')) return 'image/png'
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
    if (lower.endsWith('.gif')) return 'image/gif'
    if (lower.endsWith('.pdf')) return 'application/pdf'
    if (lower.endsWith('.zip')) return 'application/zip'
    return 'application/octet-stream'
  }

}

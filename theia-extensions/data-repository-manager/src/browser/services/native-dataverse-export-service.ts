// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { URI } from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { nls } from '@theia/core/lib/common/nls';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { CrosswalkRegistry } from 'crosswalk-manager/lib/browser/crosswalk-registry'
import type { CrosswalkDocument } from 'crosswalk-manager/lib/browser/crosswalk-manager-types'
import { inject, injectable } from 'inversify';
import {
  collectRoCrateExportFileReferences,
  localizeExternalRoCrateFileReferences,
  RoCrateExportFileSource,
} from 'rockit-common/lib/common/ro-crate-export-file-references'
import { RoCratePersistenceService } from 'save-ro-crate/lib/browser/ro-crate-persistence-service'
import {
  DataRepositoryConfig,
  DataRepositoryExportTarget,
  DataverseCollection,
  RepositorySyncMode,
} from '../types'
import { DataverseMetadataMappingService } from './dataverse-metadata-mapping-service'
import {
  appendExportLogEvent,
  ExportLogEntry,
  normalizeExportLogEntries,
  serializeExportLogEntries,
} from './export-log'
import { FileHashStoreService } from './file-hash-store-service'
import { mergeRoCratesForSync } from './ro-crate-sync-merge'

type RoCrateEntity = Record<string, unknown>
type RoCrate = Record<string, unknown>
type RoCrateEntityIdMapping = Record<string, string>

interface NativeDataverseUploadCollection {
  files: NativeDataverseUploadFile[]
  metadataCrate: RoCrate
  uploadEntryPathByEntityId: Map<string, string>
  originalToUploadIds: Map<string, string>
}

interface NativeDataverseRemoteFileReference {
  md5: string
  size?: number
  directoryLabel: string
  label: string
  remoteId: string
}

export interface NativeDataverseDraftFileRecord {
  id: string
  label: string
  persistentId?: string
  md5?: string
  size?: number
}

interface DataverseMetadataField {
  typeName: string
  typeClass: 'primitive' | 'compound' | 'controlledVocabulary'
  multiple: boolean
  value: unknown
}

export interface NativeDataverseResponse {
  status?: string
  data?: {
    id?: number
    persistentId?: string
    [key: string]: unknown
  }
  message?: string
  [key: string]: unknown
}

export interface NativeDataverseDatasetCreationResult {
  datasetId?: number
  persistentId?: string
  target?: string
  uploadedFiles: NativeDataverseFileUploadResult[]
  requestUrl: string
  response: NativeDataverseResponse
  mappingFileName: string
  unmappedEntityIds: string[]
}

export interface NativeDataverseUpdateResult {
  persistentId: string
  target: string
  addedFileCount: number
  replacedFileCount: number
  removedFileCount: number
  mappingFileName: string
}

export interface NativeDataverseSyncOptions {
  metadataMode: RepositorySyncMode
}

export interface NativeDataverseSyncResult {
  persistentId: string
  target: string
  mappingFileName: string
  downloadedFileCount: number
  replacedFileCount: number
  keptLocalFileCount: number
  metadataSource: RepositorySyncMode
  updatedMetadataFields: string[]
}

export interface NativeDataverseImportedLinkResult {
  mappingFileName: string
  target: string
}

export interface NativeDataverseDatasetMetadata {
  title: string
  authorNames: string[]
  contactEmails: string[]
  descriptions: string[]
  subjects: string[]
  metadataLanguage?: string
}

export interface NativeDataverseFileUploadResult {
  entryPath: string
  directoryLabel?: string
  fileName: string
  response: NativeDataverseResponse
  localFileId?: string
  lastModified?: number
  sourceSize?: number
}

interface NativeDataverseUploadFile {
  entryPath: string
  content: Uint8Array
  sourceUri?: string
  localFileId?: string
  lastModified?: number
  sourceSize?: number
}

export interface PreparedDataverseCreateExport {
  crate: RoCrate
  metadataCrate: RoCrate
  datasetCreationPayload: Record<string, unknown>
  fileSources: Array<{
    localFileId: string
    entryPath: string
    sourceUri: string
    lastModified?: number
    sourceSize?: number
  }>
  uploadEntryPathByEntityId: Record<string, string>
  originalToUploadIds: Record<string, string>
}

export interface DataverseProviderCreateFileResult {
  localFileId: string
  entryPath: string
  fileName: string
  directoryLabel?: string
  remoteId: string
  md5?: string
  lastModified?: number
  sourceSize?: number
  response: NativeDataverseResponse
}

export interface DataverseProviderCreateResult {
  providerId: 'dataverse'
  persistentId: string
  datasetId?: number
  creationResponse: NativeDataverseResponse
  fileResults: DataverseProviderCreateFileResult[]
  metadataRemoteId?: string
  metadataResponse?: NativeDataverseResponse
  interrupted?: boolean
  errorMessage?: string
}

export interface DataverseProviderCreateCheckpoint {
  operationId: string
  providerId: 'dataverse'
  stage: 'datasetCreated' | 'fileUploaded' | 'metadataUploaded'
  persistentId: string
  creationResponse?: NativeDataverseResponse
  fileResult?: DataverseProviderCreateFileResult
  metadataRemoteId?: string
}

export interface DataverseProviderUpdateInspection {
  providerId: 'dataverse'
  persistentId: string
  datasetVersionData: Record<string, unknown>
  draftFiles: NativeDataverseDraftFileRecord[]
  metadataFileId: string
  remoteMetadataCrate: RoCrate
}

export interface DataverseProviderUpdateFileResult {
  kind: 'added' | 'changed'
  localFileId: string
  entryPath: string
  remoteId: string
  md5?: string
  lastModified?: number
  sourceSize?: number
}

export interface DataverseProviderUpdateResult {
  providerId: 'dataverse'
  persistentId: string
  fileResults: DataverseProviderUpdateFileResult[]
  removedRemoteFileIds: string[]
  metadataRemoteId: string
}

export interface DataverseProviderUpdateCheckpoint {
  operationId: string
  providerId: 'dataverse'
  persistentId: string
  stage: 'fileUploaded' | 'fileReplaced' | 'fileRemoved' | 'metadataReplaced'
  fileResult?: DataverseProviderUpdateFileResult
  remoteFileId?: string
  metadataRemoteId?: string
}

export interface PreparedDataverseSyncFile {
  remoteId: string
  localId: string
  localPath: string
  targetUri: string
  targetParentUri: string
  checksum?: string
  remoteSize?: number
  kind: 'new' | 'changed'
}

export interface DataverseProviderSyncResult {
  providerId: 'dataverse'
  persistentId: string
  downloadedFiles: PreparedDataverseSyncFile[]
}

export interface DataverseProviderSyncCheckpoint {
  operationId: string
  providerId: 'dataverse'
  persistentId: string
  stage: 'fileDownloaded'
  file: PreparedDataverseSyncFile
}

interface PreparedDataverseSyncExport {
  persistentId: string
  files: PreparedDataverseSyncFile[]
}

interface PreparedDataverseUpdateFile {
  localFileId: string
  entryPath: string
  sourceUri: string
  remoteFileId?: string
  lastModified?: number
  sourceSize?: number
}

interface PreparedDataverseUpdateExport {
  persistentId: string
  target: string
  crate: RoCrate
  metadataCrate: RoCrate
  mappingFileName: string
  mapping: RoCrateEntityIdMapping
  originalToUploadIds: Record<string, string>
  addedFiles: PreparedDataverseUpdateFile[]
  changedFiles: PreparedDataverseUpdateFile[]
  removedFiles: Array<{ remoteFileId: string }>
  metadataFileId: string
  nativeMetadataPayload?: Record<string, unknown>
  nativeLicensePayload?: { name: string }
  datasetId?: number
}

interface ActiveDataverseProviderCreate {
  rootUri: URI
  repository: DataRepositoryConfig
  crosswalkId?: string
  collectionId: string
  plan: PreparedDataverseCreateExport
  mappingFileName: string
  mapping: RoCrateEntityIdMapping
  checkpointedFiles: Set<string>
  persistentId?: string
  target?: string
  logStarted: boolean
  metadataCheckpointed: boolean
  hashUpdated: boolean
}

interface ActiveDataverseProviderUpdate {
  rootUri: URI
  repository: DataRepositoryConfig
  plan: PreparedDataverseUpdateExport
  mapping: RoCrateEntityIdMapping
  checkpointedFiles: Set<string>
  removedRemoteFileIds: Set<string>
  metadataCheckpointed: boolean
  hashUpdated: boolean
}

interface ActiveDataverseProviderSync {
  rootUri: URI
  plan: PreparedDataverseSyncExport
  mappingFileName: string
  mapping: RoCrateEntityIdMapping
  checkpointedFiles: Set<string>
}

interface NativeDataverseExportTarget {
  persistentId: string
  exportLogEntry: ExportLogEntry
  mapping: RoCrateEntityIdMapping
}

export interface NativeDataverseExportProgress {
  completedSteps: number
  totalSteps: number
  message: string
}

export type NativeDataverseExportProgressReporter = (
  progress: NativeDataverseExportProgress,
) => void

const EXPORT_LOG_FILE_NAME = 'export-log.json'
const FILE_HASH_CONTEXT = 'https://dataverse.org/schema/file/hash'

@injectable()
export class NativeDataverseExportService {
  protected activeExportLogEntry: ExportLogEntry | undefined
  protected readonly activeProviderCreates = new Map<string, ActiveDataverseProviderCreate>()
  protected readonly activeProviderUpdates = new Map<string, ActiveDataverseProviderUpdate>()
  protected readonly activeProviderSyncs = new Map<string, ActiveDataverseProviderSync>()
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
    @inject(CrosswalkRegistry)
    protected readonly crosswalkRegistry: CrosswalkRegistry,
  ) {}

  /**
   * Persists the local side of a link for a dataset downloaded from Dataverse.
   * The explicit root URI is intentional: the imported directory is not the
   * active workspace until after this method completes.
   */
  public async persistImportedDatasetLink(
    rootUri: URI,
    repository: DataRepositoryConfig,
    persistentId: string,
    importedDatasetVersionData: Record<string, unknown>,
    crosswalkId?: string,
  ): Promise<NativeDataverseImportedLinkResult> {
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const datasetVersionData = importedDatasetVersionData
    const metadataUri = rootUri.resolve('ro-crate-metadata.json')
    let crate = await this.fileService.exists(metadataUri)
      ? await this.readRoCrate(metadataUri)
      : undefined
    const selectedCrosswalk = crate
      ? await this.readSelectedCrosswalk(crosswalkId)
      : undefined
    if (crate && selectedCrosswalk) {
      crate = this.metadataMappingService.applyMetadataBlocksToRoCrate(
        crate,
        datasetVersionData,
        selectedCrosswalk,
      ).crate
      await this.fileService.writeFile(
        metadataUri,
        BinaryBuffer.fromString(`${JSON.stringify(crate, null, 2)}\n`),
      )
    }
    const remoteReferences = this.extractRemoteFileReferences(datasetVersionData)
    const mapping = crate
      ? this.buildEntityIdMapping(crate, [{
          entryPath: '',
          fileName: '',
          response: datasetVersionData as NativeDataverseResponse,
        }])
      : {}

    for (const reference of remoteReferences) {
      const remotePath = [reference.directoryLabel, reference.label]
        .filter(Boolean)
        .join('/')
      if (!remotePath) {
        continue
      }
      const localId = crate
        ? this.findLocalEntityIdForPath(crate, remotePath) ?? remotePath
        : remotePath
      mapping[localId] = reference.remoteId
      const localUri = rootUri.resolve(remotePath)
      if (
        reference.label !== 'ro-crate-metadata.json' &&
        this.isSafeRelativePath(remotePath) &&
        this.isInsideRoot(rootUri, localUri) &&
        await this.fileService.exists(localUri)
      ) {
        const stat = await this.fileService.resolve(localUri)
        if (!stat.isDirectory) {
          await this.fileHashStoreService.recordKnownHash(
            rootUri,
            localId,
            stat.mtime,
            stat.size,
            reference.md5,
          )
        }
      }
    }

    const metadataFile = this.extractDraftFileRecords(datasetVersionData)
      .find((file) => file.label === 'ro-crate-metadata.json')
    if (metadataFile) {
      mapping['ro-crate-metadata.json'] = metadataFile.id
    }

    const mappingFileName = await this.createUniqueMappingFileName(rootUri)
    await this.saveEntityIdMapping(rootUri, mappingFileName, mapping)
    const target = this.buildDataverseDatasetUrl(baseUrl, persistentId)
      || this.buildPidTarget(persistentId)
      || persistentId
    await this.appendExportLog(rootUri, {
      target,
      repository: baseUrl,
      mappingFile: mappingFileName,
      crosswalkFile: crosswalkId,
      syncType: 'update',
      status: 'success',
      lastSuccessfulActionAt: new Date().toISOString(),
      datasetName: crate ? this.getRootDatasetName(crate) : undefined,
    })
    return { mappingFileName, target }
  }

  /** Prepare mappings locally and delegate only Dataverse transport to the provider. */
  public async exportToDataverseWithProvider(
    repository: DataRepositoryConfig,
    collection: DataverseCollection,
    datasetMetadata: NativeDataverseDatasetMetadata,
    enabledMetadataBlocks: Set<string> | undefined,
    invokeProvider: (input: {
      repository: DataRepositoryConfig
      collectionId: string
      datasetCreationPayload: Record<string, unknown>
      plan: PreparedDataverseCreateExport
      operationId: string
    }) => Promise<DataverseProviderCreateResult>,
    crosswalkId?: string,
  ): Promise<NativeDataverseDatasetCreationResult> {
    const rootUri = this.getWorkspaceRoot()
    const collectionId = collection.alias || collection.id
    const crate = await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json'))
    const selectedCrosswalk = await this.readSelectedCrosswalk(crosswalkId)
    const datasetCreationPayload = await this.buildDatasetCreationPayload(
      datasetMetadata,
      crate,
      enabledMetadataBlocks,
      selectedCrosswalk,
    )
    const uploadCollection = await this.collectRoCrateUploadFiles(crate, rootUri)
    const plan: PreparedDataverseCreateExport = {
      crate,
      metadataCrate: uploadCollection.metadataCrate,
      datasetCreationPayload,
      fileSources: uploadCollection.files.map((file) => {
        if (!file.localFileId || !file.sourceUri) {
          throw new Error(`Cannot prepare Dataverse upload source '${file.entryPath}'.`)
        }
        return {
          localFileId: file.localFileId,
          entryPath: file.entryPath,
          sourceUri: file.sourceUri,
          lastModified: file.lastModified,
          sourceSize: file.sourceSize,
        }
      }),
      uploadEntryPathByEntityId: Object.fromEntries(
        uploadCollection.uploadEntryPathByEntityId,
      ),
      originalToUploadIds: Object.fromEntries(uploadCollection.originalToUploadIds),
    }
    const mappingFileName = await this.createUniqueMappingFileName(rootUri)
    const operationId = this.randomId(32)
    const active: ActiveDataverseProviderCreate = {
      rootUri,
      repository,
      crosswalkId,
      collectionId,
      plan,
      mappingFileName,
      mapping: this.buildEntityIdMapping(
        crate,
        [],
        uploadCollection.uploadEntryPathByEntityId,
      ),
      checkpointedFiles: new Set(),
      logStarted: false,
      metadataCheckpointed: false,
      hashUpdated: false,
    }
    this.activeProviderCreates.set(operationId, active)
    try {
      const remote = await invokeProvider({
        repository,
        collectionId,
        datasetCreationPayload,
        plan,
        operationId,
      })
      if (
        !remote ||
        remote.providerId !== 'dataverse' ||
        !remote.persistentId ||
        !Array.isArray(remote.fileResults)
      ) {
        throw new Error('The Dataverse provider did not return a valid dataset creation result.')
      }
      if (!active.logStarted) {
        await this.handleProviderCreateCheckpoint({
          operationId,
          providerId: 'dataverse',
          stage: 'datasetCreated',
          persistentId: remote.persistentId,
          creationResponse: remote.creationResponse,
        })
      }
      for (const fileResult of remote.fileResults) {
        const key = this.providerCreateFileKey(fileResult.localFileId, fileResult.entryPath)
        if (!active.checkpointedFiles.has(key)) {
          await this.handleProviderCreateCheckpoint({
            operationId,
            providerId: 'dataverse',
            stage: 'fileUploaded',
            persistentId: remote.persistentId,
            fileResult,
          })
        }
      }
      if (remote.interrupted) {
        throw new Error(
          remote.errorMessage || 'Dataverse export stopped after creating the remote dataset.',
        )
      }
      if (!remote.metadataRemoteId || !remote.metadataResponse) {
        throw new Error('The Dataverse provider did not return the uploaded metadata file.')
      }
      if (!active.metadataCheckpointed) {
        await this.handleProviderCreateCheckpoint({
          operationId,
          providerId: 'dataverse',
          stage: 'metadataUploaded',
          persistentId: remote.persistentId,
          metadataRemoteId: remote.metadataRemoteId,
        })
      }
      if (active.hashUpdated && this.appStateService.roCrate) {
        await this.roCratePersistenceService.write(rootUri, this.appStateService.roCrate)
      }
      const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
      const target =
        active.target ||
        this.buildDataverseDatasetUrl(baseUrl, remote.persistentId) ||
        this.buildPidTarget(remote.persistentId) ||
        remote.persistentId
      await this.saveEntityIdMapping(rootUri, mappingFileName, active.mapping)
      await this.appendExportLog(rootUri, {
        target,
        repository: baseUrl,
        mappingFile: mappingFileName,
        crosswalkFile: crosswalkId,
        syncType: 'create',
        status: 'success',
        lastSuccessfulActionAt: new Date().toISOString(),
        datasetName: this.getRootDatasetName(crate),
        collectionId,
      })
      const uploadedFiles: NativeDataverseFileUploadResult[] = [
        ...remote.fileResults.map((file) => ({
          entryPath: file.entryPath,
          directoryLabel: file.directoryLabel,
          fileName: file.fileName,
          response: file.response,
          localFileId: file.localFileId,
          lastModified: file.lastModified,
          sourceSize: file.sourceSize,
        })),
        {
          entryPath: 'ro-crate-metadata.json',
          fileName: 'ro-crate-metadata.json',
          response: remote.metadataResponse,
        },
      ]
      return {
        datasetId: remote.datasetId,
        persistentId: remote.persistentId,
        target,
        uploadedFiles,
        requestUrl: `${baseUrl}/api/v1/dataverses/${encodeURIComponent(collectionId)}/datasets`,
        response: remote.creationResponse,
        mappingFileName,
        unmappedEntityIds: Object.entries(active.mapping)
          .filter(([, remoteId]) => !remoteId)
          .map(([entityId]) => entityId),
      }
    } catch (error) {
      if (active.logStarted && active.target) {
        await this.appendExportLog(rootUri, {
          target: active.target,
          repository: this.normalizeBaseUrl(repository.baseUrl),
          mappingFile: mappingFileName,
          crosswalkFile: crosswalkId,
          syncType: 'create',
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          datasetName: this.getRootDatasetName(crate),
          collectionId,
        })
      }
      throw error
    } finally {
      this.activeProviderCreates.delete(operationId)
    }
  }

  public async handleProviderCreateCheckpoint(
    value: DataverseProviderCreateCheckpoint,
  ): Promise<void> {
    if (
      !value ||
      value.providerId !== 'dataverse' ||
      typeof value.operationId !== 'string'
    ) {
      throw new Error('The Dataverse export checkpoint is invalid.')
    }
    const active = this.activeProviderCreates.get(value.operationId)
    if (!active) {
      throw new Error('The Dataverse export checkpoint no longer has an active RocKIT export.')
    }
    if (!value.persistentId?.trim()) {
      throw new Error('The Dataverse export checkpoint does not contain a persistent ID.')
    }
    if (active.persistentId && active.persistentId !== value.persistentId) {
      throw new Error('The Dataverse export checkpoint refers to a different dataset.')
    }
    active.persistentId = value.persistentId
    if (!active.logStarted) {
      const baseUrl = this.normalizeBaseUrl(active.repository.baseUrl)
      active.target =
        this.buildDataverseDatasetUrl(baseUrl, value.persistentId) ||
        this.buildPidTarget(value.persistentId) ||
        value.persistentId
      await this.saveEntityIdMapping(
        active.rootUri,
        active.mappingFileName,
        active.mapping,
      )
      await this.appendExportLog(active.rootUri, {
        target: active.target,
        repository: baseUrl,
        mappingFile: active.mappingFileName,
        crosswalkFile: active.crosswalkId,
        syncType: 'create',
        status: 'cancelled',
        datasetName: this.getRootDatasetName(active.plan.crate),
        collectionId: active.collectionId,
      })
      active.logStarted = true
    }
    if (value.stage === 'datasetCreated') return
    if (value.stage === 'metadataUploaded') {
      if (!value.metadataRemoteId?.trim()) {
        throw new Error('The Dataverse metadata checkpoint has no remote file ID.')
      }
      active.mapping['ro-crate-metadata.json'] = value.metadataRemoteId
      await this.saveEntityIdMapping(active.rootUri, active.mappingFileName, active.mapping)
      active.metadataCheckpointed = true
      return
    }
    const file = value.fileResult
    const planned = file && active.plan.fileSources.find(
      (source) =>
        source.localFileId === file.localFileId && source.entryPath === file.entryPath,
    )
    if (!file || !planned || !file.remoteId?.trim()) {
      throw new Error('The Dataverse uploaded-file checkpoint is inconsistent with the plan.')
    }
    active.mapping[file.localFileId] = file.remoteId
    await this.saveEntityIdMapping(active.rootUri, active.mappingFileName, active.mapping)
    await this.fileHashStoreService.recordKnownHash(
      active.rootUri,
      file.localFileId,
      planned.lastModified,
      planned.sourceSize,
      file.md5,
    )
    const uploadEntityId =
      active.plan.originalToUploadIds[file.localFileId] ?? file.localFileId
    active.hashUpdated =
      (await this.persistUploadedFileHash(
        active.rootUri,
        active.plan.crate,
        file.localFileId,
        active.plan.metadataCrate,
        uploadEntityId,
        file.md5,
        false,
      )) || active.hashUpdated
    active.checkpointedFiles.add(
      this.providerCreateFileKey(file.localFileId, file.entryPath),
    )
  }

  protected providerCreateFileKey(localFileId: string, entryPath: string): string {
    return `${localFileId}\0${entryPath}`
  }

  public async updateDataverseWithProvider(
    repository: DataRepositoryConfig,
    exportTargetSelection: DataRepositoryExportTarget,
    invokeProvider: (input: Record<string, unknown>) => Promise<unknown>,
  ): Promise<NativeDataverseUpdateResult | undefined> {
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const rootUri = this.getWorkspaceRoot()
    const crate = await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json'))
    const exportTarget = await this.resolveExistingExportTarget(
      rootUri, repository, exportTargetSelection)
    if (!exportTarget) return undefined
    const crosswalkId = exportTarget.exportLogEntry.crosswalkFile ??
      exportTargetSelection.crosswalkFile

    const rawInspection = await invokeProvider({
      phase: 'inspect', repository, persistentId: exportTarget.persistentId,
    })
    const inspection = rawInspection && typeof rawInspection === 'object' &&
      !Array.isArray(rawInspection)
      ? rawInspection as DataverseProviderUpdateInspection
      : undefined
    if (!inspection || inspection.providerId !== 'dataverse' ||
        inspection.persistentId !== exportTarget.persistentId ||
        !Array.isArray(inspection.draftFiles) ||
        !Array.isArray(inspection.remoteMetadataCrate?.['@graph']) ||
        !inspection.metadataFileId || !inspection.datasetVersionData) {
      throw new Error('The Dataverse provider did not return a complete draft inspection.')
    }

    const uploadCollection = await this.collectRoCrateUploadFiles(crate, rootUri)
    this.normalizeMappingToDatabaseIds(exportTarget.mapping, inspection.draftFiles)
    this.normalizeLocalizedMappingKeys(
      exportTarget.mapping, uploadCollection.originalToUploadIds)
    exportTarget.mapping['ro-crate-metadata.json'] = inspection.metadataFileId
    const draftFilesById = new Map(inspection.draftFiles.map(file => [file.id, file]))
    const localReachableIds = this.collectReachableEntityIds(crate)
    const localFilesById = new Map(
      this.readGraph(crate)
        .filter(entity => this.entityTypes(entity).includes('File'))
        .filter(entity => localReachableIds.has(this.requireEntityId(entity)))
        .map(entity => [this.requireEntityId(entity), entity]),
    )
    const remoteEntitiesById = new Map(
      this.readGraph(inspection.remoteMetadataCrate)
        .map(entity => [this.requireEntityId(entity), entity]),
    )
    const uploadFilesByPath = new Map(
      uploadCollection.files.map(file => [file.entryPath, file]),
    )
    const addedIds: string[] = []
    const changedIds: string[] = []
    const unchangedIds: string[] = []
    const matchedRemoteIds = new Set<string>()
    const storedFileHashes = await this.fileHashStoreService.readFileHashes(rootUri)
    for (const [localId] of localFilesById) {
      const remoteId = exportTarget.mapping[localId]
      const remoteEntity = remoteId ? remoteEntitiesById.get(remoteId) : undefined
      if (!remoteId || !remoteEntity) {
        addedIds.push(localId)
        continue
      }
      matchedRemoteIds.add(remoteId)
      const uploadFile = this.requireUploadFile(
        localId, uploadCollection, uploadFilesByPath)
      const draftFile = draftFilesById.get(remoteId)
      const unchanged = this.fileHashStoreService.isFileRecordUnchanged(
        storedFileHashes[localId], {
          localLastModified: uploadFile.lastModified,
          localSize: uploadFile.sourceSize,
          remoteMd5: draftFile?.md5 ?? this.fileEntityHash(remoteEntity),
          remoteSize: draftFile?.size ?? this.fileEntitySize(remoteEntity),
        })
      if (unchanged) unchangedIds.push(localId)
      else changedIds.push(localId)
    }
    const removedRemoteFileIds = this.readGraph(inspection.remoteMetadataCrate)
      .filter(entity => this.entityTypes(entity).includes('File'))
      .map(entity => this.requireEntityId(entity))
      .filter(remoteId => remoteId !== 'ro-crate-metadata.json')
      .filter(remoteId => !matchedRemoteIds.has(remoteId))

    const prepareFile = (localId: string, replacement: boolean): PreparedDataverseUpdateFile => {
      const file = this.requireUploadFile(localId, uploadCollection, uploadFilesByPath)
      if (!file.sourceUri) {
        throw new Error(`Cannot prepare Dataverse update source '${file.entryPath}'.`)
      }
      return {
        localFileId: localId,
        entryPath: file.entryPath,
        sourceUri: file.sourceUri,
        lastModified: file.lastModified,
        sourceSize: file.sourceSize,
        ...(replacement ? { remoteFileId: exportTarget.mapping[localId] } : {}),
      }
    }
    const enabledMetadataBlocks = this.datasetVersionMetadataBlockAliases(
      inspection.datasetVersionData)
    const selectedCrosswalk = await this.readSelectedCrosswalk(crosswalkId)
    const nativeMetadataPayload = await this.buildDatasetNativeMetadataUpdatePayload(
      inspection.datasetVersionData,
      crate,
      enabledMetadataBlocks,
      selectedCrosswalk,
    )
    const nativeLicense = this.dataverseLicense(crate)
    const target = this.buildDataverseDatasetUrl(baseUrl, exportTarget.persistentId) ||
      this.buildPidTarget(exportTarget.persistentId) || exportTarget.persistentId
    const plan: PreparedDataverseUpdateExport = {
      persistentId: exportTarget.persistentId,
      target,
      crate,
      metadataCrate: uploadCollection.metadataCrate,
      mappingFileName: exportTarget.exportLogEntry.mappingFile,
      mapping: { ...exportTarget.mapping },
      originalToUploadIds: Object.fromEntries(uploadCollection.originalToUploadIds),
      addedFiles: addedIds.map(id => prepareFile(id, false)),
      changedFiles: changedIds.map(id => prepareFile(id, true)),
      removedFiles: removedRemoteFileIds.map(remoteFileId => ({ remoteFileId })),
      metadataFileId: inspection.metadataFileId,
      ...(nativeMetadataPayload ? { nativeMetadataPayload } : {}),
      ...(nativeLicense
        ? { nativeLicensePayload: { name: nativeLicense.name } }
        : {}),
      ...(typeof inspection.datasetVersionData.datasetId === 'number'
        ? { datasetId: inspection.datasetVersionData.datasetId }
        : {}),
    }
    const operationId = this.randomId(32)
    const active: ActiveDataverseProviderUpdate = {
      rootUri,
      repository,
      plan,
      mapping: { ...plan.mapping },
      checkpointedFiles: new Set(),
      removedRemoteFileIds: new Set(),
      metadataCheckpointed: false,
      hashUpdated: false,
    }
    this.activeProviderUpdates.set(operationId, active)
    await this.saveEntityIdMapping(rootUri, plan.mappingFileName, active.mapping)
    await this.appendExportLog(rootUri, {
      target,
      repository: baseUrl,
      mappingFile: plan.mappingFileName,
      crosswalkFile: crosswalkId,
      syncType: 'update',
      status: 'cancelled',
      collectionId: exportTarget.exportLogEntry.collectionId,
      datasetName: this.getRootDatasetName(crate),
    })
    for (const localId of unchangedIds) {
      const uploadId = uploadCollection.originalToUploadIds.get(localId) ?? localId
      active.hashUpdated = (await this.persistUploadedFileHash(
        rootUri, crate, localId, uploadCollection.metadataCrate, uploadId,
        storedFileHashes[localId]?.md5, false)) || active.hashUpdated
    }

    try {
      const rawResult = await invokeProvider({
        phase: 'apply', repository, persistentId: plan.persistentId, plan, operationId,
      })
      const result = rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
        ? rawResult as DataverseProviderUpdateResult
        : undefined
      if (!result || result.providerId !== 'dataverse' ||
          result.persistentId !== plan.persistentId || !Array.isArray(result.fileResults) ||
          !Array.isArray(result.removedRemoteFileIds) || !result.metadataRemoteId) {
        throw new Error('The Dataverse provider did not return a complete update result.')
      }
      for (const fileResult of result.fileResults) {
        const key = `${fileResult.kind}\0${fileResult.localFileId}`
        if (!active.checkpointedFiles.has(key)) {
          await this.handleProviderUpdateCheckpoint({
            operationId, providerId: 'dataverse', persistentId: plan.persistentId,
            stage: fileResult.kind === 'added' ? 'fileUploaded' : 'fileReplaced',
            fileResult,
          })
        }
      }
      for (const remoteFileId of result.removedRemoteFileIds) {
        if (!active.removedRemoteFileIds.has(remoteFileId)) {
          await this.handleProviderUpdateCheckpoint({
            operationId, providerId: 'dataverse', persistentId: plan.persistentId,
            stage: 'fileRemoved', remoteFileId,
          })
        }
      }
      if (!active.metadataCheckpointed) {
        await this.handleProviderUpdateCheckpoint({
          operationId, providerId: 'dataverse', persistentId: plan.persistentId,
          stage: 'metadataReplaced', metadataRemoteId: result.metadataRemoteId,
        })
      }
      if (active.hashUpdated && this.appStateService.roCrate) {
        await this.roCratePersistenceService.write(rootUri, this.appStateService.roCrate)
      }
      await this.saveEntityIdMapping(rootUri, plan.mappingFileName, active.mapping)
      await this.appendExportLog(rootUri, {
        target,
        repository: baseUrl,
        mappingFile: plan.mappingFileName,
        crosswalkFile: crosswalkId,
        syncType: 'update',
        status: 'success',
        lastSuccessfulActionAt: new Date().toISOString(),
        collectionId: exportTarget.exportLogEntry.collectionId,
        datasetName: this.getRootDatasetName(crate),
      })
      return {
        persistentId: plan.persistentId,
        target,
        addedFileCount: plan.addedFiles.length,
        replacedFileCount: plan.changedFiles.length,
        removedFileCount: plan.removedFiles.length,
        mappingFileName: plan.mappingFileName,
      }
    } catch (error) {
      await this.appendExportLog(rootUri, {
        target,
        repository: baseUrl,
        mappingFile: plan.mappingFileName,
        crosswalkFile: crosswalkId,
        syncType: 'update',
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        collectionId: exportTarget.exportLogEntry.collectionId,
        datasetName: this.getRootDatasetName(crate),
      })
      throw error
    } finally {
      this.activeProviderUpdates.delete(operationId)
    }
  }

  public async handleProviderUpdateCheckpoint(
    value: DataverseProviderUpdateCheckpoint,
  ): Promise<void> {
    if (!value || value.providerId !== 'dataverse' || typeof value.operationId !== 'string') {
      throw new Error('The Dataverse update checkpoint is invalid.')
    }
    const active = this.activeProviderUpdates.get(value.operationId)
    if (!active) throw new Error('The Dataverse update checkpoint no longer has an active update.')
    if (value.persistentId !== active.plan.persistentId) {
      throw new Error('The Dataverse update checkpoint refers to a different dataset.')
    }
    if (value.stage === 'fileRemoved') {
      if (!value.remoteFileId ||
          !active.plan.removedFiles.some(file => file.remoteFileId === value.remoteFileId)) {
        throw new Error('The Dataverse removed-file checkpoint is inconsistent with the plan.')
      }
      this.removeMappedRemoteFileId(active.mapping, value.remoteFileId)
      active.removedRemoteFileIds.add(value.remoteFileId)
    } else if (value.stage === 'metadataReplaced') {
      if (!value.metadataRemoteId) {
        throw new Error('The Dataverse metadata checkpoint has no remote file ID.')
      }
      active.mapping['ro-crate-metadata.json'] = value.metadataRemoteId
      active.metadataCheckpointed = true
    } else {
      const file = value.fileResult
      const planned = file && [...active.plan.addedFiles, ...active.plan.changedFiles]
        .find(candidate => candidate.localFileId === file.localFileId &&
          candidate.entryPath === file.entryPath)
      if (!file || !planned || !file.remoteId) {
        throw new Error('The Dataverse updated-file checkpoint is inconsistent with the plan.')
      }
      active.mapping[file.localFileId] = file.remoteId
      active.hashUpdated = (await this.persistUploadedFileHash(
        active.rootUri,
        active.plan.crate,
        file.localFileId,
        active.plan.metadataCrate,
        active.plan.originalToUploadIds[file.localFileId] ?? file.localFileId,
        file.md5,
        false,
      )) || active.hashUpdated
      active.checkpointedFiles.add(`${file.kind}\0${file.localFileId}`)
    }
    await this.saveEntityIdMapping(
      active.rootUri, active.plan.mappingFileName, active.mapping)
  }

  /**
   * Pulls changes from a previously exported native Dataverse dataset into the
   * local workspace.
   *
   * File transfer remains Dataverse-specific: remote datafile IDs from the local
   * `.rockit` mapping and Dataverse version file records determine where files
   * are downloaded. Metadata conversion is handled separately by applying the
   * Dataverse crosswalk in reverse after the uploaded `ro-crate-metadata.json`
   * has been localized and combined with the local graph using the selected
   * sync policy.
   */
  public async syncDataverseWithProvider(
    repository: DataRepositoryConfig,
    exportTargetSelection: DataRepositoryExportTarget,
    options: NativeDataverseSyncOptions,
    invokeProvider: (input: Record<string, unknown>) => Promise<unknown>,
  ): Promise<NativeDataverseSyncResult | undefined> {
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const rootUri = this.getWorkspaceRoot()
    const metadataUri = rootUri.resolve('ro-crate-metadata.json')
    const localCrate = await this.readRoCrate(metadataUri)
    const exportTarget = await this.resolveExistingExportTarget(
      rootUri, repository, exportTargetSelection)
    if (!exportTarget) return undefined
    const crosswalkId = exportTarget.exportLogEntry.crosswalkFile ??
      exportTargetSelection.crosswalkFile

    const rawInspection = await invokeProvider({
      phase: 'inspect', repository, persistentId: exportTarget.persistentId,
    })
    const inspection = rawInspection && typeof rawInspection === 'object' &&
      !Array.isArray(rawInspection)
      ? rawInspection as DataverseProviderUpdateInspection
      : undefined
    if (!inspection || inspection.providerId !== 'dataverse' ||
        inspection.persistentId !== exportTarget.persistentId ||
        !Array.isArray(inspection.draftFiles) ||
        !Array.isArray(inspection.remoteMetadataCrate?.['@graph'])) {
      throw new Error('The Dataverse provider did not return a complete sync inspection.')
    }
    const remoteFileReferences = this.extractRemoteFileReferences(
      inspection.datasetVersionData)
    this.normalizeMappingToDatabaseIds(exportTarget.mapping, inspection.draftFiles)
    exportTarget.mapping['ro-crate-metadata.json'] = inspection.metadataFileId
    const initialMapping = { ...exportTarget.mapping }
    const remoteToLocalMapping = this.invertEntityIdMapping(exportTarget.mapping)
    const remoteMetadataFiles = this.readGraph(inspection.remoteMetadataCrate)
      .filter(entity => this.entityTypes(entity).includes('File'))
      .filter(entity => this.requireEntityId(entity) !== 'ro-crate-metadata.json')
    const remoteItems = this.collectRemoteDataverseSyncItems(
      remoteMetadataFiles,
      remoteFileReferences,
      remoteToLocalMapping,
      options.metadataMode !== 'remote-additions',
    )
    const relocatedLocalIds: RoCrateEntityIdMapping = {}
    for (const item of remoteItems) {
      if (options.metadataMode !== 'remote-additions') {
        const previousLocalId = Object.entries(exportTarget.mapping)
          .find(([, remoteId]) => remoteId === item.remoteId)?.[0]
        if (previousLocalId && previousLocalId !== item.localId) {
          relocatedLocalIds[previousLocalId] = item.localId
        }
        for (const [localId, remoteId] of Object.entries(exportTarget.mapping)) {
          if (remoteId === item.remoteId) delete exportTarget.mapping[localId]
        }
      }
      exportTarget.mapping[item.localId] = item.remoteId
    }

    const files: PreparedDataverseSyncFile[] = []
    let keptLocalFileCount = 0
    const storedFileHashes = await this.fileHashStoreService.readFileHashes(rootUri)
    for (const item of remoteItems) {
      const targetUri = rootUri.resolve(item.localPath)
      let kind: 'new' | 'changed' | undefined
      if (!(await this.fileService.exists(targetUri))) {
        kind = 'new'
      } else {
        const checksum = item.checksum ?? this.fileEntityHash(item.remoteEntity)
        const stat = await this.fileService.resolve(targetUri)
        const unchanged = !stat.isDirectory &&
          this.fileHashStoreService.isFileRecordUnchanged(
            storedFileHashes[item.localId], {
              localLastModified: stat.mtime,
              localSize: stat.size,
              remoteMd5: checksum,
              remoteSize: item.remoteSize,
            })
        if (unchanged || options.metadataMode === 'remote-additions') {
          keptLocalFileCount += 1
        } else {
          kind = 'changed'
        }
      }
      if (kind) {
        const parentPath = this.parsePosixPath(item.localPath).dir
        files.push({
          remoteId: item.remoteId,
          localId: item.localId,
          localPath: item.localPath,
          targetUri: targetUri.toString(),
          targetParentUri: (parentPath ? rootUri.resolve(parentPath) : rootUri).toString(),
          checksum: item.checksum ?? this.fileEntityHash(item.remoteEntity),
          remoteSize: item.remoteSize,
          kind,
        })
      }
    }

    const plan: PreparedDataverseSyncExport = {
      persistentId: exportTarget.persistentId,
      files,
    }
    const plannedRemoteIds = new Set(files.map(file => file.remoteId))
    const recoveryMapping = { ...initialMapping }
    for (const item of remoteItems) {
      if (plannedRemoteIds.has(item.remoteId)) continue
      if (options.metadataMode !== 'remote-additions') {
        this.removeMappedRemoteFileId(recoveryMapping, item.remoteId)
      }
      recoveryMapping[item.localId] = item.remoteId
    }
    const operationId = this.randomId(32)
    const active: ActiveDataverseProviderSync = {
      rootUri,
      plan,
      mappingFileName: exportTarget.exportLogEntry.mappingFile,
      mapping: recoveryMapping,
      checkpointedFiles: new Set(),
    }
    this.activeProviderSyncs.set(operationId, active)
    const target = this.buildDataverseDatasetUrl(baseUrl, exportTarget.persistentId) ||
      this.buildPidTarget(exportTarget.persistentId) || exportTarget.persistentId
    await this.appendExportLog(rootUri, {
      ...exportTarget.exportLogEntry,
      target,
      crosswalkFile: crosswalkId,
      syncType: 'sync',
      status: 'cancelled',
    })

    try {
      const rawResult = await invokeProvider({
        phase: 'download', repository, persistentId: plan.persistentId, plan, operationId,
      })
      const result = rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
        ? rawResult as DataverseProviderSyncResult
        : undefined
      if (!result || result.providerId !== 'dataverse' ||
          result.persistentId !== plan.persistentId ||
          !Array.isArray(result.downloadedFiles)) {
        throw new Error('The Dataverse provider did not return a complete sync result.')
      }
      for (const file of result.downloadedFiles) {
        const key = `${file.kind}\0${file.remoteId}\0${file.localId}`
        if (!active.checkpointedFiles.has(key)) {
          await this.handleProviderSyncCheckpoint({
            operationId, providerId: 'dataverse', persistentId: plan.persistentId,
            stage: 'fileDownloaded', file,
          })
        }
      }

      const localizedRemoteCrate = this.rewriteCrateEntityIds(
        inspection.remoteMetadataCrate,
        this.invertEntityIdMapping(exportTarget.mapping),
      )
      const selectedCrosswalk = await this.readSelectedCrosswalk(crosswalkId)
      const mappedRemoteResult = selectedCrosswalk
        ? this.metadataMappingService.applyMetadataBlocksToRoCrate(
            localizedRemoteCrate, inspection.datasetVersionData, selectedCrosswalk)
        : { crate: localizedRemoteCrate, updatedFields: [] }
      const synchronizedCrate = mergeRoCratesForSync(
        this.rewriteCrateEntityIds(localCrate, relocatedLocalIds),
        mappedRemoteResult.crate,
        options.metadataMode,
      )
      await this.fileService.writeFile(
        metadataUri,
        BinaryBuffer.fromString(`${JSON.stringify(synchronizedCrate, null, 2)}\n`),
      )
      await this.saveEntityIdMapping(
        rootUri, exportTarget.exportLogEntry.mappingFile, exportTarget.mapping)
      await this.appendExportLog(rootUri, {
        target,
        repository: baseUrl,
        mappingFile: exportTarget.exportLogEntry.mappingFile,
        crosswalkFile: crosswalkId,
        syncType: 'sync',
        status: 'success',
        lastSuccessfulActionAt: new Date().toISOString(),
        collectionId: exportTarget.exportLogEntry.collectionId,
        datasetName: this.getRootDatasetName(synchronizedCrate),
      })
      return {
        persistentId: exportTarget.persistentId,
        target,
        mappingFileName: exportTarget.exportLogEntry.mappingFile,
        downloadedFileCount: files.filter(file => file.kind === 'new').length,
        replacedFileCount: files.filter(file => file.kind === 'changed').length,
        keptLocalFileCount,
        metadataSource: options.metadataMode,
        updatedMetadataFields: mappedRemoteResult.updatedFields,
      }
    } catch (error) {
      await this.appendExportLog(rootUri, {
        target,
        repository: baseUrl,
        mappingFile: exportTarget.exportLogEntry.mappingFile,
        crosswalkFile: crosswalkId,
        syncType: 'sync',
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        collectionId: exportTarget.exportLogEntry.collectionId,
        datasetName: this.getRootDatasetName(localCrate),
      })
      throw error
    } finally {
      this.activeProviderSyncs.delete(operationId)
    }
  }

  public async handleProviderSyncCheckpoint(
    value: DataverseProviderSyncCheckpoint,
  ): Promise<void> {
    if (!value || value.providerId !== 'dataverse' || typeof value.operationId !== 'string') {
      throw new Error('The Dataverse sync checkpoint is invalid.')
    }
    const active = this.activeProviderSyncs.get(value.operationId)
    if (!active || value.persistentId !== active.plan.persistentId) {
      throw new Error('The Dataverse sync checkpoint no longer has an active sync.')
    }
    const planned = active.plan.files.find(file =>
      file.remoteId === value.file?.remoteId && file.localId === value.file?.localId &&
      file.localPath === value.file?.localPath && file.kind === value.file?.kind)
    if (!planned) {
      throw new Error('The Dataverse downloaded-file checkpoint is inconsistent with the plan.')
    }
    const stat = await this.fileService.resolve(active.rootUri.resolve(planned.localPath))
    if (stat.isDirectory) {
      throw new Error(`Dataverse sync downloaded a directory for '${planned.localPath}'.`)
    }
    await this.fileHashStoreService.recordKnownHash(
      active.rootUri,
      planned.localId,
      stat.mtime,
      stat.size,
      planned.checksum,
    )
    this.removeMappedRemoteFileId(active.mapping, planned.remoteId)
    active.mapping[planned.localId] = planned.remoteId
    await this.saveEntityIdMapping(
      active.rootUri, active.mappingFileName, active.mapping)
    active.checkpointedFiles.add(
      `${planned.kind}\0${planned.remoteId}\0${planned.localId}`)
  }

  public async getDatasetCreationMetadataDefaults(
    crosswalkId?: string,
  ): Promise<NativeDataverseDatasetMetadata> {
    const rootUri = this.getWorkspaceRoot()
    const crate = await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json'))
    const selectedCrosswalk = crosswalkId
      ? await this.readSelectedCrosswalk(crosswalkId)
      : undefined
    if (crosswalkId && !selectedCrosswalk) {
      return {
        title: '',
        authorNames: [],
        contactEmails: [],
        descriptions: [],
        subjects: [],
      }
    }
    const blocks = await this.metadataMappingService.buildMetadataBlocks(
      crate,
      new Set(['citation']),
      selectedCrosswalk,
    )
    return this.datasetCreationMetadataFromCrosswalkBlocks(blocks)
  }

  public requiredDatasetCreationFields(): Set<string> {
    return this.metadataMappingService.requiredFields('citation')
  }

  public datasetCreationSubjectOptions(): string[] {
    return this.metadataMappingService.controlledVocabularyValues('citation', 'subject')
  }

  public datasetCreationFieldLabel(fieldName: string): string {
    switch (fieldName) {
      case 'title':
        return nls.localize('rockit/dataRepository/metadataTitle', 'Title')
      case 'author':
        return nls.localize('rockit/dataRepository/authorName', 'Author Name')
      case 'datasetContact':
        return nls.localize('rockit/dataRepository/contactEmail', 'Point of Contact Email')
      case 'dsDescription':
        return nls.localize('rockit/dataRepository/descriptionText', 'Description Text')
      case 'subject':
        return nls.localize('rockit/dataRepository/subject', 'Subject')
      default:
        return this.metadataMappingService.fieldDisplayName('citation', fieldName)
    }
  }

  protected datasetCreationMetadataFromCrosswalkBlocks(
    blocks: Record<string, { displayName: string; fields: DataverseMetadataField[] }>,
  ): NativeDataverseDatasetMetadata {
    const fields = blocks.citation?.fields ?? []
    return {
      title: this.fieldStrings(fields, 'title')[0] ?? '',
      authorNames: this.fieldStrings(fields, 'author', 'authorName'),
      contactEmails: this.fieldStrings(fields, 'datasetContact', 'datasetContactEmail'),
      descriptions: this.fieldStrings(fields, 'dsDescription', 'dsDescriptionValue'),
      subjects: this.fieldStrings(fields, 'subject'),
    }
  }

  protected fieldStrings(
    fields: DataverseMetadataField[],
    typeName: string,
    childTypeName?: string,
  ): string[] {
    const field = fields.find((candidate) => candidate.typeName === typeName)
    if (!field) {
      return []
    }
    if (!childTypeName) {
      return this.uniqueStrings(this.readStrings(field.value))
    }
    const compoundValues = Array.isArray(field.value) ? field.value : [field.value]
    return this.uniqueStrings(
      compoundValues.flatMap((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return []
        }
        const child = (value as Record<string, DataverseMetadataField>)[childTypeName]
        return child ? this.readStrings(child.value) : []
      }),
    )
  }

    protected getWorkspaceRoot(): URI {
        const roots = this.workspaceService.tryGetRoots();
        const rootUri = roots?.[0]?.resource;
        if (!rootUri) {
            throw new Error(nls.localize('rockit/dataRepository/noWorkspace', 'No workspace is open.'));
        }
        return rootUri;
    }

    protected async readRoCrate(metadataUri: URI): Promise<RoCrate> {
        if (!(await this.fileService.exists(metadataUri))) {
            throw new Error(nls.localize(
                'rockit/dataRepository/metadataFileNotFound',
                'ro-crate-metadata.json was not found in the workspace root.'
            ));
        }
        const content = await this.fileService.readFile(metadataUri);
        try {
            return JSON.parse(content.value.toString()) as RoCrate;
        } catch (error) {
            throw new Error(nls.localize(
                'rockit/dataRepository/parseMetadataFailed',
                'Failed to parse ro-crate-metadata.json: {0}',
                error instanceof Error ? error.message : String(error)
            ));
        }
    }

    protected async buildDatasetCreationPayload(
        datasetMetadata: NativeDataverseDatasetMetadata,
        crate?: RoCrate,
        enabledMetadataBlocks?: Set<string>,
        selectedCrosswalk?: CrosswalkDocument | null
    ): Promise<Record<string, unknown>> {
        const title = datasetMetadata.title.trim();
        const authors = this.uniqueStrings(datasetMetadata.authorNames.map(value => value.trim()));
        const contactEmails = this.uniqueStrings(datasetMetadata.contactEmails.map(value => value.trim()));
        const descriptions = this.uniqueStrings(datasetMetadata.descriptions.map(value => value.trim()));
        const subjects = this.uniqueStrings(datasetMetadata.subjects.map(value => value.trim()));
        const missing: string[] = [];
        const requiredCitationFields = this.metadataMappingService.requiredFields('citation');

        if (requiredCitationFields.has('title') && !title) missing.push(nls.localize('rockit/dataRepository/metadataTitle', 'Title'));
        if (requiredCitationFields.has('author') && !authors.length) missing.push(nls.localize('rockit/dataRepository/authorName', 'Author Name'));
        if (requiredCitationFields.has('datasetContact') && !contactEmails.length) missing.push(nls.localize('rockit/dataRepository/contactEmail', 'Point of Contact Email'));
        if (requiredCitationFields.has('dsDescription') && !descriptions.length) missing.push(nls.localize('rockit/dataRepository/descriptionText', 'Description Text'));
        if (requiredCitationFields.has('subject') && !subjects.length) missing.push(nls.localize('rockit/dataRepository/subject', 'Subject'));

        if (missing.length) {
            throw new Error(nls.localize(
                'rockit/dataRepository/missingRequiredMetadata',
                'Cannot create Dataverse dataset. Missing required metadata: {0}.',
                missing.join(', ')
            ));
        }

    const fields: DataverseMetadataField[] = []
    if (requiredCitationFields.has('title') || title) {
      fields.push(this.primitiveField('title', false, title))
    }
    if (requiredCitationFields.has('author') || authors.length) {
      fields.push(this.compoundField(
          'author',
          authors.map((authorName) => ({
            authorName: this.primitiveField('authorName', false, authorName),
          })),
      ))
    }
    if (requiredCitationFields.has('datasetContact') || contactEmails.length) {
      fields.push(this.compoundField(
          'datasetContact',
          contactEmails.map((datasetContactEmail) => ({
            datasetContactEmail: this.primitiveField(
              'datasetContactEmail',
              false,
              datasetContactEmail,
            ),
          })),
      ))
    }
    if (requiredCitationFields.has('dsDescription') || descriptions.length) {
      fields.push(this.compoundField(
          'dsDescription',
          descriptions.map((dsDescriptionValue) => ({
            dsDescriptionValue: this.primitiveField(
              'dsDescriptionValue',
              false,
              dsDescriptionValue,
            ),
          })),
      ))
    }
    if (requiredCitationFields.has('subject') || subjects.length) {
      fields.push({
          typeName: 'subject',
          typeClass: 'controlledVocabulary',
          multiple: true,
          value: subjects,
      })
    }

    const metadataBlocks: Record<
      string,
      { displayName: string; fields: DataverseMetadataField[] }
    > = {
      citation: {
        displayName: 'Citation Metadata',
        fields,
      },
    }
    if (crate && selectedCrosswalk !== null) {
      const mappedBlocks = await this.buildMappedNativeMetadataBlocks(
        crate,
        enabledMetadataBlocks,
        selectedCrosswalk,
      )
      for (const [blockAlias, block] of Object.entries(mappedBlocks)) {
        metadataBlocks[blockAlias] = this.mergeNativeMetadataBlockFields(
          metadataBlocks[blockAlias],
          block.displayName,
          block.fields,
        )
      }
    }

    const license = crate ? this.dataverseLicense(crate) : undefined
    return {
      datasetVersion: {
        ...(license ? { license } : {}),
        metadataBlocks,
      },
    }
  }

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
      targetsByRepositoryId[repository.id] = Array.from(
        latestByMappingFile.values(),
      ).sort((a, b) => (b.lastSuccessfulActionAt ?? '').localeCompare(a.lastSuccessfulActionAt ?? ''))
    }

    return targetsByRepositoryId
  }

    protected async buildDatasetNativeMetadataUpdatePayload(
        currentData: Record<string, unknown>,
        crate: RoCrate,
        enabledMetadataBlocks?: Set<string>,
        selectedCrosswalk?: CrosswalkDocument | null
    ): Promise<Record<string, unknown> | undefined> {
        if (selectedCrosswalk === null) {
            return undefined;
        }
        const metadataBlocks = currentData.metadataBlocks;
        if (!metadataBlocks || typeof metadataBlocks !== 'object' || Array.isArray(metadataBlocks)) {
            return undefined;
        }

    const updatePayload = { ...currentData }
    delete updatePayload.files
    const updatedMetadataBlocks: Record<string, unknown> = {
      ...(metadataBlocks as Record<string, unknown>),
    }
    const localBlocks = await this.buildMappedNativeMetadataBlocks(
      crate,
      enabledMetadataBlocks,
      selectedCrosswalk,
    )
    for (const [blockAlias, block] of Object.entries(localBlocks)) {
      updatedMetadataBlocks[blockAlias] = this.mergeNativeMetadataBlockFields(
        updatedMetadataBlocks[blockAlias],
        block.displayName,
        block.fields,
      )
    }
    updatePayload.metadataBlocks = updatedMetadataBlocks
    return updatePayload
  }

  protected datasetVersionMetadataBlockAliases(
    datasetVersionData: Record<string, unknown>,
  ): Set<string> | undefined {
    const blocks = datasetVersionData.metadataBlocks
    return blocks && typeof blocks === 'object' && !Array.isArray(blocks)
      ? new Set(Object.keys(blocks))
      : undefined
  }

  protected async buildMappedNativeMetadataBlocks(
    crate: RoCrate,
    enabledMetadataBlocks?: Set<string>,
    crosswalkDocument?: unknown,
  ): Promise<Record<string, { displayName: string; fields: DataverseMetadataField[] }>> {
    return (await this.metadataMappingService.buildMetadataBlocks(
      crate,
      enabledMetadataBlocks,
      crosswalkDocument,
    )) as Record<string, { displayName: string; fields: DataverseMetadataField[] }>
  }

  protected async readSelectedCrosswalk(
    crosswalkId?: string,
  ): Promise<CrosswalkDocument | null> {
    if (!crosswalkId) {
      return null
    }
    const selected = await this.crosswalkRegistry.read(crosswalkId)
    if (!selected) {
      throw new Error(`The selected crosswalk '${crosswalkId}' is no longer registered.`)
    }
    return selected
  }

  protected mergeNativeMetadataBlockFields(
    currentBlock: unknown,
    displayName: string,
    replacementFields: DataverseMetadataField[],
  ): { displayName: string; fields: DataverseMetadataField[] } {
    const current =
      currentBlock && typeof currentBlock === 'object' && !Array.isArray(currentBlock)
        ? (currentBlock as Record<string, unknown>)
        : {}
    const existingFields = Array.isArray(current.fields)
      ? current.fields.filter(
          (field): field is DataverseMetadataField =>
            !!field &&
            typeof field === 'object' &&
            !Array.isArray(field) &&
            typeof (field as DataverseMetadataField).typeName === 'string',
        )
      : []
    const replacementFieldNames = new Set(
      replacementFields.map((field) => field.typeName),
    )
    return {
      displayName: this.readOptionalString(current.displayName) ?? displayName,
      fields: [
        ...existingFields.filter((field) => !replacementFieldNames.has(field.typeName)),
        ...replacementFields,
      ],
    }
  }

  protected async collectRoCrateUploadFiles(
    crate: RoCrate,
    rootUri: URI,
  ): Promise<NativeDataverseUploadCollection> {
    const uploadCrate = JSON.parse(JSON.stringify(crate)) as RoCrate
    this.pruneUnreachableFileEntities(uploadCrate)
    const externalFiles = new Map<string, URI>()
    const uploadEntryPathByEntityId = new Map<string, string>()
    const localizedReferences = await localizeExternalRoCrateFileReferences(uploadCrate, {
      existingEntryPaths: collectRoCrateExportFileReferences(uploadCrate).map(
        (reference) => reference.entryPath,
      ),
      resolveLocalSource: async (sources) => {
        const resolved = await this.resolveFirstReadableFileSource(
          rootUri,
          sources.filter((source) => source.kind === 'local'),
        )
        return resolved ? { source: resolved.source, value: resolved.uri } : undefined
      },
    })
    for (const reference of localizedReferences) {
      externalFiles.set(reference.importedPath, reference.resolvedSource)
      uploadEntryPathByEntityId.set(reference.reference.entityId, reference.importedPath)
    }
    const originalEntityIdByUploadId = new Map(
      localizedReferences.map((reference) => [
        reference.importedPath,
        reference.reference.entityId,
      ]),
    )

    const uploadFiles = new Map<string, NativeDataverseUploadFile>()

    for (const reference of collectRoCrateExportFileReferences(uploadCrate)) {
      uploadEntryPathByEntityId.set(reference.entityId, reference.entryPath)
      const externalUri = externalFiles.get(reference.entryPath)
      const resolved = externalUri
        ? { uri: externalUri }
        : await this.resolveFirstReadableFileSource(rootUri, reference.sources)
      if (!resolved) {
        console.warn(
          'Skipping unresolved RO-Crate file reference during native Dataverse export:',
          reference.entityId,
        )
        continue
      }
      const stat = await this.fileService.resolve(resolved.uri)
      const content = await this.fileService.readFile(resolved.uri)
      uploadFiles.set(reference.entryPath, {
        entryPath: reference.entryPath,
        content: content.value.buffer,
        sourceUri: resolved.uri.toString(),
        localFileId: originalEntityIdByUploadId.get(reference.entityId) ?? reference.entityId,
        lastModified: stat.mtime,
        sourceSize: content.value.buffer.byteLength,
      })
    }

    return {
      files: Array.from(uploadFiles.values()).sort((a, b) =>
        a.entryPath.localeCompare(b.entryPath),
      ),
      metadataCrate: uploadCrate,
      uploadEntryPathByEntityId,
      originalToUploadIds: new Map(
        localizedReferences.map((reference) => [
          reference.reference.entityId,
          reference.importedPath,
        ]),
      ),
    }
  }

    protected collectRemoteDataverseSyncItems(
      remoteMetadataFiles: RoCrateEntity[],
      remoteFileReferences: NativeDataverseRemoteFileReference[],
      remoteToLocalMapping: RoCrateEntityIdMapping,
      preferRemotePath = false,
    ): Array<{
      remoteId: string
      localId: string
      localPath: string
      checksum?: string
      remoteSize?: number
      remoteEntity: RoCrateEntity
    }> {
      const remoteEntitiesById = new Map(
        remoteMetadataFiles.map(entity => [this.requireEntityId(entity), entity]),
      )
      const items = new Map<string, {
        remoteId: string
        localId: string
        localPath: string
        checksum?: string
        remoteSize?: number
        remoteEntity: RoCrateEntity
      }>()

      for (const entity of remoteMetadataFiles) {
        const remoteId = this.requireEntityId(entity)
        const reference = this.findRemoteFileReference(remoteFileReferences, remoteId, entity)
        const remotePath =
          (reference ? this.localPathFromRemoteFileReference(reference) : undefined) ??
          this.localPathFromRemoteFileEntity(entity)
        const mappedPath = remoteToLocalMapping[remoteId]
          ? this.localCratePathFromEntityId(remoteToLocalMapping[remoteId])
          : undefined
        const localPath =
          (preferRemotePath ? remotePath ?? mappedPath : mappedPath ?? remotePath) ??
          this.localCratePathFromEntityId(remoteId)
        const localId = remoteToLocalMapping[remoteId] ?? localPath ?? remoteId
        const dataFileId = reference?.remoteId ?? (/^\d+$/.test(remoteId) ? remoteId : undefined)
        if (localPath && dataFileId) {
          items.set(dataFileId, {
            remoteId: dataFileId,
            localId,
            localPath,
            checksum: reference?.md5 ?? this.fileEntityHash(entity),
            remoteSize: reference?.size ?? this.fileEntitySize(entity),
            remoteEntity: entity,
          })
        }
      }

      for (const reference of remoteFileReferences) {
        if (reference.label === 'ro-crate-metadata.json') {
          continue
        }
        if (items.has(reference.remoteId)) {
          continue
        }
        const localPath = this.localPathFromRemoteFileReference(reference)
        const localId = remoteToLocalMapping[reference.remoteId] ?? localPath
        if (!localPath) {
          continue
        }
        items.set(reference.remoteId, {
          remoteId: reference.remoteId,
          localId,
          localPath,
          checksum: reference.md5,
          remoteSize: reference.size,
          remoteEntity: remoteEntitiesById.get(reference.remoteId) ?? {
            '@id': reference.remoteId,
            '@type': 'File',
            name: reference.label,
            directoryLabel: reference.directoryLabel,
            hash: reference.md5,
            contentSize: reference.size,
          },
        })
      }

      return Array.from(items.values()).sort((a, b) => a.localPath.localeCompare(b.localPath))
    }

    protected findRemoteFileReference(
      references: NativeDataverseRemoteFileReference[],
      remoteId: string,
      entity: RoCrateEntity,
    ): NativeDataverseRemoteFileReference | undefined {
      const entityPath = this.localPathFromRemoteFileEntity(entity)
      return references.find(reference => reference.remoteId === remoteId)
        ?? references.find(reference => entityPath === this.localPathFromRemoteFileReference(reference))
    }

    protected localPathFromRemoteFileEntity(entity: RoCrateEntity): string | undefined {
      const idPath = this.localCratePathFromEntityId(this.requireEntityId(entity))
      if (idPath) {
        return idPath
      }
      const label = this.readOptionalString(entity.name)
      if (!label) {
        return undefined
      }
      const directory = this.normalizeDirectoryLabel(this.readOptionalString(entity.directoryLabel) ?? '')
      const path = directory ? `${directory}/${label}` : label
      return this.isSafeRelativePath(path) ? path : undefined
    }

    protected localPathFromRemoteFileReference(
      reference: NativeDataverseRemoteFileReference,
    ): string | undefined {
      if (!reference.label) {
        return undefined
      }
      const directory = this.normalizeDirectoryLabel(reference.directoryLabel)
      const path = directory ? `${directory}/${reference.label}` : reference.label
      return this.isSafeRelativePath(path) ? path : undefined
    }

    protected rewriteCrateEntityIds(crate: RoCrate, mapping: RoCrateEntityIdMapping): RoCrate {
      const rewrittenCrate = JSON.parse(JSON.stringify(crate)) as RoCrate
      this.rewriteMappedEntityIdReferences(rewrittenCrate, mapping)
      return rewrittenCrate
    }

    protected requireUploadFile(
        entityId: string,
        uploadCollection: NativeDataverseUploadCollection,
        uploadFilesByPath: Map<string, NativeDataverseUploadFile>
    ): NativeDataverseUploadFile {
        const entryPath = uploadCollection.uploadEntryPathByEntityId.get(entityId)
            ?? this.localCratePathFromEntityId(entityId);
        const uploadFile = entryPath ? uploadFilesByPath.get(entryPath) : undefined;
        if (!uploadFile) {
            throw new Error(nls.localize(
                'rockit/dataRepository/uploadContentUnavailable',
                "Cannot resolve local upload content for File entity '{0}'.",
                entityId
            ));
        }
        return uploadFile;
    }

  protected async persistUploadedFileHash(
    rootUri: URI,
    localCrate: RoCrate,
    localEntityId: string,
    uploadCrate: RoCrate,
    uploadEntityId: string,
    md5: string | undefined,
    saveImmediately = true,
  ): Promise<boolean> {
    if (!md5) {
      return false
    }

    const appStateCrate = this.appStateService.roCrate ?? localCrate
    const nextAppStateCrate = JSON.parse(JSON.stringify(appStateCrate)) as RoCrate
    const appStateEntity = this.findEntity(nextAppStateCrate, localEntityId)
    const localEntity = this.findEntity(localCrate, localEntityId)
    const uploadEntity = this.findEntity(uploadCrate, uploadEntityId)
    if (!appStateEntity || !localEntity || !uploadEntity) {
      throw new Error(nls.localize(
        'rockit/dataRepository/uploadedFileHashEntityMissing',
        "The uploaded file hash could not be saved because File entity '{0}' was not found in the RO-Crate metadata.",
        localEntityId,
      ))
    }

    appStateEntity.hash = md5
    localEntity.hash = md5
    uploadEntity.hash = md5
    this.ensureFileHashContext(nextAppStateCrate)
    this.ensureFileHashContext(localCrate)
    this.ensureFileHashContext(uploadCrate)
    this.appStateService.roCrate = nextAppStateCrate
    if (saveImmediately) {
      await this.roCratePersistenceService.write(rootUri, nextAppStateCrate)
    }
    return true
  }

  protected findEntity(crate: RoCrate, entityId: string): RoCrateEntity | undefined {
    return this.readGraph(crate).find(
      (entity) => this.readOptionalString(entity['@id']) === entityId,
    )
  }

  protected ensureFileHashContext(crate: RoCrate): void {
    const context = crate['@context']
    if (Array.isArray(context)) {
      const existingObject = context.find(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object' && !Array.isArray(item),
      )
      if (existingObject) {
        existingObject.hash = FILE_HASH_CONTEXT
      } else {
        context.push({ hash: FILE_HASH_CONTEXT })
      }
      return
    }
    if (context && typeof context === 'object') {
      const contextObject = context as Record<string, unknown>
      contextObject.hash = FILE_HASH_CONTEXT
      return
    }
    crate['@context'] = context
      ? [context, { hash: FILE_HASH_CONTEXT }]
      : ['https://w3id.org/ro/crate/1.1/context', { hash: FILE_HASH_CONTEXT }]
  }

  protected buildEntityIdMapping(
    crate: RoCrate,
    uploadedFiles: NativeDataverseFileUploadResult[],
    uploadEntryPathByEntityId = new Map<string, string>(),
  ): RoCrateEntityIdMapping {
    const remoteFileMapping = this.buildRemoteFileMapping(
      crate,
      uploadedFiles,
      uploadEntryPathByEntityId,
    )
    const mapping: RoCrateEntityIdMapping = {}
    for (const entity of this.readGraph(crate)) {
      if (!this.shouldPersistEntityMapping(entity)) {
        continue
      }
      const entityId = this.requireEntityId(entity)
      mapping[entityId] = remoteFileMapping.get(entityId)?.remoteId ?? ''
    }
    return Object.fromEntries(
      Object.entries(mapping).sort((a, b) => a[0].localeCompare(b[0])),
    )
  }

  protected buildRemoteFileMapping(
    crate: RoCrate,
    uploadedFiles: NativeDataverseFileUploadResult[],
    uploadEntryPathByEntityId = new Map<string, string>(),
  ): Map<string, NativeDataverseRemoteFileReference> {
    const remoteFilesByHashAndDirectory =
      this.groupRemoteFilesByHashAndDirectory(uploadedFiles)
    const remoteFilesBySignature = this.groupRemoteFilesBySignature(uploadedFiles)
    const mapping = new Map<string, NativeDataverseRemoteFileReference>()
    for (const uploadedFile of uploadedFiles) {
      if (!uploadedFile.localFileId) {
        continue
      }
      const remoteId = this.extractDataFileId(uploadedFile.response)
      if (remoteId) {
        mapping.set(uploadedFile.localFileId, {
          md5: this.fileHashStoreService.extractMd5(uploadedFile.response) ?? '',
          directoryLabel: uploadedFile.directoryLabel ?? '',
          label: uploadedFile.fileName,
          remoteId,
        })
      }
    }
    for (const entity of this.readGraph(crate)) {
      if (!this.shouldPersistEntityMapping(entity)) {
        continue
      }
      const entityId = this.requireEntityId(entity)
      if (mapping.has(entityId)) {
        continue
      }
      const hashAndDirectorySignature = this.fileEntityHashAndDirectorySignature(
        entity,
        uploadEntryPathByEntityId,
      )
      const hashDirectoryMatches = hashAndDirectorySignature
        ? (remoteFilesByHashAndDirectory.get(hashAndDirectorySignature) ?? [])
        : []
      const sourceSignature = this.fileEntityMappingSignature(
        entity,
        uploadEntryPathByEntityId,
      )
      const signatureMatches = sourceSignature
        ? (remoteFilesBySignature.get(sourceSignature) ?? [])
        : []
      const matches =
        hashDirectoryMatches.length > 1 ? signatureMatches : hashDirectoryMatches
      if (this.entityTypes(entity).includes('File') && matches.length === 1) {
        mapping.set(entityId, matches[0])
      }
    }
    return mapping
  }

  protected fileEntityHashAndDirectorySignature(
    entity: RoCrateEntity,
    uploadEntryPathByEntityId: Map<string, string>,
  ): string | undefined {
    const hash = this.fileEntityHash(entity)
    if (!hash) {
      return undefined
    }
    return this.fileHashAndDirectorySignature(
      hash,
      this.sourceFileDirectoryLabel(entity, uploadEntryPathByEntityId),
    )
  }

  protected fileEntityMappingSignature(
    entity: RoCrateEntity,
    uploadEntryPathByEntityId: Map<string, string>,
  ): string | undefined {
    const hash = this.fileEntityHash(entity)
    if (!hash) {
      return undefined
    }
    return this.fileMappingSignature(
      hash,
      this.sourceFileDirectoryLabel(entity, uploadEntryPathByEntityId),
      this.sourceFileLabel(entity, uploadEntryPathByEntityId),
    )
  }

  protected sourceFileDirectoryLabel(
    entity: RoCrateEntity,
    uploadEntryPathByEntityId: Map<string, string>,
  ): string {
    const uploadEntryPath = uploadEntryPathByEntityId.get(this.requireEntityId(entity))
    if (uploadEntryPath) {
      return this.parsePosixPath(uploadEntryPath).dir
    }
    const idPath = this.localCratePathFromEntityId(this.requireEntityId(entity))
    if (idPath) {
      return this.parsePosixPath(idPath).dir
    }
    return this.readOptionalString(entity.directoryLabel) ?? ''
  }

  protected sourceFileLabel(
    entity: RoCrateEntity,
    uploadEntryPathByEntityId: Map<string, string>,
  ): string {
    const uploadEntryPath = uploadEntryPathByEntityId.get(this.requireEntityId(entity))
    if (uploadEntryPath) {
      return this.parsePosixPath(uploadEntryPath).base
    }
    const idPath = this.localCratePathFromEntityId(this.requireEntityId(entity))
    if (idPath) {
      return this.parsePosixPath(idPath).base
    }
    return this.readOptionalString(entity.name) ?? ''
  }

  protected fileEntityHash(entity: RoCrateEntity): string | undefined {
    return this.readOptionalString(entity.hash)?.toLowerCase().replace(/^md5:/, '')
  }

  protected fileEntitySize(entity: RoCrateEntity): number | undefined {
    const value = this.readOptionalString(entity.contentSize)
    if (!value) {
      return undefined
    }
    const size = Number(value)
    return Number.isFinite(size) ? size : undefined
  }

  protected fileHashAndDirectorySignature(
    md5: string,
    directoryLabel: string | undefined,
  ): string {
    return `${md5.toLowerCase().replace(/^md5:/, '')}\0${this.normalizeDirectoryLabel(directoryLabel ?? '')}`
  }

  protected fileMappingSignature(
    md5: string,
    directoryLabel: string | undefined,
    label: string | undefined,
  ): string {
    return `${this.fileHashAndDirectorySignature(md5, directoryLabel)}\0${label ?? ''}`
  }

  protected normalizeDirectoryLabel(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  }

  protected groupRemoteFilesByHashAndDirectory(
    uploadedFiles: NativeDataverseFileUploadResult[],
  ): Map<string, NativeDataverseRemoteFileReference[]> {
    const remoteFilesBySignature = new Map<string, NativeDataverseRemoteFileReference[]>()
    for (const file of uploadedFiles) {
      for (const reference of this.extractRemoteFileReferences(file.response)) {
        const signature = this.fileHashAndDirectorySignature(
          reference.md5,
          reference.directoryLabel,
        )
        remoteFilesBySignature.set(signature, [
          ...(remoteFilesBySignature.get(signature) ?? []),
          reference,
        ])
      }
    }
    return remoteFilesBySignature
  }

  protected groupRemoteFilesBySignature(
    uploadedFiles: NativeDataverseFileUploadResult[],
  ): Map<string, NativeDataverseRemoteFileReference[]> {
    const remoteFilesBySignature = new Map<string, NativeDataverseRemoteFileReference[]>()
    for (const file of uploadedFiles) {
      for (const reference of this.extractRemoteFileReferences(file.response)) {
        const signature = this.fileMappingSignature(
          reference.md5,
          reference.directoryLabel,
          reference.label,
        )
        remoteFilesBySignature.set(signature, [
          ...(remoteFilesBySignature.get(signature) ?? []),
          reference,
        ])
      }
    }
    return remoteFilesBySignature
  }

  protected extractRemoteFileReferences(
    value: unknown,
  ): NativeDataverseRemoteFileReference[] {
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.extractRemoteFileReferences(item))
    }
    if (!value || typeof value !== 'object') {
      return []
    }
    const record = value as Record<string, unknown>
    const dataFile = record.dataFile
    if (dataFile && typeof dataFile === 'object' && !Array.isArray(dataFile)) {
      const dataFileRecord = dataFile as Record<string, unknown>
      const md5 = this.extractMd5(dataFileRecord)
      const sizeValue = this.readOptionalString(
        dataFileRecord.filesize ?? dataFileRecord.contentSize,
      )
      const size = sizeValue === undefined ? undefined : Number(sizeValue)
      const remoteId =
        this.readOptionalString(dataFileRecord.id) ??
        this.buildPidTarget(this.extractPersistentId(dataFileRecord))
      const directoryLabel =
        this.readOptionalString(dataFileRecord.directoryLabel) ??
        this.readOptionalString(record.directoryLabel) ??
        ''
      const label =
        this.readOptionalString(record.label) ??
        this.readOptionalString(dataFileRecord.filename) ??
        ''
      if (md5 && remoteId) {
        return [
          {
            md5,
            size: size !== undefined && Number.isFinite(size) ? size : undefined,
            directoryLabel: this.normalizeDirectoryLabel(directoryLabel),
            label,
            remoteId,
          },
        ]
      }
    }
    return Object.values(record).flatMap((child) =>
      this.extractRemoteFileReferences(child),
    )
  }

  protected extractMd5(record: Record<string, unknown>): string | undefined {
    const md5 = this.readOptionalString(record.md5)
    if (md5) {
      return md5.toLowerCase().replace(/^md5:/, '')
    }
    const checksum = record.checksum
    if (checksum && typeof checksum === 'object' && !Array.isArray(checksum)) {
      const checksumRecord = checksum as Record<string, unknown>
      const type = this.readOptionalString(checksumRecord.type)?.toLowerCase()
      const value = this.readOptionalString(checksumRecord.value)
      if (type === 'md5' && value) {
        return value.toLowerCase().replace(/^md5:/, '')
      }
    }
    return undefined
  }

  protected extractDataFileId(value: unknown): string | undefined {
    if (Array.isArray(value)) {
      return value
        .map((item) => this.extractDataFileId(item))
        .find((item): item is string => !!item)
    }
    if (!value || typeof value !== 'object') {
      return undefined
    }
    const record = value as Record<string, unknown>
    const dataFile = record.dataFile
    if (dataFile && typeof dataFile === 'object' && !Array.isArray(dataFile)) {
      const id = this.readOptionalString((dataFile as Record<string, unknown>).id)
      if (id) {
        return id
      }
    }
    return Object.values(record)
      .map((child) => this.extractDataFileId(child))
      .find((item): item is string => !!item)
  }

  protected shouldPersistEntityMapping(entity: RoCrateEntity): boolean {
    const id = this.requireEntityId(entity)
    const types = this.entityTypes(entity)
    return id !== './' && types.includes('File')
  }

  protected rewriteMappedEntityIdReferences(
    value: unknown,
    mapping: RoCrateEntityIdMapping,
  ): void {
    if (Array.isArray(value)) {
      for (const item of value) {
        this.rewriteMappedEntityIdReferences(item, mapping)
      }
      return
    }
    if (!value || typeof value !== 'object') {
      return
    }
    const record = value as Record<string, unknown>
    for (const [key, child] of Object.entries(record)) {
      if (key === '@id' && typeof child === 'string' && mapping[child]) {
        record[key] = mapping[child]
        continue
      }
      this.rewriteMappedEntityIdReferences(child, mapping)
    }
  }

    protected requireEntityId(entity: RoCrateEntity): string {
        const id = this.readStrings(entity['@id'])[0];
        if (!id) {
            throw new Error(nls.localize(
                'rockit/dataRepository/entityMappingMissingId',
                'Dataverse dataset created, but an entity mapping file could not be created. An RO-Crate entity has no @id.'
            ));
        }
        return id;
    }

  protected readOptionalString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed ? trimmed : undefined
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
    return undefined
  }

  protected extractPersistentId(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') {
      return undefined
    }
    if (Array.isArray(value)) {
      return value
        .map((item) => this.extractPersistentId(item))
        .find((item): item is string => !!item)
    }
    const record = value as Record<string, unknown>
    for (const key of ['persistentId', 'global_id', 'globalId', 'pid']) {
      const raw = record[key]
      if (typeof raw === 'string' && raw.trim()) {
        return raw.trim()
      }
    }
    for (const child of Object.values(record)) {
      const nested = this.extractPersistentId(child)
      if (nested) {
        return nested
      }
    }
    return undefined
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

  protected async resolveExistingExportTarget(
    rootUri: URI,
    repository: DataRepositoryConfig,
    selectedTarget?: DataRepositoryExportTarget,
  ): Promise<NativeDataverseExportTarget | undefined> {
    const entries = await this.readExportLogEntries(
      rootUri.resolve('.rockit').resolve(EXPORT_LOG_FILE_NAME),
    )
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const matchingEntries = [...entries]
      .reverse()
      .filter(
        (candidate) =>
          this.normalizeBaseUrl(candidate.repository) === baseUrl &&
          !!this.extractPidFromTarget(candidate.target),
      )
    const selectedEntry = selectedTarget
      ? matchingEntries.find(
          (candidate) =>
            candidate.mappingFile === selectedTarget.mappingFile &&
            this.normalizePid(this.extractPidFromTarget(candidate.target)) ===
              this.normalizePid(selectedTarget.pid),
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
          }
        : undefined
    const entry = selectedEntry ?? selectedFallbackEntry ?? matchingEntries[0]
    if (!entry) {
      return undefined
    }
    const persistentId = this.extractPidFromTarget(entry.target)
    const mapping = await this.readEntityIdMapping(
      rootUri.resolve('.rockit').resolve(entry.mappingFile),
    )
    if (!persistentId || !mapping) {
      return undefined
    }
    return {
      persistentId,
      exportLogEntry: entry,
      mapping,
    }
  }

  protected extractDraftFileRecords(value: unknown): NativeDataverseDraftFileRecord[] {
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.extractDraftFileRecords(item))
    }
    if (!value || typeof value !== 'object') {
      return []
    }
    const record = value as Record<string, unknown>
    const dataFile = record.dataFile
    if (dataFile && typeof dataFile === 'object' && !Array.isArray(dataFile)) {
      const dataFileRecord = dataFile as Record<string, unknown>
      const id = this.readOptionalString(dataFileRecord.id)
      const label =
        this.readOptionalString(record.label) ??
        this.readOptionalString(dataFileRecord.filename)
      if (id && label) {
        const sizeValue = this.readOptionalString(
          dataFileRecord.filesize ?? dataFileRecord.contentSize,
        )
        const size = sizeValue === undefined ? undefined : Number(sizeValue)
        return [
          {
            id,
            label,
            persistentId: this.extractPersistentId(dataFileRecord),
            md5: this.extractMd5(dataFileRecord),
            size: size !== undefined && Number.isFinite(size) ? size : undefined,
          },
        ]
      }
    }
    return Object.values(record).flatMap((child) => this.extractDraftFileRecords(child))
  }

  protected normalizeMappingToDatabaseIds(
    mapping: RoCrateEntityIdMapping,
    files: NativeDataverseDraftFileRecord[],
  ): void {
    for (const [localId, remoteId] of Object.entries(mapping)) {
      if (/^\d+$/.test(remoteId)) {
        continue
      }
      const match = files.find(
        (file) =>
          file.persistentId === remoteId ||
          this.buildPidTarget(file.persistentId) === remoteId,
      )
      if (match) {
        mapping[localId] = match.id
      }
    }
  }

  protected normalizeLocalizedMappingKeys(
    mapping: RoCrateEntityIdMapping,
    originalToUploadIds: Map<string, string>,
  ): void {
    for (const [originalId, uploadId] of originalToUploadIds) {
      if (!mapping[originalId] && mapping[uploadId]) {
        mapping[originalId] = mapping[uploadId]
      }
      delete mapping[uploadId]
    }
  }

  protected removeMappedRemoteFileId(
    mapping: RoCrateEntityIdMapping,
    remoteFileId: string,
  ): void {
    for (const [localId, mappedRemoteId] of Object.entries(mapping)) {
      if (mappedRemoteId === remoteFileId) {
        delete mapping[localId]
      }
    }
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
      console.warn('Failed to parse native Dataverse mapping file.', error)
      return undefined
    }
  }

  protected async appendExportLog(rootUri: URI, entry: ExportLogEntry): Promise<void> {
    const rockitUri = rootUri.resolve('.rockit')
    if (!(await this.fileService.exists(rockitUri))) {
      await this.fileService.createFolder(rockitUri)
    }
    const logUri = rockitUri.resolve(EXPORT_LOG_FILE_NAME)
    const entries = await this.readExportLogEntries(logUri)
    const nextEntries = appendExportLogEvent(entries, entry)
    await this.fileService.writeFile(
      logUri,
      BinaryBuffer.fromString(
        `${JSON.stringify(serializeExportLogEntries(nextEntries), null, 2)}\n`,
      ),
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

  protected async readExportLogEntries(logUri: URI): Promise<ExportLogEntry[]> {
    if (!(await this.fileService.exists(logUri))) {
      return []
    }
    try {
      const parsed = JSON.parse(
        (await this.fileService.readFile(logUri)).value.toString(),
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

  protected buildPidTarget(pid?: string): string | undefined {
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

  protected buildDataverseDatasetUrl(baseUrl: string, pid?: string): string | undefined {
    if (!pid) {
      return undefined
    }
    const target = this.buildPidTarget(pid)
    if (!target) {
      return undefined
    }
    if (/^https?:\/\//i.test(target)) {
      return target
    }
    return `${baseUrl}/dataset.xhtml?persistentId=${encodeURIComponent(target)}`
  }

  protected extractPidFromTarget(target: string): string | undefined {
    const trimmed = target.trim()
    if (/^(hdl|doi):/i.test(trimmed)) {
      return trimmed
    }
    try {
      const url = new URL(trimmed)
      const path = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      if (url.hostname.toLowerCase() === 'hdl.handle.net' && path) {
        return `hdl:${path}`
      }
      if (url.hostname.toLowerCase() === 'doi.org' && path) {
        return `doi:${path}`
      }
      const persistentId = url.searchParams.get('persistentId')
      return persistentId?.trim() || undefined
    } catch {
      return undefined
    }
  }

  protected normalizePid(value: string | undefined): string | undefined {
    return value
      ?.trim()
      .replace(/^persistentId=/i, '')
      .toLowerCase()
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

  protected randomId(length: number): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const bytes = new Uint8Array(length)
    window.crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
  }

  protected async resolveFirstReadableFileSource(
    rootUri: URI,
    sources: readonly RoCrateExportFileSource[],
  ): Promise<{ uri: URI; source: RoCrateExportFileSource } | undefined> {
    for (const source of sources) {
      const uri =
        source.kind === 'local'
          ? this.toLocalFileUri(source.value)
          : rootUri.resolve(source.value)
      if (!uri) {
        continue
      }
      try {
        if (!(await this.fileService.exists(uri))) {
          continue
        }
        const stat = await this.fileService.resolve(uri)
        if (!stat.isDirectory) {
          return { uri, source }
        }
      } catch (error) {
        console.warn('Failed to resolve RO-Crate file reference:', source.value, error)
      }
    }
    return undefined
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

  protected entityTypes(entity: RoCrateEntity): string[] {
    return this.readStrings(entity['@type'])
  }

  protected localCratePathFromEntityId(id: string): string | undefined {
    if (!id || id === './' || id.startsWith('#')) {
      return undefined
    }
    let relativePath = id
    if (id.startsWith('file://./')) {
      relativePath = id.slice('file://./'.length)
    } else if (id.startsWith('./')) {
      relativePath = id.slice(2)
    } else if (id.includes(':')) {
      return undefined
    }
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
    return normalized && !normalized.split('/').includes('..') ? normalized : undefined
  }

  protected findLocalEntityIdForPath(crate: RoCrate, path: string): string | undefined {
    const normalizedPath = this.normalizeDirectoryLabel(path)
    return this.readGraph(crate)
      .map((entity) => this.requireEntityId(entity))
      .find((entityId) =>
        this.normalizeDirectoryLabel(this.localCratePathFromEntityId(entityId) ?? '') === normalizedPath,
      )
  }

  protected isSafeRelativePath(value: string): boolean {
    const normalized = value.replace(/\\/g, '/').trim()
    return !!normalized &&
      !normalized.startsWith('/') &&
      !/^[a-zA-Z]:\//.test(normalized) &&
      !normalized.split('/').some(part => !part || part === '.' || part === '..')
  }

  protected isInsideRoot(rootUri: URI, resourceUri: URI): boolean {
    const rootPath = rootUri.path.toString().replace(/\/+$/, '')
    const resourcePath = resourceUri.path.toString()
    return resourcePath === rootPath || resourcePath.startsWith(`${rootPath}/`)
  }

  protected parsePosixPath(value: string): { dir: string; base: string } {
    const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
    const index = normalized.lastIndexOf('/')
    return index === -1
      ? { dir: '', base: normalized }
      : { dir: normalized.slice(0, index), base: normalized.slice(index + 1) }
  }

  protected getRootDatasetName(crate: RoCrate): string | undefined {
    const root = this.readGraph(crate).find((entity) => entity['@id'] === './')
    return root ? this.firstMeaningfulString(root.title, root.name) : undefined
  }

  protected async tryReadCurrentRootDatasetName(
    rootUri: URI,
  ): Promise<string | undefined> {
    try {
      return this.getRootDatasetName(
        await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json')),
      )
    } catch {
      return undefined
    }
  }

  protected readGraph(crate: RoCrate): RoCrateEntity[] {
    const graph = crate['@graph']
    return Array.isArray(graph)
      ? graph.filter(
          (entity): entity is RoCrateEntity =>
            !!entity && typeof entity === 'object' && !Array.isArray(entity),
        )
      : []
  }

  protected dataverseLicense(crate: RoCrate): { name: string; uri: string } | undefined {
    const graph = this.readGraph(crate)
    const root = graph.find((entity) => entity['@id'] === './')
    if (!root) {
      return undefined
    }
    const raw = Array.isArray(root.license) ? root.license[0] : root.license
    const referencedId = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? this.readStrings((raw as RoCrateEntity)['@id'])[0]
      : undefined
    const licenseEntity = referencedId
      ? graph.find((entity) => entity['@id'] === referencedId)
      : undefined
    const uri = this.firstMeaningfulString(
      referencedId,
      typeof raw === 'string' ? raw : undefined,
      licenseEntity?.url,
    )
    if (!uri || !/^https?:\/\//i.test(uri)) {
      return undefined
    }
    const normalized = uri
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '')
      .toLowerCase()
    const knownNames: Record<string, string> = {
      'creativecommons.org/publicdomain/zero/1.0': 'CC0 1.0',
      'creativecommons.org/licenses/by/4.0': 'CC BY 4.0',
      'creativecommons.org/licenses/by-sa/4.0': 'CC BY-SA 4.0',
      'creativecommons.org/licenses/by-nc/4.0': 'CC BY-NC 4.0',
      'creativecommons.org/licenses/by-nc-sa/4.0': 'CC BY-NC-SA 4.0',
      'creativecommons.org/licenses/by-nd/4.0': 'CC BY-ND 4.0',
      'creativecommons.org/licenses/by-nc-nd/4.0': 'CC BY-NC-ND 4.0',
    }
    const name = this.firstMeaningfulString(licenseEntity?.name, knownNames[normalized])
    return name ? { name, uri } : undefined
  }

  protected pruneUnreachableFileEntities(crate: RoCrate): void {
    const graph = crate['@graph']
    if (!Array.isArray(graph)) {
      return
    }
    const reachableIds = this.collectReachableEntityIds(crate)
    crate['@graph'] = graph.filter(
      (entity) =>
        !entity ||
        typeof entity !== 'object' ||
        Array.isArray(entity) ||
        !this.entityTypes(entity as RoCrateEntity).includes('File') ||
        reachableIds.has(this.requireEntityId(entity as RoCrateEntity)),
    )
  }

  protected collectReachableEntityIds(crate: RoCrate): Set<string> {
    const graph = this.readGraph(crate)
    const entitiesById = new Map(
      graph.map((entity) => [this.requireEntityId(entity), entity]),
    )
    const reachableIds = new Set<string>()
    const visit = (id: string) => {
      if (reachableIds.has(id)) {
        return
      }
      const entity = entitiesById.get(id)
      if (!entity) {
        return
      }
      reachableIds.add(id)
      for (const childId of this.readEntityReferenceIds(entity.hasPart)) {
        visit(childId)
      }
    }
    visit('./')
    return reachableIds
  }

  protected readEntityReferenceIds(value: unknown): string[] {
    if (Array.isArray(value)) {
      return this.uniqueStrings(
        value.flatMap((item) => this.readEntityReferenceIds(item)),
      )
    }
    if (value && typeof value === 'object') {
      return this.readStrings((value as RoCrateEntity)['@id'])
    }
    return this.readStrings(value)
  }

  protected primitiveField(
    typeName: string,
    multiple: boolean,
    value: unknown,
  ): DataverseMetadataField {
    return { typeName, typeClass: 'primitive', multiple, value }
  }

  protected compoundField(
    typeName: string,
    values: Array<Record<string, DataverseMetadataField>>,
  ): DataverseMetadataField {
    return {
      typeName,
      typeClass: 'compound',
      multiple: true,
      value: values,
    }
  }

  protected firstMeaningfulString(...values: unknown[]): string | undefined {
    return values
      .flatMap((value) => this.readStrings(value))
      .find((value) => value !== './' && value !== '.')
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

    protected normalizeBaseUrl(baseUrl: string): string {
        const normalized = baseUrl.trim().replace(/\/+$/, '');
        if (!normalized) {
            throw new Error(nls.localize(
                'rockit/dataRepository/emptyRepositoryBaseUrl',
                'Repository base URL is empty.'
            ));
        }
        return normalized.endsWith('/api/v1') ? normalized.slice(0, -'/api/v1'.length) : normalized;
    }

  protected async readResponsePayload(
    response: Response,
  ): Promise<NativeDataverseResponse> {
    const text = await response.text()
    if (!text) {
      return {}
    }
    try {
      return JSON.parse(text) as NativeDataverseResponse
    } catch {
      return { message: text }
    }
  }

  protected payloadSummary(payload: NativeDataverseResponse): string {
    return payload.message || JSON.stringify(payload).slice(0, 500)
  }
}

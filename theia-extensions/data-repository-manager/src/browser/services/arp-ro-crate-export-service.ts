import JSZip = require('jszip')

import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import { FileUri } from '@theia/core/lib/common/file-uri'
import { URI } from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import {
  localizeExternalRoCrateFileReferences,
  RoCrateExportFileSource,
} from 'rockit-common/lib/common/ro-crate-export-file-references'
import { inject, injectable } from 'inversify'
import { DataRepositoryConfig, DataRepositoryExportTarget, DataverseCollection } from '../types'

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

interface ArpUpdateUploadFile {
  entryPath: string
  content: Uint8Array
}

interface ExportLogEntry {
  target: string
  repository: string
  mappingFile: string
  syncType: 'create' | 'update'
  syncedAt: string
  datasetName?: string
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

export interface ArpRoCrateUpdateProgress {
  completedSteps: number
  totalSteps: number
  message: string
}

export type ArpRoCrateUpdateProgressReporter = (update: ArpRoCrateUpdateProgress) => void

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

@injectable()
export class ArpRoCrateExportService {
  constructor(
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
    @inject(FileService) protected readonly fileService: FileService,
  ) {}

  public async exportToArp(
    repository: DataRepositoryConfig,
    collection: DataverseCollection,
  ): Promise<ArpRoCrateExportResult> {
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const rootUri = this.getWorkspaceRoot()
    const metadataUri = rootUri.resolve('ro-crate-metadata.json')
    const crate = await this.readRoCrate(metadataUri)

    const uploadCrate = await this.buildDataverseUploadCrate(crate, rootUri)
    this.removeRootArpPid(uploadCrate)
    const localizedExternalFiles = await this.localizeExternalLocalFileReferences(
      uploadCrate,
      rootUri,
    )
    await this.validateRoCrate(uploadCrate, baseUrl, repository.apiKey)

    const zip = await this.buildDataverseUploadZip(
      uploadCrate,
      rootUri,
      localizedExternalFiles.entries,
    )
    const uploadUrl = new URL('/api/arp/uploadRoCrateZip', `${baseUrl}/`)
    uploadUrl.searchParams.set('ownerId', collection.alias || collection.id)

    const form = new FormData()
    form.append('file', new Blob([zip], { type: 'application/zip' }), 'rocrate.zip')

    const headers: Record<string, string> = { accept: 'application/json' }
    if (repository.apiKey) {
      headers['x-dataverse-key'] = repository.apiKey
    }

    const response = await this.fetchWithTimeout(uploadUrl.toString(), {
      method: 'POST',
      headers,
      body: form,
    })
    const payload = await this.readResponsePayload(response)
    if (!response.ok) {
      throw new Error(
        `ARP upload failed (${response.status}) at ${response.url || uploadUrl.toString()}: ${this.payloadSummary(payload)}`,
      )
    }

    const ingestedCrate = this.extractDataverseCrate(payload)
    const payloadPid = this.extractPayloadPid(payload)
    const pid =
      (ingestedCrate ? this.extractArpPid(ingestedCrate) : undefined) || payloadPid
    if (!ingestedCrate) {
      throw new Error(
        'ARP upload completed, but the response did not contain the ingested RO-Crate needed to create an entity mapping file.',
      )
    }
    if (!pid) {
      throw new Error(
        'ARP upload completed, but the response did not contain the Dataset PID needed to preserve the uploaded RO-Crate relationships.',
      )
    }
    const uploadIdMapping = this.buildEntityIdMapping(uploadCrate, ingestedCrate)
    const metadataIdMapping = this.toMetadataEntityIdMapping(
      crate,
      uploadIdMapping,
      localizedExternalFiles.originalToUploadIds,
    )
    const mappingFileName = await this.createUniqueMappingFileName(rootUri)
    await this.saveEntityIdMapping(rootUri, mappingFileName, metadataIdMapping)
    const restoredCrate = this.buildRestoredUploadCrate(
      uploadCrate,
      ingestedCrate,
      uploadIdMapping,
    )
    const dataverseUrl = this.buildDataverseDatasetUrl(baseUrl, pid)
    const target =
      this.buildDatasetPidTarget(pid) ||
      dataverseUrl ||
      response.url ||
      uploadUrl.toString()
    await this.appendExportLog(rootUri, {
      target,
      repository: baseUrl,
      mappingFile: mappingFileName,
      syncType: 'create',
      syncedAt: new Date().toISOString(),
      datasetName: this.getRootDatasetName(crate),
    })
    const unmappedEntityIds = Object.entries(metadataIdMapping)
      .filter(([, ingestedId]) => !ingestedId)
      .map(([metadataId]) => metadataId)

    return {
      pid,
      target,
      dataverseUrl,
      requestUrl: response.url || uploadUrl.toString(),
      response: payload,
      ingestedCrate: restoredCrate,
      mappingFileName,
      unmappedEntityIds,
    }
  }

  public async updateArp(
    repository: DataRepositoryConfig,
    exportTargetSelection?: DataRepositoryExportTarget,
    reportProgress?: ArpRoCrateUpdateProgressReporter,
  ): Promise<ArpRoCrateUpdateAnalysisResult | undefined> {
    reportProgress?.({
      completedSteps: 0,
      totalSteps: 1,
      message: 'Checking for changes...',
    })
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const rootUri = this.getWorkspaceRoot()
    const metadataCrate = await this.readRoCrate(
      rootUri.resolve('ro-crate-metadata.json'),
    )
    const exportTarget = await this.resolveExistingArpExportTarget(
      rootUri,
      repository,
      metadataCrate,
      exportTargetSelection,
    )
    if (!exportTarget) {
      return undefined
    }
    if (!exportTarget.exportLogEntry?.mappingFile || !exportTarget.mapping) {
      throw new Error(
        'This workspace has an ARP PID, but no existing export-log mapping file could be loaded for this repository. Update will not create a second mapping file.',
      )
    }

    const uploadCrate = await this.buildDataverseUploadCrate(metadataCrate, rootUri)
    const localizedExternalFiles = await this.localizeExternalLocalFileReferences(
      uploadCrate,
      rootUri,
    )
    const remoteCrate = await this.fetchRemoteRoCrate(
      baseUrl,
      repository.apiKey,
      exportTarget.pid,
    )
    const metadataMapping: RoCrateEntityIdMapping = { ...exportTarget.mapping }
    const uploadMapping = this.toUploadEntityIdMapping(
      metadataMapping,
      localizedExternalFiles.originalToUploadIds,
    )
    const diff = this.diffRoCrates(uploadCrate, remoteCrate, uploadMapping, {
      pid: exportTarget.pid,
      repository: baseUrl,
      exportLogEntry: exportTarget.exportLogEntry,
    })
    const changedFilesToReplace = diff.changedFiles.filter(
      (file: Record<string, any>) => file.changes?.hash,
    )
    const totalSteps =
      diff.newFiles.length + changedFilesToReplace.length + diff.removedFiles.length + 2
    let completedSteps = 1
    reportProgress?.({
      completedSteps,
      totalSteps,
      message: `Checking complete: ${diff.newFiles.length} file(s) to upload, ${changedFilesToReplace.length} file(s) to replace, and ${diff.removedFiles.length} file(s) to remove.`,
    })
    const localEntitiesById = new Map(
      this.readGraphEntities(uploadCrate).map((entity) => [
        this.requireEntityId(entity),
        entity,
      ]),
    )
    const remoteEntitiesById = new Map(
      this.readGraphEntities(remoteCrate).map((entity) => [
        this.requireEntityId(entity),
        entity,
      ]),
    )
    const uploadIdToMetadataId = this.toOriginalEntityIdMapping(
      localizedExternalFiles.originalToUploadIds,
    )
    for (const file of diff.newFiles) {
      reportProgress?.({
        completedSteps,
        totalSteps,
        message: `Uploading ${file.localId}...`,
      })
      const localFile = localEntitiesById.get(file.localId)
      if (!localFile) {
        throw new Error(
          `Cannot upload new file '${file.localId}' because it was not found in the local upload crate.`,
        )
      }
      const uploadedDataFileId = await this.uploadDataverseFile(
        baseUrl,
        repository.apiKey,
        exportTarget.pid,
        await this.readUploadFile(localFile, rootUri, localizedExternalFiles.entries),
      )
      const uploadedFileId = this.buildArpFileEntityId(
        uploadedDataFileId,
        uploadMapping,
        remoteCrate,
        baseUrl,
        exportTarget.pid,
      )
      uploadMapping[file.localId] = uploadedFileId
      metadataMapping[uploadIdToMetadataId[file.localId] ?? file.localId] = uploadedFileId
      completedSteps += 1
      reportProgress?.({
        completedSteps,
        totalSteps,
        message: `Uploaded ${file.localId}.`,
      })
    }
    for (const file of changedFilesToReplace) {
      reportProgress?.({
        completedSteps,
        totalSteps,
        message: `Replacing ${file.localId}...`,
      })
      const localFile = localEntitiesById.get(file.localId)
      const remoteFile = remoteEntitiesById.get(file.remoteId)
      if (!localFile || !remoteFile) {
        throw new Error(
          `Cannot replace changed file '${file.localId}' because its local or remote entity could not be resolved.`,
        )
      }
      const replacementDataFileId = await this.replaceDataverseFile(
        baseUrl,
        repository.apiKey,
        this.requireDataverseFileId(remoteFile),
        localFile,
        await this.readUploadFile(localFile, rootUri, localizedExternalFiles.entries),
      )
      const replacementFileId = this.buildArpFileEntityId(
        replacementDataFileId,
        uploadMapping,
        remoteCrate,
        baseUrl,
        exportTarget.pid,
      )
      uploadMapping[file.localId] = replacementFileId
      metadataMapping[uploadIdToMetadataId[file.localId] ?? file.localId] =
        replacementFileId
      completedSteps += 1
      reportProgress?.({
        completedSteps,
        totalSteps,
        message: `Replaced ${file.localId}.`,
      })
    }
    for (const file of diff.removedFiles) {
      reportProgress?.({
        completedSteps,
        totalSteps,
        message: `Removing ${file.remoteId}...`,
      })
      const remoteFile = remoteEntitiesById.get(file.remoteId)
      if (!remoteFile) {
        throw new Error(
          `Cannot remove file '${file.remoteId}' because it was not found in the remote crate.`,
        )
      }
      await this.deleteDataverseFile(
        baseUrl,
        repository.apiKey,
        this.requireDataverseFileId(remoteFile),
      )
      this.removeMappingEntriesByRemoteId(uploadMapping, file.remoteId)
      this.removeMappingEntriesByRemoteId(metadataMapping, file.remoteId)
      completedSteps += 1
      reportProgress?.({
        completedSteps,
        totalSteps,
        message: `Removed ${file.remoteId}.`,
      })
    }
    reportProgress?.({
      completedSteps,
      totalSteps,
      message: 'Synchronizing RO-Crate metadata...',
    })
    const metadataUpdateCrate = this.rewriteCrateEntityIds(uploadCrate, uploadMapping)
    await this.fileService.writeFile(
      rootUri.resolve('arp-rocrate-metadata-update-debug.json'),
      BinaryBuffer.fromString(`${JSON.stringify(metadataUpdateCrate, null, 2)}\n`),
    )
    // Temporarily disabled while testing native Dataverse file removal.
    await this.updateRemoteRoCrate(
      baseUrl,
      repository.apiKey,
      exportTarget.pid,
      metadataUpdateCrate,
    )
    const mappingFileName = exportTarget.exportLogEntry.mappingFile
    await this.saveEntityIdMapping(rootUri, mappingFileName, metadataMapping)
    await this.appendExportLog(rootUri, {
      target:
        this.buildDatasetPidTarget(exportTarget.pid) ||
        this.buildDataverseDatasetUrl(baseUrl, exportTarget.pid) ||
        exportTarget.pid,
      repository: baseUrl,
      mappingFile: mappingFileName,
      syncType: 'update',
      syncedAt: new Date().toISOString(),
      datasetName: this.getRootDatasetName(metadataCrate),
    })
    const unmappedEntityIds = Object.entries(metadataMapping)
      .filter(([, remoteId]) => !remoteId)
      .map(([metadataId]) => metadataId)

    const target =
      this.buildDatasetPidTarget(exportTarget.pid) ||
      this.buildDataverseDatasetUrl(baseUrl, exportTarget.pid) ||
      exportTarget.pid
    reportProgress?.({
      completedSteps: totalSteps,
      totalSteps,
      message: 'Synchronization complete.',
    })

    return {
      pid: exportTarget.pid,
      target,
      addedFileCount: diff.summary.newFiles,
      removedFileCount: diff.summary.removedFiles,
      changedFileCount: changedFilesToReplace.length,
      mappingFileName,
      unmappedEntityIds,
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
          syncedAt: entry.syncedAt,
          syncType: entry.syncType,
          datasetName: currentDatasetName ?? entry.datasetName,
        })
      }
      targetsByRepositoryId[repository.id] = Array.from(latestByMappingFile.values())
        .sort((a, b) => b.syncedAt.localeCompare(a.syncedAt))
    }

    return targetsByRepositoryId
  }

  protected getWorkspaceRoot(): URI {
    const roots = this.workspaceService.tryGetRoots()
    const root = roots?.[0]?.resource
    if (!root) {
      throw new Error('No workspace is open.')
    }
    return root
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
      const content = await this.fileService.readFile(fileUri)
      const parsed = this.parsePosixPath(relativePath)
      entity.name = this.readOptionalEntityString(entity, 'name') ?? parsed.base
      entity.hash =
        this.readOptionalEntityString(entity, 'hash') ?? this.md5(content.value.buffer)
      entity.contentSize =
        this.readOptionalEntityString(entity, 'contentSize') ??
        String(content.value.buffer.byteLength)
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

  protected async buildDataverseUploadZip(
    crate: RoCrate,
    rootUri: URI,
    externalFileEntries = new Map<string, URI>(),
  ): Promise<Uint8Array> {
    const zip = new JSZip()
    zip.file('ro-crate-metadata.json', `${JSON.stringify(crate, null, 2)}\n`)

    const fileEntries = new Map(externalFileEntries)
    for (const relativePath of this.extractCrateFilePaths(crate)) {
      if (relativePath === 'ro-crate-metadata.json' || fileEntries.has(relativePath)) {
        continue
      }
      const uri = rootUri.resolve(relativePath)
      if (!this.isInsideRoot(rootUri, uri)) {
        throw new Error(`Refusing to include path outside crate root: ${relativePath}`)
      }
      if (!(await this.fileService.exists(uri))) {
        throw new Error(`Referenced file not found for ZIP upload: ${relativePath}`)
      }
      const stat = await this.fileService.resolve(uri)
      if (stat.isDirectory) {
        throw new Error(`RO-Crate File entity points to a directory: ${relativePath}`)
      }
      fileEntries.set(relativePath, uri)
    }

    for (const [name, uri] of Array.from(fileEntries.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const content = await this.fileService.readFile(uri)
      zip.file(name, content.value.buffer)
    }

    return zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
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
      const content = await this.fileService.readFile(uri)
      const parsed = this.parsePosixPath(entryPath)
      entity.name = parsed.base
      entity.hash =
        this.readOptionalEntityString(entity, 'hash') ?? this.md5(content.value.buffer)
      entity.contentSize =
        this.readOptionalEntityString(entity, 'contentSize') ??
        String(content.value.buffer.byteLength)
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
            syncType: selectedTarget.syncType,
            syncedAt: selectedTarget.syncedAt,
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

  protected async updateRemoteRoCrate(
    baseUrl: string,
    apiKey: string | undefined,
    pid: string,
    crate: RoCrate,
  ): Promise<void> {
    const requestUrl = `${baseUrl}/api/arp/rocrate/${pid}`
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    }
    if (apiKey) {
      headers['x-dataverse-key'] = apiKey
    }
    const response = await this.fetchWithTimeout(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(crate),
    })
    const payload = await this.readResponsePayload(response)
    if (!response.ok || this.payloadHasErrorStatus(payload)) {
      throw new Error(
        `ARP RO-Crate metadata update failed (${response.status}) at ${response.url || requestUrl}: ${this.payloadSummary(payload)}`,
      )
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

  protected buildRestoredUploadCrate(
    sourceCrate: RoCrate,
    ingestedCrate: RoCrate,
    idMapping: RoCrateEntityIdMapping,
  ): RoCrate {
    const restored = this.rewriteCrateEntityIds(sourceCrate, idMapping)
    const restoredRoot = this.readGraphEntities(restored).find(
      (entity) => entity['@id'] === './',
    )
    const ingestedRoot = this.readGraphEntities(ingestedCrate).find(
      (entity) => entity['@id'] === './',
    )
    const arpPid = ingestedRoot?.['@arpPid']
    if (!restoredRoot || typeof arpPid !== 'string' || !arpPid.trim()) {
      throw new Error(
        'ARP upload completed, but the returned RO-Crate did not contain the root @arpPid needed for metadata restoration.',
      )
    }
    restoredRoot['@arpPid'] = arpPid
    return restored
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

  protected async readUploadFile(
    entity: RoCrateEntity,
    rootUri: URI,
    externalFileEntries: Map<string, URI>,
  ): Promise<ArpUpdateUploadFile> {
    const entryPath = this.dataverseFilePathFromEntity(entity)
    if (!entryPath) {
      throw new Error(
        `Cannot determine upload path for File entity '${this.requireEntityId(entity)}'.`,
      )
    }
    const externalUri = externalFileEntries.get(entryPath)
    const uri = externalUri ?? rootUri.resolve(entryPath)
    if (!externalUri && !this.isInsideRoot(rootUri, uri)) {
      throw new Error(`Refusing to upload path outside crate root: ${entryPath}`)
    }
    if (!(await this.fileService.exists(uri))) {
      throw new Error(`Referenced file not found for upload: ${entryPath}`)
    }
    const stat = await this.fileService.resolve(uri)
    if (stat.isDirectory) {
      throw new Error(`Cannot upload '${entryPath}' because it is a directory.`)
    }
    return {
      entryPath,
      content: (await this.fileService.readFile(uri)).value.buffer,
    }
  }

  protected async uploadDataverseFile(
    baseUrl: string,
    apiKey: string | undefined,
    pid: string,
    file: ArpUpdateUploadFile,
  ): Promise<string> {
    const { dir, base } = this.parsePosixPath(file.entryPath)
    const requestUrl = `${baseUrl}/api/v1/datasets/:persistentId/add?persistentId=${encodeURIComponent(pid)}`
    const form = new FormData()
    form.append('file', new Blob([file.content]), base)
    form.append('jsonData', JSON.stringify(dir ? { directoryLabel: dir } : {}))
    const headers: Record<string, string> = { accept: 'application/json' }
    if (apiKey) {
      headers['x-dataverse-key'] = apiKey
    }
    const response = await this.fetchWithTimeout(requestUrl, {
      method: 'POST',
      headers,
      body: form,
    })
    const payload = await this.readResponsePayload(response)
    if (!response.ok || this.payloadHasErrorStatus(payload)) {
      throw new Error(
        `Dataverse file upload failed for '${file.entryPath}' (${response.status}) at ${response.url || requestUrl}: ${this.payloadSummary(payload)}`,
      )
    }
    const fileId = this.extractDataverseUploadFileId(payload)
    if (!fileId) {
      throw new Error(
        `Dataverse file upload completed for '${file.entryPath}', but the response did not contain a dataFile.id.`,
      )
    }
    return fileId
  }

  protected extractDataverseUploadFileId(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return undefined
    }
    const data = (payload as Record<string, unknown>).data
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return undefined
    }
    const files = (data as Record<string, unknown>).files
    if (!Array.isArray(files)) {
      return undefined
    }
    for (const file of files) {
      if (!file || typeof file !== 'object' || Array.isArray(file)) {
        continue
      }
      const dataFile = (file as Record<string, unknown>).dataFile
      if (!dataFile || typeof dataFile !== 'object' || Array.isArray(dataFile)) {
        continue
      }
      const id = (dataFile as Record<string, unknown>).id
      if (typeof id === 'number' && Number.isFinite(id)) {
        return String(id)
      }
      if (typeof id === 'string' && id.trim()) {
        return id.trim()
      }
    }
    return undefined
  }

  protected async replaceDataverseFile(
    baseUrl: string,
    apiKey: string | undefined,
    fileId: number,
    entity: RoCrateEntity,
    file: ArpUpdateUploadFile,
  ): Promise<string> {
    const { dir, base } = this.parsePosixPath(file.entryPath)
    const requestUrl = `${baseUrl}/api/files/${fileId}/replace`
    const jsonData = {
      forceReplace: false,
      ...(this.readOptionalEntityString(entity, 'description')
        ? { description: this.readOptionalEntityString(entity, 'description') }
        : {}),
      ...(dir ? { directoryLabel: dir } : {}),
    }
    const form = new FormData()
    form.append('file', new Blob([file.content]), base)
    form.append('jsonData', JSON.stringify(jsonData))
    const headers: Record<string, string> = { accept: 'application/json' }
    if (apiKey) {
      headers['x-dataverse-key'] = apiKey
    }
    const response = await this.fetchWithTimeout(requestUrl, {
      method: 'POST',
      headers,
      body: form,
    })
    const payload = await this.readResponsePayload(response)
    if (!response.ok || this.payloadHasErrorStatus(payload)) {
      throw new Error(
        `Dataverse file replacement failed for '${file.entryPath}' (${response.status}) at ${response.url || requestUrl}: ${this.payloadSummary(payload)}`,
      )
    }
    const replacementFileId = this.extractDataverseUploadFileId(payload)
    if (!replacementFileId) {
      throw new Error(
        `Dataverse file replacement completed for '${file.entryPath}', but the response did not contain a dataFile.id.`,
      )
    }
    return replacementFileId
  }

  protected buildArpFileEntityId(
    dataFileId: string,
    existingMapping: RoCrateEntityIdMapping,
    remoteCrate: RoCrate,
    baseUrl: string,
    pid: string,
  ): string {
    if (!/^\d+$/.test(dataFileId)) {
      return dataFileId
    }

    const candidates = [
      ...Object.values(existingMapping),
      ...this.readGraphEntities(remoteCrate)
        .filter((entity) => this.entityTypes(entity).includes('File'))
        .map((entity) => this.readOptionalEntityString(entity, '@id') ?? ''),
    ]
    for (const candidate of candidates) {
      const match = candidate.match(/^(.*\/file\/)\d+$/)
      if (match) {
        return `${match[1]}${dataFileId}`
      }
    }

    const repositoryHost = new URL(baseUrl).hostname.toLowerCase()
    const arpBase =
      repositoryHost === 'dsddev.concorda.sztaki.hu'
        ? 'https://w3id.org/arp/dev/ro-id'
        : 'https://w3id.org/arp/ro-id'
    return `${arpBase}/${pid}/file/${dataFileId}`
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

  protected async deleteDataverseFile(
    baseUrl: string,
    apiKey: string | undefined,
    fileId: number,
  ): Promise<void> {
    const requestUrl = `${baseUrl}/api/files/${fileId}`
    const headers: Record<string, string> = { accept: 'application/json' }
    if (apiKey) {
      headers['x-dataverse-key'] = apiKey
    }
    const response = await this.fetchWithTimeout(requestUrl, {
      method: 'DELETE',
      headers,
    })
    const payload = await this.readResponsePayload(response)
    if (!response.ok || this.payloadHasErrorStatus(payload)) {
      throw new Error(
        `Dataverse file deletion failed for file ${fileId} (${response.status}) at ${response.url || requestUrl}: ${this.payloadSummary(payload)}`,
      )
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
    throw new Error(
      `Cannot determine Dataverse file ID for remote File entity '${this.requireEntityId(entity)}'.`,
    )
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

  protected buildEntityIdMapping(
    sourceCrate: RoCrate,
    ingestedCrate: RoCrate,
  ): RoCrateEntityIdMapping {
    const sourceEntities = this.readGraphEntities(sourceCrate)
    const ingestedEntities = this.readGraphEntities(ingestedCrate)
    const mapping = new Map<string, string>()
    const mappedIngestedIds = new Set<string>()
    const sourceParentIds = this.collectDatasetParentIds(sourceEntities)
    const ingestedParentIds = this.collectDatasetParentIds(ingestedEntities)

    if (
      sourceEntities.some((entity) => entity['@id'] === './') &&
      ingestedEntities.some((entity) => entity['@id'] === './')
    ) {
      mapping.set('./', './')
      mappedIngestedIds.add('./')
    }
    const ingestedDatasetIds = new Set(
      ingestedEntities
        .filter((entity) => this.entityTypes(entity).includes('Dataset'))
        .map((entity) => this.requireEntityId(entity)),
    )
    for (const sourceDataset of sourceEntities.filter((entity) =>
      this.entityTypes(entity).includes('Dataset'),
    )) {
      const sourceId = this.requireEntityId(sourceDataset)
      if (sourceId !== './' && ingestedDatasetIds.has(sourceId)) {
        mapping.set(sourceId, sourceId)
        mappedIngestedIds.add(sourceId)
      }
    }

    let previousSize = -1
    while (mapping.size !== previousSize) {
      previousSize = mapping.size
      this.mapFilesBySignatureAndParents(
        sourceEntities.filter((entity) => this.entityTypes(entity).includes('File')),
        ingestedEntities.filter((entity) => this.entityTypes(entity).includes('File')),
        sourceParentIds,
        ingestedParentIds,
        mapping,
        mappedIngestedIds,
      )
      this.mapDatasetsByMappedChildren(
        sourceEntities.filter(
          (entity) =>
            this.entityTypes(entity).includes('Dataset') && entity['@id'] !== './',
        ),
        ingestedEntities.filter(
          (entity) =>
            this.entityTypes(entity).includes('Dataset') && entity['@id'] !== './',
        ),
        mapping,
        mappedIngestedIds,
      )
    }

    const unmappedIds = sourceEntities
      .filter((entity) => this.shouldPersistEntityMapping(entity))
      .map((entity) => this.requireEntityId(entity))
      .filter((id) => !mapping.has(id))
    for (const id of unmappedIds) {
      mapping.set(id, '')
    }

    return Object.fromEntries(
      Array.from(mapping.entries()).sort((a, b) => a[0].localeCompare(b[0])),
    )
  }

  protected mapFilesBySignatureAndParents(
    sourceFiles: RoCrateEntity[],
    ingestedFiles: RoCrateEntity[],
    sourceParentIds: Map<string, string[]>,
    ingestedParentIds: Map<string, string[]>,
    mapping: Map<string, string>,
    mappedIngestedIds: Set<string>,
  ): void {
    const availableBySignature = new Map<string, RoCrateEntity[]>()
    for (const entity of ingestedFiles) {
      const id = this.requireEntityId(entity)
      const key = !mappedIngestedIds.has(id)
        ? this.fileMappingSignature(entity)
        : undefined
      if (key) {
        availableBySignature.set(key, [...(availableBySignature.get(key) ?? []), entity])
      }
    }

    for (const sourceFile of sourceFiles) {
      const sourceId = this.requireEntityId(sourceFile)
      const key = !mapping.has(sourceId)
        ? this.fileMappingSignature(sourceFile)
        : undefined
      if (!key) {
        continue
      }
      const sourceParents = sourceParentIds.get(sourceId) ?? []
      const relevantSourceParents = sourceParents.some((parentId) => parentId !== './')
        ? sourceParents.filter((parentId) => parentId !== './')
        : sourceParents
      const mappedParentIds = relevantSourceParents
        .map((parentId) => mapping.get(parentId))
        .filter((parentId): parentId is string => !!parentId)
      const signatureMatches = (availableBySignature.get(key) ?? []).filter(
        (entity) => !mappedIngestedIds.has(this.requireEntityId(entity)),
      )
      const matches =
        signatureMatches.length <= 1
          ? signatureMatches
          : signatureMatches.filter((entity) => {
              const candidateParentIds = new Set(
                ingestedParentIds.get(this.requireEntityId(entity)) ?? [],
              )
              return mappedParentIds.every((parentId) => candidateParentIds.has(parentId))
            })
      if (matches.length === 1) {
        const ingestedId = this.requireEntityId(matches[0])
        mapping.set(sourceId, ingestedId)
        mappedIngestedIds.add(ingestedId)
      }
    }
  }

  protected mapDatasetsByMappedChildren(
    sourceDatasets: RoCrateEntity[],
    ingestedDatasets: RoCrateEntity[],
    mapping: Map<string, string>,
    mappedIngestedIds: Set<string>,
  ): void {
    for (const sourceDataset of sourceDatasets) {
      const sourceId = this.requireEntityId(sourceDataset)
      if (mapping.has(sourceId)) {
        continue
      }
      const mappedChildIds = this.readEntityReferenceIds(sourceDataset['hasPart'])
        .map((childId) => mapping.get(childId))
        .filter((childId): childId is string => !!childId)
      if (!mappedChildIds.length) {
        continue
      }
      const matches = ingestedDatasets
        .filter((entity) => !mappedIngestedIds.has(this.requireEntityId(entity)))
        .filter((entity) => {
          const candidateChildIds = new Set(
            this.readEntityReferenceIds(entity['hasPart']),
          )
          return mappedChildIds.every((childId) => candidateChildIds.has(childId))
        })
      if (matches.length === 1) {
        const ingestedId = this.requireEntityId(matches[0])
        mapping.set(sourceId, ingestedId)
        mappedIngestedIds.add(ingestedId)
      }
    }
  }

  protected collectDatasetParentIds(entities: RoCrateEntity[]): Map<string, string[]> {
    const parentIds = new Map<string, string[]>()
    for (const entity of entities) {
      if (!this.entityTypes(entity).includes('Dataset')) {
        continue
      }
      const parentId = this.requireEntityId(entity)
      for (const childId of this.readEntityReferenceIds(entity['hasPart'])) {
        parentIds.set(childId, [...(parentIds.get(childId) ?? []), parentId])
      }
    }
    return parentIds
  }

  protected fileMappingSignature(entity: RoCrateEntity): string | undefined {
    const hash = this.readOptionalEntityString(entity, 'hash')
      ?.toLowerCase()
      .replace(/^md5:/, '')
    if (!hash) {
      return undefined
    }
    const name =
      (this.readOptionalEntityString(entity, 'name') ?? '')
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        ?.toLowerCase() ?? ''
    const directoryLabel = (this.readOptionalEntityString(entity, 'directoryLabel') ?? '')
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '')
    return `${hash}\0${directoryLabel.toLowerCase()}\0${name}`
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
    const types = this.entityTypes(entity)
    return id !== './' && (types.includes('Dataset') || types.includes('File'))
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
      BinaryBuffer.fromString(`${JSON.stringify(mapping, null, 2)}\n`),
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

  protected async appendExportLog(rootUri: URI, entry: ExportLogEntry): Promise<void> {
    const rockitUri = rootUri.resolve('.rockit')
    if (!(await this.fileService.exists(rockitUri))) {
      await this.fileService.createFolder(rockitUri)
    }
    const historyUri = rockitUri.resolve(EXPORT_LOG_FILE_NAME)
    const entries = await this.readExportLogEntries(historyUri)
    const entryPid = this.normalizePid(entry.target)
    const existingIndex = entries.findIndex(
      (existing) =>
        existing.repository === entry.repository &&
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
      const parsed = JSON.parse(
        (await this.fileService.readFile(historyUri)).value.toString(),
      )
      return Array.isArray(parsed)
        ? parsed.filter(
            (entry): entry is ExportLogEntry =>
              !!entry && typeof entry === 'object' && !Array.isArray(entry),
          )
        : []
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
    return trimmed
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
        'ARP upload completed, but an entity mapping file could not be created. An RO-Crate entity has no @id.',
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

  protected async validateRoCrate(
    crate: RoCrate,
    baseUrl: string,
    apiKey: string | undefined,
  ): Promise<void> {
    const validateUrl = new URL('/api/arp/validateRoCrate', `${baseUrl}/`)
    validateUrl.searchParams.set('strict', 'true')
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    }
    if (apiKey) {
      headers['x-dataverse-key'] = apiKey
    }

    const response = await this.fetchWithTimeout(validateUrl.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(crate),
    })
    const payload = await this.readResponsePayload(response)
    const validationErrors = this.extractArpValidationErrors(payload)
    const messages = this.extractDataverseValidationMessages(payload)
    if (validationErrors.length > 0) {
      throw new ArpRoCrateValidationError(
        response.status,
        response.url || validateUrl.toString(),
        validationErrors,
        payload,
      )
    }
    if (!response.ok || messages.length > 0) {
      const issuesPreview = messages.slice(0, 10).join(' | ')
      throw new Error(
        `Upload blocked by ARP validation (${response.status}) at ${response.url || validateUrl.toString()}${issuesPreview ? `: ${issuesPreview}` : ''}`,
      )
    }
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

  protected extractPayloadPid(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return undefined
    }
    const record = payload as Record<string, unknown>
    for (const key of ['persistentId', 'pid', 'global_id', 'globalId']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim() !== '') {
        return value.trim()
      }
    }
    const data = record.data
    return data && typeof data === 'object' && !Array.isArray(data)
      ? this.extractPayloadPid(data)
      : undefined
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

  protected extractArpValidationErrors(payload: unknown): ArpRoCrateValidationEntityError[] {
    const reports: Record<string, unknown>[] = []
    const collectReport = (value: unknown): void => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return
      }
      const record = value as Record<string, unknown>
      if (Array.isArray(record.errors)) {
        reports.push(record)
      }
      const data = record.data
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        collectReport((data as Record<string, unknown>).validation)
      }
    }

    collectReport(payload)
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>
      for (const key of ['details', 'message']) {
        const value = record[key]
        if (typeof value === 'string') {
          collectReport(this.tryParseJsonObjectFromString(value))
        } else {
          collectReport(value)
        }
      }
    }

    const entityErrors = reports.flatMap((report) =>
      (Array.isArray(report.errors) ? report.errors : []).flatMap((entry) =>
        this.normalizeArpValidationEntityError(entry),
      ),
    )
    const seen = new Set<string>()
    return entityErrors.filter((entry) => {
      const key = JSON.stringify(entry)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  }

  protected normalizeArpValidationEntityError(
    value: unknown,
  ): ArpRoCrateValidationEntityError[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return []
    }
    const record = value as Record<string, unknown>
    const nested = Array.isArray(record.errors) ? record.errors : []
    const errors = nested
      .map((issue) => this.normalizeArpValidationIssue(issue))
      .filter((issue): issue is ArpRoCrateValidationIssue => !!issue)
    if (!errors.length) {
      return []
    }
    return [
      {
        errorEntity:
          typeof record.errorEntity === 'string' && record.errorEntity.trim()
            ? record.errorEntity.trim()
            : 'RO-Crate',
        errors,
      },
    ]
  }

  protected normalizeArpValidationIssue(
    value: unknown,
  ): ArpRoCrateValidationIssue | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined
    }
    const record = value as Record<string, unknown>
    const issue: ArpRoCrateValidationIssue = {}
    if (typeof record.errorField === 'string' && record.errorField.trim()) {
      issue.errorField = record.errorField.trim()
    }
    if (typeof record.errorMessage === 'string' && record.errorMessage.trim()) {
      issue.errorMessage = record.errorMessage.trim()
    }
    if (
      typeof record.errorSuggestion === 'string' &&
      record.errorSuggestion.trim()
    ) {
      issue.errorSuggestion = record.errorSuggestion.trim()
    }
    return Object.keys(issue).length ? issue : undefined
  }

  protected extractDataverseValidationMessages(payload: unknown): string[] {
    const messages: string[] = []
    const collectIssues = (report: Record<string, unknown>): void => {
      const errors = Array.isArray(report.errors) ? report.errors : []
      for (const entry of errors) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          continue
        }
        const entryRecord = entry as Record<string, unknown>
        const errorEntity =
          typeof entryRecord.errorEntity === 'string'
            ? entryRecord.errorEntity
            : 'RO-Crate'
        const nested = Array.isArray(entryRecord.errors) ? entryRecord.errors : []
        for (const nestedIssue of nested) {
          if (
            !nestedIssue ||
            typeof nestedIssue !== 'object' ||
            Array.isArray(nestedIssue)
          ) {
            continue
          }
          const nestedRecord = nestedIssue as Record<string, unknown>
          const errorField =
            typeof nestedRecord.errorField === 'string' ? nestedRecord.errorField : ''
          const errorMessage =
            typeof nestedRecord.errorMessage === 'string' ? nestedRecord.errorMessage : ''
          const errorSuggestion =
            typeof nestedRecord.errorSuggestion === 'string'
              ? nestedRecord.errorSuggestion
              : ''
          const prefix = `${errorEntity}${errorField ? `.${errorField}` : ''}`
          const body = [errorMessage, errorSuggestion]
            .filter((part) => part !== '')
            .join(' ')
          messages.push(`${prefix}: ${body}`.trim())
        }
      }
    }

    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>
      const details = record.details
      if (details && typeof details === 'object' && !Array.isArray(details)) {
        collectIssues(details as Record<string, unknown>)
      } else if (typeof details === 'string') {
        const parsedDetails = this.tryParseJsonObjectFromString(details)
        if (parsedDetails) {
          collectIssues(parsedDetails)
        }
      }

      const message = record.message
      if (typeof message === 'string') {
        const parsedMessage = this.tryParseJsonObjectFromString(message)
        if (parsedMessage) {
          collectIssues(parsedMessage)
        }
      } else if (message && typeof message === 'object' && !Array.isArray(message)) {
        collectIssues(message as Record<string, unknown>)
      }
    }

    return Array.from(new Set(messages.filter((item) => item.trim() !== '')))
  }

  protected tryParseJsonObjectFromString(
    value: string,
  ): Record<string, unknown> | undefined {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined
    } catch {
      return undefined
    }
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

  protected toRelativePath(rootUri: URI, resourceUri: URI): string | undefined {
    const relative = rootUri.relative(resourceUri)
    return relative
      ? relative.toString().replace(/\\/g, '/').replace(/^\/+/, '')
      : undefined
  }

  protected normalizeBaseUrl(baseUrl: string): string {
    const normalized = baseUrl.trim().replace(/\/+$/, '')
    if (!normalized) {
      throw new Error('Repository base URL is empty.')
    }
    return normalized
  }

  protected buildDataverseDatasetUrl(baseUrl: string, pid?: string): string | undefined {
    return pid
      ? `${baseUrl}/dataset.xhtml?persistentId=${encodeURIComponent(pid)}`
      : undefined
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

  protected payloadHasErrorStatus(payload: unknown): boolean {
    return (
      !!payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      (payload as Record<string, unknown>).status === 'ERROR'
    )
  }

  protected readOptionalEntityString(
    entity: RoCrateEntity,
    key: string,
  ): string | undefined {
    const value = entity[key]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
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

  protected md5(input: Uint8Array): string {
    const bytes = Array.from(input)
    const originalBitLength = bytes.length * 8
    bytes.push(0x80)
    while (bytes.length % 64 !== 56) {
      bytes.push(0)
    }
    for (let i = 0; i < 8; i++) {
      bytes.push((originalBitLength >>> (8 * i)) & 0xff)
    }

    let a0 = 0x67452301
    let b0 = 0xefcdab89
    let c0 = 0x98badcfe
    let d0 = 0x10325476
    const shifts = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14,
      20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
      16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ]
    const constants = Array.from(
      { length: 64 },
      (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0,
    )

    for (let offset = 0; offset < bytes.length; offset += 64) {
      const words = new Array<number>(16)
      for (let i = 0; i < 16; i++) {
        const j = offset + i * 4
        words[i] =
          (bytes[j] |
            (bytes[j + 1] << 8) |
            (bytes[j + 2] << 16) |
            (bytes[j + 3] << 24)) >>>
          0
      }
      let a = a0
      let b = b0
      let c = c0
      let d = d0
      for (let i = 0; i < 64; i++) {
        let f: number
        let g: number
        if (i < 16) {
          f = (b & c) | (~b & d)
          g = i
        } else if (i < 32) {
          f = (d & b) | (~d & c)
          g = (5 * i + 1) % 16
        } else if (i < 48) {
          f = b ^ c ^ d
          g = (3 * i + 5) % 16
        } else {
          f = c ^ (b | ~d)
          g = (7 * i) % 16
        }
        const sum = (a + f + constants[i] + words[g]) >>> 0
        a = d
        d = c
        c = b
        b = (b + this.leftRotate(sum, shifts[i])) >>> 0
      }
      a0 = (a0 + a) >>> 0
      b0 = (b0 + b) >>> 0
      c0 = (c0 + c) >>> 0
      d0 = (d0 + d) >>> 0
    }

    return [a0, b0, c0, d0].map((word) => this.toLittleEndianHex(word)).join('')
  }

  protected leftRotate(value: number, amount: number): number {
    return ((value << amount) | (value >>> (32 - amount))) >>> 0
  }

  protected toLittleEndianHex(word: number): string {
    return [0, 8, 16, 24]
      .map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, '0'))
      .join('')
  }
}

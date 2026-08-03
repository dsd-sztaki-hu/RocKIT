import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import { FileUri } from '@theia/core/lib/common/file-uri'
import { nls } from '@theia/core/lib/common/nls'
import { URI } from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import {
  localizeExternalRoCrateFileReferences,
  RoCrateExportFileSource,
} from 'rockit-common/lib/common/ro-crate-export-file-references'
import { inject, injectable } from 'inversify'
import * as SparkMD5 from 'spark-md5'
import { DataRepositoryConfig, DataRepositoryExportTarget } from '../types'
import {
  appendExportLogEvent,
  ExportLogEntry,
  normalizeExportLogEntries,
  serializeExportLogEntries,
} from './export-log'
import {
  buildZenodoMetadataFromCrosswalk,
  missingRequiredZenodoMetadataFields,
  ZenodoMetadataOption,
  zenodoMetadataOptions,
} from './zenodo-metadata-crosswalk'
import { ZenodoRequiredMetadataDialog } from '../components/zenodo-required-metadata-dialog'

type RoCrateEntity = Record<string, unknown>
type RoCrate = Record<string, unknown>
type RoCrateEntityIdMapping = Record<string, string>

interface LocalizedExternalFileReferences {
  entries: Map<string, URI>
  originalToUploadIds: Map<string, string>
}

interface ZenodoUploadFile {
  filename: string
  content: Blob
  size: number
  entityId?: string
}

interface ZenodoRemoteFile {
  id?: string
  filename: string
  checksum?: string
  response: unknown
}

interface ZenodoDepositionMetadata extends Record<string, unknown> {
  upload_type: string
  publication_date: string
  title: string
  creators: Array<Record<string, unknown>>
  description: string
  access_right: string
}

export interface ZenodoExportResult {
  depositionId: string
  target: string
  bucketUrl: string
  uploadedFiles: Array<{
    filename: string
    size: number
    response: unknown
    remoteId?: string
    entityId?: string
  }>
  mappingFileName: string
  unmappedEntityIds: string[]
  metadata: ZenodoDepositionMetadata
  createResponse: unknown
  metadataResponse: unknown
}

export interface ZenodoUpdateResult {
  depositionId: string
  target: string
  mappingFileName: string
  addedFileCount: number
  replacedFileCount: number
  removedFileCount: number
  unchangedFileCount: number
  unmappedEntityIds: string[]
  createdNewVersion: boolean
}

export interface ZenodoExportProgress {
  completedSteps: number
  totalSteps: number
  message: string
}

export type ZenodoExportProgressReporter = (progress: ZenodoExportProgress) => void

const EXPORT_LOG_FILE_NAME = 'export-log.json'

export class ZenodoMetadataDialogCancelledError extends Error {
  constructor() {
    super('Zenodo metadata entry was cancelled.')
    this.name = 'ZenodoMetadataDialogCancelledError'
  }
}

@injectable()
export class ZenodoExportService {
  constructor(
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
    @inject(FileService) protected readonly fileService: FileService,
  ) {}

  /**
   * Creates a new Zenodo draft deposition from the workspace RO-Crate.
   *
   * The metadata transformation is deliberately completed before creating the
   * remote draft. That means missing required repository metadata is discovered
   * while the operation is still local and no empty Zenodo deposition has to be
   * cleaned up after a cancelled metadata dialog.
   *
   * File synchronization is not part of the metadata crosswalk. It is handled
   * here by uploading the localized RO-Crate metadata file plus each referenced
   * workspace file to Zenodo's bucket API, then writing a local `.rockit`
   * mapping from RO-Crate entity ids to the remote Zenodo file ids.
   */
  public async createDraftAndUploadRoCrate(
    repository: DataRepositoryConfig,
    reportProgress?: ZenodoExportProgressReporter,
  ): Promise<ZenodoExportResult> {
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const token = repository.apiKey?.trim()
    if (!token) {
      throw new Error(nls.localize('rockit/dataRepository/zenodoTokenMissing', 'Zenodo API token is missing.'))
    }

    const rootUri = this.getWorkspaceRoot()
    const crate = await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json'))
    const depositionMetadata = await this.buildDepositionMetadata(crate, baseUrl, token)
    const uploadCrate = JSON.parse(JSON.stringify(crate)) as RoCrate
    const localizedExternalFiles = await this.localizeExternalLocalFileReferences(
      uploadCrate,
      rootUri,
    )
    const uploadFiles = await this.buildUploadFiles(
      uploadCrate,
      rootUri,
      localizedExternalFiles.entries,
    )
    const totalSteps = uploadFiles.length + 3
    let completedSteps = 0

    const createUrl = new URL('/api/deposit/depositions', `${baseUrl}/`)
    reportProgress?.({
      completedSteps,
      totalSteps,
      message: nls.localize('rockit/dataRepository/creatingZenodoDraft', 'Creating Zenodo draft deposition...'),
    })
    const createResponse = await this.fetchWithTimeout(createUrl.toString(), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    })
    const createPayload = await this.readResponsePayload(createResponse)
    if (!createResponse.ok) {
      throw new Error(nls.localize(
        'rockit/dataRepository/zenodoCreationFailed',
        'Zenodo deposition creation failed ({0}) at {1}: {2}',
        createResponse.status,
        createResponse.url || createUrl.toString(),
        this.payloadSummary(createPayload),
      ))
    }

    const depositionId = this.extractDepositionId(createPayload)
    const bucketUrl = this.extractBucketUrl(createPayload)
    if (!depositionId || !bucketUrl) {
      throw new Error(nls.localize(
        'rockit/dataRepository/zenodoCreationMissingIds',
        'Zenodo created a deposition, but the response did not include an id and bucket link.',
      ))
    }
    completedSteps += 1

    const uploadedFiles: ZenodoExportResult['uploadedFiles'] = []
    for (const file of uploadFiles) {
      reportProgress?.({
        completedSteps,
        totalSteps,
        message: nls.localize('rockit/dataRepository/uploadingFile', 'Uploading {0}...', file.filename),
      })
      const uploadUrl = `${bucketUrl.replace(/\/+$/, '')}/${encodeURIComponent(file.filename)}`
      const uploadResponse = await this.fetchWithTimeout(uploadUrl, {
        method: 'PUT',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/octet-stream',
        },
        body: file.content,
      })
      const uploadPayload = await this.readResponsePayload(uploadResponse)
      if (!uploadResponse.ok) {
        throw new Error(nls.localize(
          'rockit/dataRepository/zenodoFileUploadFailed',
          "Zenodo file upload failed for '{0}' ({1}) at {2}: {3}",
          file.filename,
          uploadResponse.status,
          uploadResponse.url || uploadUrl,
          this.payloadSummary(uploadPayload),
        ))
      }
      uploadedFiles.push({
        filename: file.filename,
        size: file.size,
        response: uploadPayload,
        remoteId: this.extractUploadedFileRemoteId(uploadPayload),
        entityId: file.entityId,
      })
      completedSteps += 1
    }

    reportProgress?.({
      completedSteps,
      totalSteps,
      message: nls.localize(
        'rockit/dataRepository/uploadingZenodoMetadata',
        'Uploading Zenodo deposition metadata...',
      ),
    })
    const metadataUrl =
      this.extractSelfUrl(createPayload) ??
      new URL(
        `/api/deposit/depositions/${encodeURIComponent(depositionId)}`,
        `${baseUrl}/`,
      ).toString()
    const metadataResponse = await this.fetchWithTimeout(metadataUrl, {
      method: 'PUT',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ metadata: depositionMetadata }),
    })
    const metadataPayload = await this.readResponsePayload(metadataResponse)
    if (!metadataResponse.ok) {
      throw new Error(nls.localize(
        'rockit/dataRepository/zenodoMetadataUploadFailed',
        'Zenodo metadata upload failed ({0}) at {1}: {2}',
        metadataResponse.status,
        metadataResponse.url || metadataUrl,
        this.payloadSummary(metadataPayload),
      ))
    }
    completedSteps += 1

    reportProgress?.({
      completedSteps,
      totalSteps,
      message: nls.localize(
        'rockit/dataRepository/writingLocalExportMapping',
        'Writing local export mapping...',
      ),
    })
    const uploadMapping = this.buildEntityIdMapping(uploadCrate, uploadedFiles)
    const metadataMapping = this.toMetadataEntityIdMapping(
      crate,
      uploadMapping,
      localizedExternalFiles.originalToUploadIds,
    )
    const mappingFileName = await this.createUniqueMappingFileName(rootUri)
    await this.saveEntityIdMapping(rootUri, mappingFileName, metadataMapping)
    const target =
      this.extractHtmlUrl(createPayload) ??
      `${baseUrl}/deposit/${encodeURIComponent(depositionId)}`
    await this.appendExportLog(rootUri, {
      target,
      repository: baseUrl,
      mappingFile: mappingFileName,
      syncType: 'create',
      syncedAt: new Date().toISOString(),
      datasetName: this.getRootDatasetName(crate),
    })
    const unmappedEntityIds = Object.entries(metadataMapping)
      .filter(([, remoteId]) => !remoteId)
      .map(([metadataId]) => metadataId)
    reportProgress?.({
      completedSteps: totalSteps,
      totalSteps,
      message: nls.localize('rockit/dataRepository/zenodoExportComplete', 'Zenodo export complete.'),
    })

    return {
      depositionId,
      target,
      bucketUrl,
      uploadedFiles,
      mappingFileName,
      unmappedEntityIds,
      metadata: depositionMetadata,
      createResponse: createPayload,
      metadataResponse: metadataPayload,
    }
  }

  /**
   * Updates an existing writable Zenodo draft using the current workspace
   * RO-Crate.
   *
   * The method rebuilds the desired metadata and file list from local state,
   * loads the remote deposition, compares files by Zenodo filename and MD5
   * checksum, then deletes, replaces, or uploads only the files that changed.
   * It refuses to update published depositions because Zenodo records are no
   * longer mutable after publication.
   */
  public async updateDeposition(
    repository: DataRepositoryConfig,
    exportTarget: DataRepositoryExportTarget,
    reportProgress?: ZenodoExportProgressReporter,
  ): Promise<ZenodoUpdateResult> {
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const token = repository.apiKey?.trim()
    if (!token) {
      throw new Error(nls.localize('rockit/dataRepository/zenodoTokenMissing', 'Zenodo API token is missing.'))
    }
    if (!exportTarget?.pid) {
      throw new Error(nls.localize(
        'rockit/dataRepository/noExistingZenodoSelected',
        'No existing Zenodo deposition was selected for update.',
      ))
    }

    const rootUri = this.getWorkspaceRoot()
    const crate = await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json'))
    const depositionMetadata = await this.buildDepositionMetadata(crate, baseUrl, token)
    const uploadCrate = JSON.parse(JSON.stringify(crate)) as RoCrate
    const localizedExternalFiles = await this.localizeExternalLocalFileReferences(
      uploadCrate,
      rootUri,
    )
    const uploadFiles = await this.buildUploadFiles(
      uploadCrate,
      rootUri,
      localizedExternalFiles.entries,
    )

    reportProgress?.({
      completedSteps: 0,
      totalSteps: 1,
      message: nls.localize('rockit/dataRepository/loadingZenodoDeposition', 'Loading Zenodo deposition...'),
    })
    const existingUrl = new URL(
      `/api/deposit/depositions/${encodeURIComponent(exportTarget.pid)}`,
      `${baseUrl}/`,
    ).toString()
    const existingPayload = await this.requestJson(
      existingUrl,
      { method: 'GET', headers: this.authorizationHeaders(token) },
      nls.localize('rockit/dataRepository/zenodoLookupFailed', 'Zenodo deposition lookup failed'),
    )
    const { payload: draftPayload, createdNewVersion } = await this.resolveWritableDraft(
      existingPayload,
      token,
    )
    const depositionId = this.extractDepositionId(draftPayload)
    const bucketUrl = this.extractBucketUrl(draftPayload)
    if (!depositionId || !bucketUrl) {
      throw new Error(nls.localize(
        'rockit/dataRepository/zenodoWritableDraftMissing',
        'Zenodo did not return a writable draft id and bucket link.',
      ))
    }

    const remoteFiles = await this.listDepositionFiles(baseUrl, token, depositionId)
    const remoteByFilename = new Map(remoteFiles.map((file) => [file.filename, file]))
    const desiredByFilename = new Map(uploadFiles.map((file) => [file.filename, file]))
    const added: ZenodoUploadFile[] = []
    const replaced: Array<{ local: ZenodoUploadFile; remote: ZenodoRemoteFile }> = []
    const unchanged: Array<{ local: ZenodoUploadFile; remote: ZenodoRemoteFile }> = []
    const removed = remoteFiles.filter((file) => !desiredByFilename.has(file.filename))

    for (const local of uploadFiles) {
      const remote = remoteByFilename.get(local.filename)
      if (!remote) {
        added.push(local)
      } else if (await this.fileMatchesRemoteChecksum(local, remote.checksum)) {
        unchanged.push({ local, remote })
      } else {
        replaced.push({ local, remote })
      }
    }

    const totalSteps = added.length + replaced.length * 2 + removed.length + 3
    let completedSteps = 1
    reportProgress?.({
      completedSteps,
      totalSteps,
      message: nls.localize(
        'rockit/dataRepository/checkingComplete',
        'Checking complete: {0} file(s) to upload, {1} to replace, and {2} to remove.',
        added.length,
        replaced.length,
        removed.length,
      ),
    })

    const synchronizedFiles: ZenodoExportResult['uploadedFiles'] = unchanged.map(
      ({ local, remote }) => ({
        filename: local.filename,
        size: local.size,
        response: remote.response,
        remoteId: remote.id ?? this.extractUploadedFileRemoteId(remote.response),
        entityId: local.entityId,
      }),
    )

    for (const file of removed) {
      reportProgress?.({
        completedSteps,
        totalSteps,
        message: nls.localize('rockit/dataRepository/removingFile', 'Removing {0}...', file.filename),
      })
      await this.deleteDepositionFile(baseUrl, token, depositionId, file)
      completedSteps += 1
    }
    for (const { local, remote } of replaced) {
      reportProgress?.({
        completedSteps,
        totalSteps,
        message: nls.localize('rockit/dataRepository/replacingFile', 'Replacing {0}...', local.filename),
      })
      await this.deleteDepositionFile(baseUrl, token, depositionId, remote)
      completedSteps += 1
      synchronizedFiles.push(await this.uploadFile(bucketUrl, token, local))
      completedSteps += 1
    }
    for (const local of added) {
      reportProgress?.({
        completedSteps,
        totalSteps,
        message: nls.localize('rockit/dataRepository/uploadingFile', 'Uploading {0}...', local.filename),
      })
      synchronizedFiles.push(await this.uploadFile(bucketUrl, token, local))
      completedSteps += 1
    }

    reportProgress?.({
      completedSteps,
      totalSteps,
      message: nls.localize('rockit/dataRepository/updatingZenodoMetadata', 'Updating Zenodo metadata...'),
    })
    const metadataUrl =
      this.extractSelfUrl(draftPayload) ??
      new URL(`/api/deposit/depositions/${encodeURIComponent(depositionId)}`, `${baseUrl}/`).toString()
    await this.requestJson(
      metadataUrl,
      {
        method: 'PUT',
        headers: this.jsonAuthorizationHeaders(token),
        body: JSON.stringify({ metadata: depositionMetadata }),
      },
      nls.localize('rockit/dataRepository/zenodoMetadataUpdateFailed', 'Zenodo metadata update failed'),
    )
    completedSteps += 1

    reportProgress?.({
      completedSteps,
      totalSteps,
      message: nls.localize(
        'rockit/dataRepository/writingLocalExportMapping',
        'Writing local export mapping...',
      ),
    })
    const uploadMapping = this.buildEntityIdMapping(uploadCrate, synchronizedFiles)
    const metadataMapping = this.toMetadataEntityIdMapping(
      crate,
      uploadMapping,
      localizedExternalFiles.originalToUploadIds,
    )
    await this.saveEntityIdMapping(rootUri, exportTarget.mappingFile, metadataMapping)
    const target =
      this.extractHtmlUrl(draftPayload) ?? `${baseUrl}/deposit/${encodeURIComponent(depositionId)}`
    await this.appendExportLog(rootUri, {
      target,
      repository: baseUrl,
      mappingFile: exportTarget.mappingFile,
      syncType: 'update',
      syncedAt: new Date().toISOString(),
      datasetName: this.getRootDatasetName(crate),
    })
    const unmappedEntityIds = Object.entries(metadataMapping)
      .filter(([, remoteId]) => !remoteId)
      .map(([metadataId]) => metadataId)
    reportProgress?.({
      completedSteps: totalSteps,
      totalSteps,
      message: nls.localize('rockit/dataRepository/zenodoUpdateComplete', 'Zenodo update complete.'),
    })

    return {
      depositionId,
      target,
      mappingFileName: exportTarget.mappingFile,
      addedFileCount: added.length,
      replacedFileCount: replaced.length,
      removedFileCount: removed.length,
      unchangedFileCount: unchanged.length,
      unmappedEntityIds,
      createdNewVersion,
    }
  }

  /**
   * Reconstructs the set of previously exported Zenodo targets from the local
   * export log. The log records repository URL, target URL, and mapping file;
   * `extractDepositionIdFromTarget` converts the target URL back to the Zenodo
   * deposition id required by the deposition API.
   */
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
        const depositionId = this.extractDepositionIdFromTarget(entry.target)
        if (!depositionId || !entry.mappingFile) {
          continue
        }
        latestByMappingFile.set(entry.mappingFile, {
          pid: depositionId,
          target: entry.target,
          repository: entry.repository,
          mappingFile: entry.mappingFile,
          syncedAt: entry.syncedAt,
          syncType: entry.syncType,
          datasetName: currentDatasetName ?? entry.datasetName,
        })
      }
      targetsByRepositoryId[repository.id] = Array.from(latestByMappingFile.values())
        .sort((a, b) => b.syncedAt.localeCompare(a.syncedAt))
      await Promise.all(
        targetsByRepositoryId[repository.id].map((target) =>
          this.populateRemoteState(repository, target),
        ),
      )
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
      throw new Error(nls.localize(
        'rockit/dataRepository/parseMetadataFailed',
        'Failed to parse ro-crate-metadata.json: {0}',
        error instanceof Error ? error.message : String(error),
      ))
    }
  }

  /**
   * Builds the byte payloads sent to Zenodo's bucket endpoint.
   *
   * The uploaded RO-Crate metadata may differ from the workspace file only in
   * localized file references: external local files are copied into the upload
   * set and their `@id`s are rewritten to stable upload names. This keeps the
   * metadata export separate from repository-specific file handling.
   */
  protected async buildUploadFiles(
    crate: RoCrate,
    rootUri: URI,
    externalFileEntries = new Map<string, URI>(),
  ): Promise<ZenodoUploadFile[]> {
    const metadataContent = `${JSON.stringify(crate, null, 2)}\n`
    const files: ZenodoUploadFile[] = [
      {
        filename: 'ro-crate-metadata.json',
        content: new Blob([metadataContent], { type: 'application/octet-stream' }),
        size: new TextEncoder().encode(metadataContent).byteLength,
        entityId: 'ro-crate-metadata.json',
      },
    ]
    const fileEntries = new Map(externalFileEntries)
    for (const relativePath of this.extractCrateFilePaths(crate)) {
      if (relativePath === 'ro-crate-metadata.json' || fileEntries.has(relativePath)) {
        continue
      }
      const uri = rootUri.resolve(relativePath)
      if (!this.isInsideRoot(rootUri, uri)) {
        throw new Error(nls.localize(
          'rockit/dataRepository/pathOutsideCrate',
          'Refusing to include path outside crate root: {0}',
          relativePath,
        ))
      }
      if (!(await this.fileService.exists(uri))) {
        throw new Error(nls.localize(
          'rockit/dataRepository/zenodoReferencedFileMissing',
          'Referenced file not found for Zenodo upload: {0}',
          relativePath,
        ))
      }
      const stat = await this.fileService.resolve(uri)
      if (stat.isDirectory) {
        throw new Error(nls.localize(
          'rockit/dataRepository/fileEntityDirectory',
          'RO-Crate File entity points to a directory: {0}',
          relativePath,
        ))
      }
      fileEntries.set(relativePath, uri)
    }

    const zenodoFilenameByEntryPath = this.buildZenodoFilenameMap(Array.from(fileEntries.keys()))
    for (const [name, uri] of Array.from(fileEntries.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const content = await this.fileService.readFile(uri)
      files.push({
        filename: zenodoFilenameByEntryPath.get(name) ?? this.sanitizeZenodoFilename(name),
        content: new Blob([content.value.buffer], { type: 'application/octet-stream' }),
        size: content.value.buffer.byteLength,
        entityId: name,
      })
    }

    return files
  }

  /**
   * Builds and validates the Zenodo `metadata` object sent to the deposition
   * API. The field values come from the generated crosswalk executor; this
   * method only handles Zenodo-specific runtime requirements that cannot be
   * satisfied from RO-Crate alone, such as prompting for access-right dependent
   * license, embargo date, or access conditions.
   */
  protected async buildDepositionMetadata(
    crate: RoCrate,
    baseUrl: string,
    token: string,
  ): Promise<ZenodoDepositionMetadata> {
    const { metadata } = buildZenodoMetadataFromCrosswalk(crate)
    let missingRequiredFields = missingRequiredZenodoMetadataFields(metadata)
    if (
      missingRequiredFields.some((field) =>
        ['access_right', 'license', 'embargo_date', 'access_conditions'].includes(field),
      )
    ) {
      const licenseOptions = await this.loadZenodoLicenseOptions(baseUrl, token)
      const supplied = await new ZenodoRequiredMetadataDialog(
        metadata,
        licenseOptions,
      ).open()
      if (!supplied) {
        throw new ZenodoMetadataDialogCancelledError()
      }
      Object.assign(metadata, supplied)
      for (const field of ['license', 'embargo_date', 'access_conditions']) {
        if (!(field in supplied)) {
          delete metadata[field]
        }
      }
      missingRequiredFields = missingRequiredZenodoMetadataFields(metadata)
    }
    if (missingRequiredFields.length) {
      throw new Error(nls.localize(
        'rockit/dataRepository/zenodoRequiredMetadataMissing',
        'Zenodo metadata is missing required fields defined by the repository crosswalk: {0}.',
        missingRequiredFields.join(', '),
      ))
    }
    return metadata as ZenodoDepositionMetadata
  }

  /**
   * Loads the active Zenodo license vocabulary from the target repository.
   *
   * Zenodo installations can expose license choices through `/api/licenses/`.
   * The generated crosswalk vocabulary remains the fallback so the dialog still
   * works when the repository cannot be queried.
   */
  protected async loadZenodoLicenseOptions(
    baseUrl: string,
    token: string,
  ): Promise<ZenodoMetadataOption[]> {
    const fallback = zenodoMetadataOptions('license')
    try {
      const url = new URL('/api/licenses/', `${baseUrl}/`)
      url.searchParams.set('size', '1000')
      const payload = await this.requestJson(
        url.toString(),
        { method: 'GET', headers: this.authorizationHeaders(token) },
        nls.localize(
          'rockit/dataRepository/zenodoLicensesLoadFailed',
          'Zenodo licenses could not be loaded',
        ),
      )
      const resources = this.extractZenodoLicenseResources(payload)
      const options = resources.flatMap((resource) => {
        const metadata =
          resource.metadata &&
          typeof resource.metadata === 'object' &&
          !Array.isArray(resource.metadata)
            ? resource.metadata as Record<string, unknown>
            : resource
        const value = this.firstString(metadata.id, resource.id)
        if (!value) {
          return []
        }
        const title = this.firstString(metadata.title, resource.title)
        return [{
          value,
          label: title && title !== value ? `${title} (${value})` : value,
        }]
      })
      const loadedOptions = options.length
        ? Array.from(
            new Map(options.map((option) => [option.value, option])).values(),
          ).sort((left, right) => left.label.localeCompare(right.label))
        : fallback
      return this.withZenodoDefaultLicenses(loadedOptions)
    } catch (error) {
      console.warn('Could not load Zenodo licenses; using crosswalk vocabulary.', error)
      return this.withZenodoDefaultLicenses(fallback)
    }
  }

  protected withZenodoDefaultLicenses(
    options: ZenodoMetadataOption[],
  ): ZenodoMetadataOption[] {
    const byId = new Map(options.map((option) => [option.value, option]))
    for (const value of ['cc-zero', 'cc-by']) {
      if (!byId.has(value)) {
        byId.set(value, { value, label: value })
      }
    }
    return Array.from(byId.values())
  }

  protected extractZenodoLicenseResources(
    payload: unknown,
  ): Array<Record<string, unknown>> {
    if (Array.isArray(payload)) {
      return payload.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object' && !Array.isArray(item),
      )
    }
    if (!payload || typeof payload !== 'object') {
      return []
    }
    const hits = (payload as Record<string, unknown>).hits
    const nestedHits =
      hits && typeof hits === 'object' && !Array.isArray(hits)
        ? (hits as Record<string, unknown>).hits
        : undefined
    return Array.isArray(nestedHits)
      ? nestedHits.filter(
          (item): item is Record<string, unknown> =>
            !!item && typeof item === 'object' && !Array.isArray(item),
        )
      : []
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

    return { entries: externalFileEntries, originalToUploadIds }
  }

  protected async resolveFirstReadableLocalSource(
    sources: readonly RoCrateExportFileSource[],
  ): Promise<{ uri: URI; source: RoCrateExportFileSource } | undefined> {
    for (const source of sources) {
      const uri = source.kind === 'local' ? this.toLocalFileUri(source.value) : undefined
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
        console.warn('Failed to resolve external RO-Crate file reference:', source.value, error)
      }
    }
    return undefined
  }

  protected extractCrateFilePaths(crate: RoCrate): string[] {
    const files = new Set<string>()
    for (const entity of this.readGraphEntities(crate)) {
      if (!this.entityTypes(entity).includes('File')) {
        continue
      }
      const localPath = this.localCratePathFromEntityId(
        typeof entity['@id'] === 'string' ? entity['@id'] : '',
      )
      if (localPath) {
        files.add(localPath)
      }
    }
    return Array.from(files).sort((a, b) => a.localeCompare(b))
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

  protected localCratePathFromEntityId(id: string): string | undefined {
    if (id === '' || id === './' || id.startsWith('#')) {
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
    return this.isSafeRelativePath(normalized) ? normalized : undefined
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
    const normalized = baseUrl.trim().replace(/\/+$/, '').replace(/\/api$/, '')
    if (!normalized) {
      throw new Error(nls.localize('rockit/dataRepository/emptyRepositoryBaseUrl', 'Repository base URL is empty.'))
    }
    return normalized
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

  /**
   * Records which remote Zenodo file id corresponds to each uploaded RO-Crate
   * file entity. Metadata-only entities are intentionally absent from this map:
   * Zenodo does not assign them separate remote file ids.
   */
  protected buildEntityIdMapping(
    crate: RoCrate,
    uploadedFiles: ZenodoExportResult['uploadedFiles'],
  ): RoCrateEntityIdMapping {
    const remoteIdsByEntityId = new Map(
      uploadedFiles
        .filter((file) => !!file.entityId)
        .map((file) => [file.entityId as string, file.remoteId ?? '']),
    )
    const mapping: RoCrateEntityIdMapping = {}
    for (const [entityId, remoteId] of remoteIdsByEntityId) {
      mapping[entityId] = remoteId
    }
    return Object.fromEntries(
      Object.entries(mapping).sort((a, b) => a[0].localeCompare(b[0])),
    )
  }

  /**
   * Converts upload-time ids back to the ids used in the original metadata
   * file. External local file references may be rewritten for upload, but the
   * mapping stored in `.rockit` should remain understandable relative to the
   * user's RO-Crate.
   */
  protected toMetadataEntityIdMapping(
    metadataCrate: RoCrate,
    uploadMapping: RoCrateEntityIdMapping,
    originalToUploadIds: Map<string, string>,
  ): RoCrateEntityIdMapping {
    const mapping: RoCrateEntityIdMapping = {}
    for (const [uploadId, remoteId] of Object.entries(uploadMapping)) {
      const metadataId = this.metadataEntityIdForUploadId(uploadId, originalToUploadIds)
      mapping[metadataId] = remoteId
    }
    return Object.fromEntries(
      Object.entries(mapping).sort((a, b) => a[0].localeCompare(b[0])),
    )
  }

  protected metadataEntityIdForUploadId(
    uploadId: string,
    originalToUploadIds: Map<string, string>,
  ): string {
    for (const [originalId, localizedUploadId] of originalToUploadIds) {
      if (localizedUploadId === uploadId) {
        return originalId
      }
    }
    return uploadId
  }

  protected extractUploadedFileRemoteId(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return undefined
    }
    const record = payload as Record<string, unknown>
    for (const key of ['id', 'key', 'filename']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
      if (typeof value === 'number') {
        return String(value)
      }
    }
    const links = this.extractLinks(payload)
    for (const key of ['self', 'download']) {
      const value = links?.[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }
    return undefined
  }

  protected getRootDatasetName(crate: RoCrate): string | undefined {
    const root = this.readGraphEntities(crate).find((entity) => entity['@id'] === './')
    return root
      ? this.readOptionalEntityString(root, 'title') ??
          this.readOptionalEntityString(root, 'name')
      : undefined
  }

  protected extractCreators(root: RoCrateEntity, graph: RoCrateEntity[]): string[] {
    const authorEntities = this.uniqueEntities([
      ...this.resolveEntities(root.author, graph),
      ...this.entitiesWithType(graph, 'author'),
    ])
    const names = [
      ...authorEntities.flatMap((entity) =>
        this.readStrings(
          entity.authorName ??
            entity['author-name'] ??
            entity.name ??
            entity.givenName ??
            entity.familyName,
        ),
      ),
      ...this.readStrings(root.author).filter((value) => !this.looksLikeEntityId(value)),
    ]
    return this.uniqueStrings(names)
  }

  protected resolveEntities(value: unknown, graph: RoCrateEntity[]): RoCrateEntity[] {
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.resolveEntities(item, graph))
    }
    if (value && typeof value === 'object') {
      const entity = value as RoCrateEntity
      const linkedEntity = this.readStrings(entity['@id'])
        .map((id) => graph.find((graphEntity) => graphEntity['@id'] === id))
        .find((graphEntity): graphEntity is RoCrateEntity => !!graphEntity)
      return linkedEntity ? [linkedEntity] : [entity]
    }
    return this.readStrings(value)
      .map((id) => graph.find((graphEntity) => graphEntity['@id'] === id))
      .filter((entity): entity is RoCrateEntity => !!entity)
  }

  protected entitiesWithType(graph: RoCrateEntity[], typeName: string): RoCrateEntity[] {
    return graph.filter((entity) => this.entityTypes(entity).includes(typeName))
  }

  protected uniqueEntities(entities: RoCrateEntity[]): RoCrateEntity[] {
    const seen = new Set<string>()
    const unique: RoCrateEntity[] = []
    for (const entity of entities) {
      const key = this.readStrings(entity['@id'])[0] ?? JSON.stringify(entity)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      unique.push(entity)
    }
    return unique
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

  protected looksLikeEntityId(value: string): boolean {
    return (
      value.startsWith('#') ||
      value.startsWith('./') ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
    )
  }

  protected workspaceName(rootUri: URI): string | undefined {
    const path = rootUri.path
    const name = path.base
    return name && name !== '/' ? name : undefined
  }

  protected currentDate(): string {
    return new Date().toISOString().slice(0, 10)
  }

  protected async tryReadCurrentRootDatasetName(rootUri: URI): Promise<string | undefined> {
    try {
      return this.getRootDatasetName(
        await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json')),
      )
    } catch {
      return undefined
    }
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
      BinaryBuffer.fromString(`${JSON.stringify(serializeExportLogEntries(nextEntries), null, 2)}\n`),
    )
  }

  protected async readExportLogEntries(logUri: URI): Promise<ExportLogEntry[]> {
    if (!(await this.fileService.exists(logUri))) {
      return []
    }
    try {
      const parsed = JSON.parse((await this.fileService.readFile(logUri)).value.toString())
      return normalizeExportLogEntries(parsed)
    } catch (error) {
      console.warn('Failed to parse .rockit/export-log.json; starting a new export log.', error)
      return []
    }
  }

  protected extractDepositionIdFromTarget(value: string): string | undefined {
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

  protected async resolveWritableDraft(
    deposition: unknown,
    token: string,
  ): Promise<{ payload: unknown; createdNewVersion: boolean }> {
    if (!this.isSubmittedDeposition(deposition)) {
      return { payload: deposition, createdNewVersion: false }
    }
    throw new Error(nls.localize(
      'rockit/dataRepository/publishedZenodoCannotUpdate',
      'This Zenodo deposition is published and can no longer be updated from RocKIT.',
    ))
  }

  protected async populateRemoteState(
    repository: DataRepositoryConfig,
    target: DataRepositoryExportTarget,
  ): Promise<void> {
    const token = repository.apiKey?.trim()
    if (!token) {
      return
    }
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const url = new URL(
      `/api/deposit/depositions/${encodeURIComponent(target.pid)}`,
      `${baseUrl}/`,
    ).toString()
    try {
      const payload = await this.requestJson(
        url,
        { method: 'GET', headers: this.authorizationHeaders(token) },
        nls.localize(
          'rockit/dataRepository/zenodoStatusLookupFailed',
          'Zenodo deposition status lookup failed',
        ),
      )
      target.remoteState = this.isSubmittedDeposition(payload) ? 'published' : 'draft'
    } catch (error) {
      console.warn(`Failed to determine Zenodo deposition status for ${target.pid}.`, error)
    }
  }

  protected isSubmittedDeposition(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error(nls.localize(
        'rockit/dataRepository/invalidZenodoDepositionResponse',
        'Zenodo returned an invalid deposition response.',
      ))
    }
    const record = payload as Record<string, unknown>
    return record.submitted === true || record.state === 'done'
  }

  protected async listDepositionFiles(
    baseUrl: string,
    token: string,
    depositionId: string,
  ): Promise<ZenodoRemoteFile[]> {
    const url = new URL(
      `/api/deposit/depositions/${encodeURIComponent(depositionId)}/files`,
      `${baseUrl}/`,
    ).toString()
    const payload = await this.requestJson(
      url,
      { method: 'GET', headers: this.authorizationHeaders(token) },
      nls.localize('rockit/dataRepository/zenodoFileListingFailed', 'Zenodo file listing failed'),
    )
    if (!Array.isArray(payload)) {
      throw new Error(nls.localize(
        'rockit/dataRepository/invalidZenodoFileList',
        'Zenodo returned an invalid deposition file list.',
      ))
    }
    return payload.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(nls.localize(
          'rockit/dataRepository/invalidZenodoFileEntry',
          'Zenodo returned an invalid deposition file entry.',
        ))
      }
      const record = entry as Record<string, unknown>
      const filename = this.firstString(record.filename, record.name, record.key)
      if (!filename) {
        throw new Error(nls.localize(
          'rockit/dataRepository/zenodoFileMissingFilename',
          'Zenodo returned a deposition file without a filename.',
        ))
      }
      return {
        id: this.firstString(record.id),
        filename,
        checksum: this.firstString(record.checksum),
        response: entry,
      }
    })
  }

  protected async fileMatchesRemoteChecksum(
    file: ZenodoUploadFile,
    remoteChecksum?: string,
  ): Promise<boolean> {
    if (!remoteChecksum) {
      return false
    }
    const normalizedRemote = remoteChecksum.replace(/^md5:/i, '').toLowerCase()
    const localChecksum = SparkMD5.ArrayBuffer.hash(await file.content.arrayBuffer()).toLowerCase()
    return normalizedRemote === localChecksum
  }

  protected async deleteDepositionFile(
    baseUrl: string,
    token: string,
    depositionId: string,
    file: ZenodoRemoteFile,
  ): Promise<void> {
    if (!file.id) {
      throw new Error(nls.localize(
        'rockit/dataRepository/zenodoFileMissingId',
        "Zenodo file '{0}' does not have an id and cannot be removed.",
        file.filename,
      ))
    }
    const url = new URL(
      `/api/deposit/depositions/${encodeURIComponent(depositionId)}/files/${encodeURIComponent(file.id)}`,
      `${baseUrl}/`,
    ).toString()
    const response = await this.fetchWithTimeout(url, {
      method: 'DELETE',
      headers: this.authorizationHeaders(token),
    })
    const payload = await this.readResponsePayload(response)
    if (!response.ok) {
      throw new Error(nls.localize(
        'rockit/dataRepository/zenodoFileDeletionFailed',
        "Zenodo file deletion failed for '{0}' ({1}) at {2}: {3}",
        file.filename,
        response.status,
        response.url || url,
        this.payloadSummary(payload),
      ))
    }
  }

  protected async uploadFile(
    bucketUrl: string,
    token: string,
    file: ZenodoUploadFile,
  ): Promise<ZenodoExportResult['uploadedFiles'][number]> {
    const uploadUrl = `${bucketUrl.replace(/\/+$/, '')}/${encodeURIComponent(file.filename)}`
    const response = await this.fetchWithTimeout(uploadUrl, {
      method: 'PUT',
      headers: {
        ...this.authorizationHeaders(token),
        'content-type': 'application/octet-stream',
      },
      body: file.content,
    })
    const payload = await this.readResponsePayload(response)
    if (!response.ok) {
      throw new Error(nls.localize(
        'rockit/dataRepository/zenodoFileUploadFailed',
        "Zenodo file upload failed for '{0}' ({1}) at {2}: {3}",
        file.filename,
        response.status,
        response.url || uploadUrl,
        this.payloadSummary(payload),
      ))
    }
    return {
      filename: file.filename,
      size: file.size,
      response: payload,
      remoteId: this.extractUploadedFileRemoteId(payload),
      entityId: file.entityId,
    }
  }

  protected authorizationHeaders(token: string): Record<string, string> {
    return { accept: 'application/json', authorization: `Bearer ${token}` }
  }

  protected jsonAuthorizationHeaders(token: string): Record<string, string> {
    return { ...this.authorizationHeaders(token), 'content-type': 'application/json' }
  }

  protected async requestJson(
    url: string,
    init: RequestInit,
    errorPrefix: string,
  ): Promise<unknown> {
    const response = await this.fetchWithTimeout(url, init)
    const payload = await this.readResponsePayload(response)
    if (!response.ok) {
      throw new Error(
        `${errorPrefix} (${response.status}) at ${response.url || url}: ${this.payloadSummary(payload)}`,
      )
    }
    return payload
  }

  protected firstString(...values: unknown[]): string | undefined {
    return values.find(
      (value): value is string => typeof value === 'string' && value.trim() !== '',
    )?.trim()
  }

  protected readLink(
    links: Record<string, unknown> | undefined,
    name: string,
  ): string | undefined {
    const value = links?.[name]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }

  protected requireLink(links: Record<string, unknown> | undefined, name: string): string {
    const value = this.readLink(links, name)
    if (!value) {
      throw new Error(nls.localize(
        'rockit/dataRepository/zenodoResponseMissingLink',
        "Zenodo response did not include the '{0}' link.",
        name,
      ))
    }
    return value
  }

  protected randomId(length: number): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const bytes = new Uint8Array(length)
    window.crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
  }

  protected readOptionalEntityString(
    entity: RoCrateEntity,
    key: string,
  ): string | undefined {
    const value = entity[key]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }

  protected extractDepositionId(payload: unknown): string | undefined {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return undefined
    }
    const id = (payload as Record<string, unknown>).id
    if (typeof id === 'number') {
      return String(id)
    }
    return typeof id === 'string' && id.trim() ? id.trim() : undefined
  }

  protected extractBucketUrl(payload: unknown): string | undefined {
    const links = this.extractLinks(payload)
    const bucket = links?.bucket
    return typeof bucket === 'string' && bucket.trim() ? bucket.trim() : undefined
  }

  protected extractHtmlUrl(payload: unknown): string | undefined {
    const links = this.extractLinks(payload)
    const html = links?.html ?? links?.latest_draft_html
    return typeof html === 'string' && html.trim() ? html.trim() : undefined
  }

  protected extractSelfUrl(payload: unknown): string | undefined {
    const links = this.extractLinks(payload)
    const self = links?.self
    return typeof self === 'string' && self.trim() ? self.trim() : undefined
  }

  protected extractLinks(payload: unknown): Record<string, unknown> | undefined {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return undefined
    }
    const links = (payload as Record<string, unknown>).links
    return links && typeof links === 'object' && !Array.isArray(links)
      ? (links as Record<string, unknown>)
      : undefined
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
}

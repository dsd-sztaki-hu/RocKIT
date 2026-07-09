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
import { DataRepositoryConfig, DataRepositoryExportTarget } from '../types'

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

interface ZenodoDepositionMetadata {
  upload_type: 'dataset'
  publication_date: string
  title: string
  creators: Array<{ name: string }>
  description: string
  access_right: 'open'
  license: 'cc-zero'
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
}

export interface ZenodoExportProgress {
  completedSteps: number
  totalSteps: number
  message: string
}

export type ZenodoExportProgressReporter = (progress: ZenodoExportProgress) => void

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
export class ZenodoExportService {
  constructor(
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
    @inject(FileService) protected readonly fileService: FileService,
  ) {}

  public async createDraftAndUploadRoCrate(
    repository: DataRepositoryConfig,
    reportProgress?: ZenodoExportProgressReporter,
  ): Promise<ZenodoExportResult> {
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const token = repository.apiKey?.trim()
    if (!token) {
      throw new Error('Zenodo API token is missing.')
    }

    const rootUri = this.getWorkspaceRoot()
    const crate = await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json'))
    const depositionMetadata = this.buildDepositionMetadata(crate, rootUri)
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
    const totalSteps = uploadFiles.length + 2
    let completedSteps = 0

    const createUrl = new URL('/api/deposit/depositions', `${baseUrl}/`)
    reportProgress?.({
      completedSteps,
      totalSteps,
      message: 'Creating Zenodo draft deposition...',
    })
    const createResponse = await this.fetchWithTimeout(createUrl.toString(), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ metadata: depositionMetadata }),
    })
    const createPayload = await this.readResponsePayload(createResponse)
    if (!createResponse.ok) {
      throw new Error(
        `Zenodo deposition creation failed (${createResponse.status}) at ${createResponse.url || createUrl.toString()}: ${this.payloadSummary(createPayload)}`,
      )
    }

    const depositionId = this.extractDepositionId(createPayload)
    const bucketUrl = this.extractBucketUrl(createPayload)
    if (!depositionId || !bucketUrl) {
      throw new Error('Zenodo created a deposition, but the response did not include an id and bucket link.')
    }
    completedSteps += 1

    const uploadedFiles: ZenodoExportResult['uploadedFiles'] = []
    for (const file of uploadFiles) {
      reportProgress?.({
        completedSteps,
        totalSteps,
        message: `Uploading ${file.filename}...`,
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
        throw new Error(
          `Zenodo file upload failed for '${file.filename}' (${uploadResponse.status}) at ${uploadResponse.url || uploadUrl}: ${this.payloadSummary(uploadPayload)}`,
        )
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
      message: 'Writing local export mapping...',
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
      message: 'Zenodo export complete.',
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
        throw new Error(`Refusing to include path outside crate root: ${relativePath}`)
      }
      if (!(await this.fileService.exists(uri))) {
        throw new Error(`Referenced file not found for Zenodo upload: ${relativePath}`)
      }
      const stat = await this.fileService.resolve(uri)
      if (stat.isDirectory) {
        throw new Error(`RO-Crate File entity points to a directory: ${relativePath}`)
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

  protected buildDepositionMetadata(
    crate: RoCrate,
    rootUri: URI,
  ): ZenodoDepositionMetadata {
    const graph = this.readGraphEntities(crate)
    const root = graph.find((entity) => entity['@id'] === './')
    const title =
      (root ? this.firstMeaningfulString(root.title, root.name) : undefined) ??
      this.workspaceName(rootUri) ??
      'Untitled RO-Crate'
    const description =
      (root
        ? this.firstMeaningfulString(
            root.description,
            ...this.resolveEntities(root.dsDescription, graph).flatMap((entity) => [
              entity.dsDescriptionValue,
              entity.description,
              entity.name,
            ]),
          )
        : undefined) ?? 'RO-Crate exported from AROMA.'
    const creators = root
      ? this.extractCreators(root, graph).map((name) => ({ name }))
      : []

    if (!creators.length) {
      throw new Error(
        'Zenodo export requires at least one creator. Add an author name to the RO-Crate root Dataset before exporting.',
      )
    }

    return {
      upload_type: 'dataset',
      publication_date: this.currentDate(),
      title,
      creators,
      description,
      access_right: 'open',
      license: 'cc-zero',
    }
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
      throw new Error('Repository base URL is empty.')
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
    entries.push(entry)
    await this.fileService.writeFile(
      logUri,
      BinaryBuffer.fromString(`${JSON.stringify(entries, null, 2)}\n`),
    )
  }

  protected async readExportLogEntries(logUri: URI): Promise<ExportLogEntry[]> {
    if (!(await this.fileService.exists(logUri))) {
      return []
    }
    try {
      const parsed = JSON.parse((await this.fileService.readFile(logUri)).value.toString())
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

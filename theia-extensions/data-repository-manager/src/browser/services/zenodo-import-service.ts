import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import { nls } from '@theia/core/lib/common/nls'
import URI from '@theia/core/lib/common/uri'
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { inject, injectable } from 'inversify'

import { DataRepositoryConfig } from '../types'
import { applyZenodoMetadataToRoCrate } from './zenodo-metadata-crosswalk'

type JsonObject = Record<string, unknown>

export interface ZenodoImportResult {
  recordId: string
  targetDirectory: URI
  downloadedFileCount: number
  hasUploadedRoCrateMetadata: boolean
}

interface ZenodoRemoteFile {
  filename: string
  downloadUrl: string
  size?: number
  checksum?: string
  remoteId?: string
  response: JsonObject
}

interface LoadedZenodoRecord {
  payload: JsonObject
  metadata: JsonObject
  files: ZenodoRemoteFile[]
}

const RO_CRATE_METADATA_FILE = 'ro-crate-metadata.json'

@injectable()
export class ZenodoImportService {
  constructor(
    @inject(FileDialogService) protected readonly fileDialogService: FileDialogService,
    @inject(FileService) protected readonly fileService: FileService,
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
  ) {}

  public async importFromRecordUrl(
    repository: DataRepositoryConfig,
    recordUrl: string,
  ): Promise<ZenodoImportResult | undefined> {
    const recordId = this.extractRecordId(recordUrl)
    if (!recordId) {
      throw new Error(
        nls.localize(
          'rockit/dataRepository/extractZenodoRecordIdFailed',
          'Enter a Zenodo upload URL in the format https://zenodo.org/uploads/{id}.',
        ),
      )
    }
    if (!repository.apiKey?.trim()) {
      throw new Error(
        nls.localize(
          'rockit/dataRepository/zenodoTokenMissing',
          'Zenodo API token is missing.',
        ),
      )
    }

    const importParentDirectory = await this.fileDialogService.showOpenDialog({
      title: nls.localize(
        'rockit/dataRepository/selectImportFolder',
        'Select Import Folder',
      ),
      openLabel: nls.localize('rockit/dataRepository/importHere', 'Import Here'),
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    })
    if (!importParentDirectory) {
      return undefined
    }

    const loadedRecord = await this.loadRecord(repository, recordId)
    const targetDirectory = await this.createUniqueImportDirectory(
      importParentDirectory,
      recordId,
    )
    const uploadedMetadataFile = loadedRecord.files.find(
      (file) => file.filename === RO_CRATE_METADATA_FILE,
    )
    let uploadedCrate: JsonObject | undefined
    if (uploadedMetadataFile) {
      uploadedCrate = this.parseUploadedRoCrate(
        await this.downloadFile(repository, uploadedMetadataFile),
      )
    }

    const localPaths = this.buildLocalFilePaths(loadedRecord.files, uploadedCrate)
    for (const remoteFile of loadedRecord.files) {
      if (remoteFile === uploadedMetadataFile) {
        continue
      }
      const localPath = localPaths.get(remoteFile)
      if (!localPath) {
        continue
      }
      await this.writeFile(
        targetDirectory,
        localPath,
        await this.downloadFile(repository, remoteFile),
      )
    }

    const crateBase = uploadedCrate ?? this.createEmptyRoCrate()
    this.addDownloadedFilesToCrate(crateBase, loadedRecord.files, localPaths)
    const normalizedMetadata = this.normalizeRecordMetadata(loadedRecord.metadata)
    const importedCrate = applyZenodoMetadataToRoCrate(
      crateBase,
      normalizedMetadata,
    ).crate
    await this.fileService.writeFile(
      targetDirectory.resolve(RO_CRATE_METADATA_FILE),
      BinaryBuffer.fromString(`${JSON.stringify(importedCrate, null, 2)}\n`),
    )

    this.workspaceService.open(targetDirectory, { preserveWindow: false })
    return {
      recordId,
      targetDirectory,
      downloadedFileCount: loadedRecord.files.length,
      hasUploadedRoCrateMetadata: !!uploadedCrate,
    }
  }

  protected extractRecordId(value: string): string | undefined {
    try {
      const url = new URL(value.trim())
      if (
        url.protocol !== 'https:' ||
        url.hostname.toLowerCase() !== 'zenodo.org' ||
        url.username ||
        url.password ||
        url.port ||
        url.search ||
        url.hash
      ) {
        return undefined
      }
      return decodeURIComponent(url.pathname).match(/^\/uploads\/(\d+)\/?$/)?.[1]
    } catch {
      return undefined
    }
  }

  protected async loadRecord(
    repository: DataRepositoryConfig,
    recordId: string,
  ): Promise<LoadedZenodoRecord> {
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const headers = this.authorizationHeaders(repository.apiKey)
    const depositionUrl = new URL(
      `/api/deposit/depositions/${encodeURIComponent(recordId)}`,
      `${baseUrl}/`,
    )
    const response = await fetch(depositionUrl.toString(), { method: 'GET', headers })
    const payload = await this.readResponsePayload(response)
    if (!response.ok) {
      throw new Error(
        nls.localize(
          'rockit/dataRepository/zenodoRecordLookupFailed',
          'Zenodo record lookup failed ({0}) at {1}: {2}',
          response.status,
          response.url || depositionUrl.toString(),
          this.payloadSummary(payload),
        ),
      )
    }
    if (!this.isObject(payload)) {
      throw new Error(
        nls.localize(
          'rockit/dataRepository/invalidZenodoRecordResponse',
          'Zenodo returned an invalid record response.',
        ),
      )
    }
    const responseMetadata = payload.metadata
    if (!this.isObject(responseMetadata)) {
      throw new Error(
        nls.localize(
          'rockit/dataRepository/zenodoRecordMissingMetadata',
          'Zenodo record response did not include a metadata object.',
        ),
      )
    }
    const metadata: JsonObject = { ...responseMetadata }
    if (metadata.doi === undefined && typeof payload.doi === 'string') {
      metadata.doi = payload.doi
    }
    return {
      payload,
      metadata,
      files: this.extractRemoteFiles(payload),
    }
  }

  protected extractRemoteFiles(payload: JsonObject): ZenodoRemoteFile[] {
    const filesValue = payload.files
    const entries = Array.isArray(filesValue)
      ? filesValue
      : this.isObject(filesValue) && Array.isArray(filesValue.entries)
        ? filesValue.entries
        : this.isObject(filesValue) && this.isObject(filesValue.entries)
          ? Object.values(filesValue.entries)
          : []
    return entries.map((entry) => {
      if (!this.isObject(entry)) {
        throw new Error(
          nls.localize(
            'rockit/dataRepository/invalidZenodoFileEntry',
            'Zenodo returned an invalid file entry.',
          ),
        )
      }
      const filename = this.firstString(entry.key, entry.filename, entry.name)
      const links = this.isObject(entry.links) ? entry.links : undefined
      const downloadUrl = this.firstString(links?.content, links?.download, links?.self)
      if (!filename || !downloadUrl) {
        throw new Error(
          nls.localize(
            'rockit/dataRepository/zenodoImportFileMissingData',
            'A Zenodo file entry did not include a filename and download link.',
          ),
        )
      }
      return {
        filename,
        downloadUrl,
        size: typeof entry.size === 'number' ? entry.size : undefined,
        checksum: this.firstString(entry.checksum),
        remoteId: this.firstString(entry.id, entry.uuid, entry.version_id, entry.key),
        response: entry,
      }
    })
  }

  protected async downloadFile(
    repository: DataRepositoryConfig,
    file: ZenodoRemoteFile,
  ): Promise<Uint8Array> {
    const headers: Record<string, string> = {}
    if (
      this.sameOrigin(repository.baseUrl, file.downloadUrl) &&
      repository.apiKey?.trim()
    ) {
      headers.authorization = `Bearer ${repository.apiKey.trim()}`
    }
    const response = await fetch(file.downloadUrl, { method: 'GET', headers })
    if (!response.ok) {
      const payload = await this.readResponsePayload(response)
      throw new Error(
        nls.localize(
          'rockit/dataRepository/zenodoFileDownloadFailed',
          "Zenodo file download failed for '{0}' ({1}) at {2}: {3}",
          file.filename,
          response.status,
          response.url || file.downloadUrl,
          this.payloadSummary(payload),
        ),
      )
    }
    return new Uint8Array(await response.arrayBuffer())
  }

  protected parseUploadedRoCrate(content: Uint8Array): JsonObject {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(content))
      if (!this.isObject(parsed) || !Array.isArray(parsed['@graph'])) {
        throw new Error('Downloaded JSON did not contain an @graph array.')
      }
      return parsed
    } catch (error) {
      throw new Error(
        nls.localize(
          'rockit/dataRepository/remoteMetadataInvalid',
          'Remote ro-crate-metadata.json is invalid: {0}',
          error instanceof Error ? error.message : String(error),
        ),
      )
    }
  }

  protected buildLocalFilePaths(
    files: ZenodoRemoteFile[],
    uploadedCrate?: JsonObject,
  ): Map<ZenodoRemoteFile, string> {
    const exportedNames = uploadedCrate
      ? this.buildZenodoFilenameMap(this.extractCrateFilePaths(uploadedCrate))
      : new Map<string, string>()
    const localPathByExportedName = new Map(
      Array.from(exportedNames, ([localPath, exportedName]) => [exportedName, localPath]),
    )
    const paths = new Map<ZenodoRemoteFile, string>()
    const used = new Set<string>()
    for (const file of files) {
      if (file.filename === RO_CRATE_METADATA_FILE) {
        paths.set(file, RO_CRATE_METADATA_FILE)
        used.add(RO_CRATE_METADATA_FILE)
        continue
      }
      const preferred = localPathByExportedName.get(file.filename) ?? file.filename
      const safePath = this.normalizeSafeRelativePath(preferred)
      let candidate = safePath
      let suffix = 2
      while (used.has(candidate)) {
        candidate = this.addFilenameSuffix(safePath, suffix)
        suffix += 1
      }
      used.add(candidate)
      paths.set(file, candidate)
    }
    return paths
  }

  protected createEmptyRoCrate(): JsonObject {
    return {
      '@context': 'https://w3id.org/ro/crate/1.1/context',
      '@graph': [
        {
          '@id': RO_CRATE_METADATA_FILE,
          '@type': 'CreativeWork',
          about: { '@id': './' },
          conformsTo: { '@id': 'https://w3id.org/ro/crate/1.1' },
        },
        { '@id': './', '@type': 'Dataset' },
      ],
    }
  }

  protected addDownloadedFilesToCrate(
    crate: JsonObject,
    files: ZenodoRemoteFile[],
    localPaths: Map<ZenodoRemoteFile, string>,
  ): void {
    const graph = crate['@graph'] as JsonObject[]
    let root = graph.find((entity) => entity['@id'] === './')
    if (!root) {
      root = { '@id': './', '@type': 'Dataset' }
      graph.push(root)
    }
    const hasPart = this.references(root.hasPart)
    for (const file of files) {
      const localPath = localPaths.get(file)
      if (!localPath || localPath === RO_CRATE_METADATA_FILE) {
        continue
      }
      let entity = graph.find(
        (candidate) => this.localPathFromEntityId(candidate['@id']) === localPath,
      )
      if (!entity) {
        entity = {
          '@id': localPath,
          '@type': 'File',
          name: localPath.split('/').pop() ?? localPath,
        }
        graph.push(entity)
      }
      if (file.size !== undefined && entity.contentSize === undefined) {
        entity.contentSize = String(file.size)
      }
      const entityId = this.firstString(entity['@id']) ?? localPath
      if (!hasPart.some((reference) => reference['@id'] === entityId)) {
        hasPart.push({ '@id': entityId })
      }
    }
    if (hasPart.length) {
      root.hasPart = hasPart
    }
  }

  protected normalizeRecordMetadata(metadata: JsonObject): JsonObject {
    const normalized = { ...metadata }
    const resourceType = this.isObject(metadata.resource_type)
      ? this.firstString(metadata.resource_type.id)
      : this.firstString(metadata.resource_type)
    if (resourceType && normalized.upload_type === undefined) {
      normalized.upload_type = resourceType.split('-')[0]
    }
    const accessRight = this.isObject(metadata.access_right)
      ? this.firstString(metadata.access_right.id)
      : this.firstString(metadata.access_right)
    if (accessRight) {
      normalized.access_right = accessRight
    }
    if (normalized.license === undefined && Array.isArray(metadata.rights)) {
      const firstRight = metadata.rights.find((right) => this.isObject(right))
      if (this.isObject(firstRight)) {
        normalized.license = this.firstString(firstRight.id, firstRight.title)
      }
    }
    if (normalized.keywords === undefined && Array.isArray(metadata.subjects)) {
      normalized.keywords = metadata.subjects.flatMap((subject) =>
        this.isObject(subject)
          ? [this.firstString(subject.subject, subject.term, subject.title)].filter(
              (value): value is string => !!value,
            )
          : typeof subject === 'string'
            ? [subject]
            : [],
      )
    }
    if (Array.isArray(metadata.creators)) {
      normalized.creators = metadata.creators
        .map((creator) => this.normalizeCreator(creator))
        .filter((creator): creator is JsonObject => !!creator)
    }
    return normalized
  }

  protected normalizeCreator(value: unknown): JsonObject | undefined {
    if (!this.isObject(value)) {
      return undefined
    }
    const personOrOrg = this.isObject(value.person_or_org)
      ? value.person_or_org
      : undefined
    const name = this.firstString(
      value.name,
      personOrOrg?.name,
      this.joinName(personOrOrg?.family_name, personOrOrg?.given_name),
    )
    if (!name) {
      return undefined
    }
    const affiliations = Array.isArray(value.affiliations) ? value.affiliations : []
    const affiliation = this.firstString(
      value.affiliation,
      ...affiliations.map((item) => (this.isObject(item) ? item.name : item)),
    )
    const identifiers = Array.isArray(personOrOrg?.identifiers)
      ? personOrOrg.identifiers
      : []
    const orcid = this.firstString(
      value.orcid,
      ...identifiers.map((item) =>
        this.isObject(item) && this.firstString(item.scheme)?.toLowerCase() === 'orcid'
          ? item.identifier
          : undefined,
      ),
    )
    return { name, ...(affiliation ? { affiliation } : {}), ...(orcid ? { orcid } : {}) }
  }

  protected extractCrateFilePaths(crate: JsonObject): string[] {
    const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
    return graph.flatMap((entity) => {
      if (!this.isObject(entity) || !this.entityTypes(entity).includes('File')) {
        return []
      }
      const localPath = this.localPathFromEntityId(entity['@id'])
      return localPath && localPath !== RO_CRATE_METADATA_FILE ? [localPath] : []
    })
  }

  protected localPathFromEntityId(value: unknown): string | undefined {
    const id = this.firstString(value)
    if (!id || id === '.' || id === './' || id.startsWith('#') || id.includes(':')) {
      return undefined
    }
    return this.normalizeSafeRelativePath(id.replace(/^\.\//, ''))
  }

  protected buildZenodoFilenameMap(entryPaths: string[]): Map<string, string> {
    const used = new Set<string>()
    const result = new Map<string, string>()
    for (const entryPath of entryPaths) {
      const preferred =
        entryPath.replace(/\\/g, '/').replace(/\//g, '__').trim() || 'file'
      let candidate = preferred
      let suffix = 2
      while (used.has(candidate)) {
        candidate = this.addFilenameSuffix(preferred, suffix)
        suffix += 1
      }
      used.add(candidate)
      result.set(entryPath, candidate)
    }
    return result
  }

  protected references(value: unknown): JsonObject[] {
    const values = Array.isArray(value) ? value : value ? [value] : []
    return values.filter(
      (item): item is JsonObject =>
        this.isObject(item) && typeof item['@id'] === 'string',
    )
  }

  protected entityTypes(entity: JsonObject): string[] {
    const value = entity['@type']
    return (Array.isArray(value) ? value : [value]).filter(
      (item): item is string => typeof item === 'string',
    )
  }

  protected async writeFile(
    root: URI,
    relativePath: string,
    content: Uint8Array,
  ): Promise<void> {
    const target = this.resolveSafeChild(root, relativePath)
    await this.ensureFolder(target.parent)
    await this.fileService.writeFile(target, BinaryBuffer.wrap(content))
  }

  protected async createUniqueImportDirectory(
    parent: URI,
    recordId: string,
  ): Promise<URI> {
    const baseName = `zenodo-${recordId}`
    let candidate = parent.resolve(baseName)
    let suffix = 2
    while (await this.fileService.exists(candidate)) {
      candidate = parent.resolve(`${baseName}-${suffix}`)
      suffix += 1
    }
    await this.fileService.createFolder(candidate)
    return candidate
  }

  protected async ensureFolder(uri: URI): Promise<void> {
    if (await this.fileService.exists(uri)) {
      return
    }
    if (uri.parent.toString() !== uri.toString()) {
      await this.ensureFolder(uri.parent)
    }
    await this.fileService.createFolder(uri)
  }

  protected resolveSafeChild(root: URI, relativePath: string): URI {
    const target = relativePath
      .split('/')
      .reduce((uri, segment) => uri.resolve(segment), root)
    if (!root.isEqualOrParent(target)) {
      throw new Error(
        nls.localize(
          'rockit/dataRepository/zenodoImportPathOutsideTarget',
          'Refusing to write a Zenodo file outside the import folder: {0}',
          relativePath,
        ),
      )
    }
    return target
  }

  protected normalizeSafeRelativePath(value: string): string {
    const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
    if (
      !normalized ||
      normalized.includes('\0') ||
      normalized === '..' ||
      normalized.startsWith('../') ||
      normalized.includes('/../') ||
      /^[a-zA-Z]:\//.test(normalized)
    ) {
      throw new Error(
        nls.localize(
          'rockit/dataRepository/unsafeZenodoImportPath',
          'Refusing to import an unsafe Zenodo filename: {0}',
          value,
        ),
      )
    }
    return normalized
  }

  protected addFilenameSuffix(filename: string, suffix: number): string {
    const index = filename.lastIndexOf('.')
    return index <= 0
      ? `${filename}-${suffix}`
      : `${filename.slice(0, index)}-${suffix}${filename.slice(index)}`
  }

  protected normalizeBaseUrl(value: string): string {
    const normalized = value
      .trim()
      .replace(/\/+$/, '')
      .replace(/\/api$/, '')
    if (!normalized) {
      throw new Error(
        nls.localize(
          'rockit/dataRepository/emptyRepositoryBaseUrl',
          'Repository base URL is empty.',
        ),
      )
    }
    return normalized
  }

  protected authorizationHeaders(apiKey?: string): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (apiKey?.trim()) {
      headers.authorization = `Bearer ${apiKey.trim()}`
    }
    return headers
  }

  protected sameOrigin(baseUrl: string, otherUrl: string): boolean {
    try {
      return new URL(this.normalizeBaseUrl(baseUrl)).origin === new URL(otherUrl).origin
    } catch {
      return false
    }
  }

  protected async readResponsePayload(response: Response): Promise<unknown> {
    const text = await response.text().catch(() => '')
    if (!text.trim()) {
      return undefined
    }
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  protected payloadSummary(payload: unknown): string {
    if (typeof payload === 'string') {
      return payload.slice(0, 500)
    }
    if (this.isObject(payload)) {
      const message = this.firstString(payload.message, payload.error, payload.reason)
      if (message) {
        return message.slice(0, 500)
      }
    }
    try {
      return JSON.stringify(payload).slice(0, 500)
    } catch {
      return String(payload).slice(0, 500)
    }
  }

  protected joinName(familyName: unknown, givenName: unknown): string | undefined {
    const family = this.firstString(familyName)
    const given = this.firstString(givenName)
    return family && given ? `${family}, ${given}` : (family ?? given)
  }

  protected firstString(...values: unknown[]): string | undefined {
    return values
      .find(
        (value): value is string => typeof value === 'string' && value.trim().length > 0,
      )
      ?.trim()
  }

  protected isObject(value: unknown): value is JsonObject {
    return !!value && typeof value === 'object' && !Array.isArray(value)
  }
}

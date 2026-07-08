import JSZip = require('jszip')

import { FileUri } from '@theia/core/lib/common/file-uri'
import { URI } from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import {
  localizeExternalRoCrateFileReferences,
  RoCrateExportFileSource,
} from 'rockit-common/lib/common/ro-crate-export-file-references'
import { inject, injectable } from 'inversify'
import { DataRepositoryConfig } from '../types'

type RoCrateEntity = Record<string, unknown>
type RoCrate = Record<string, unknown>

interface LocalizedExternalFileReferences {
  entries: Map<string, URI>
}

export interface ZenodoExportResult {
  depositionId: string
  target: string
  bucketUrl: string
  filename: string
  size: number
  createResponse: unknown
  uploadResponse: unknown
}

@injectable()
export class ZenodoExportService {
  constructor(
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
    @inject(FileService) protected readonly fileService: FileService,
  ) {}

  public async createDraftAndUploadRoCrate(
    repository: DataRepositoryConfig,
  ): Promise<ZenodoExportResult> {
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const token = repository.apiKey?.trim()
    if (!token) {
      throw new Error('Zenodo API token is missing.')
    }

    const rootUri = this.getWorkspaceRoot()
    const crate = await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json'))
    const uploadCrate = JSON.parse(JSON.stringify(crate)) as RoCrate
    const localizedExternalFiles = await this.localizeExternalLocalFileReferences(
      uploadCrate,
      rootUri,
    )
    const zip = await this.buildRoCrateZip(
      uploadCrate,
      rootUri,
      localizedExternalFiles.entries,
    )

    const createUrl = new URL('/api/deposit/depositions', `${baseUrl}/`)
    const createResponse = await this.fetchWithTimeout(createUrl.toString(), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{}',
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

    const filename = 'ro-crate.zip'
    const uploadUrl = `${bucketUrl.replace(/\/+$/, '')}/${encodeURIComponent(filename)}`
    const uploadResponse = await this.fetchWithTimeout(uploadUrl, {
      method: 'PUT',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/octet-stream',
      },
      body: new Blob([zip], { type: 'application/octet-stream' }),
    })
    const uploadPayload = await this.readResponsePayload(uploadResponse)
    if (!uploadResponse.ok) {
      throw new Error(
        `Zenodo RO-Crate upload failed (${uploadResponse.status}) at ${uploadResponse.url || uploadUrl}: ${this.payloadSummary(uploadPayload)}`,
      )
    }

    return {
      depositionId,
      target: this.extractHtmlUrl(createPayload) ?? `${baseUrl}/deposit/${encodeURIComponent(depositionId)}`,
      bucketUrl,
      filename,
      size: zip.byteLength,
      createResponse: createPayload,
      uploadResponse: uploadPayload,
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

  protected async buildRoCrateZip(
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
    const localizedReferences = await localizeExternalRoCrateFileReferences(crate, {
      existingEntryPaths: this.extractCrateFilePaths(crate),
      resolveLocalSource: async (sources) => {
        const resolved = await this.resolveFirstReadableLocalSource(sources)
        return resolved ? { source: resolved.source, value: resolved.uri } : undefined
      },
    })

    for (const reference of localizedReferences) {
      externalFileEntries.set(reference.importedPath, reference.resolvedSource)
    }

    return { entries: externalFileEntries }
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

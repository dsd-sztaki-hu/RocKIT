import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import { nls } from '@theia/core/lib/common/nls'
import URI from '@theia/core/lib/common/uri'
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { inject, injectable } from 'inversify'
import JSZip = require('jszip')

import { DataRepositoryConfig, DataRepositoryImportProgressReporter } from '../types'
import { NativeDataverseExportService } from './native-dataverse-export-service'

export interface NativeDataverseImportResult {
  persistentId: string
  targetDirectory: URI
  zipPath: URI
  extractedFileCount: number
  hasRoCrateMetadata: boolean
  mappingFileName: string
}

@injectable()
export class NativeDataverseImportService {
  constructor(
    @inject(FileDialogService) protected readonly fileDialogService: FileDialogService,
    @inject(FileService) protected readonly fileService: FileService,
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
    @inject(NativeDataverseExportService)
    protected readonly exportService: NativeDataverseExportService,
  ) {}

  public async importFromDatasetUrl(
    repository: DataRepositoryConfig,
    datasetUrl: string,
    reportProgress?: DataRepositoryImportProgressReporter,
  ): Promise<NativeDataverseImportResult | undefined> {
    const persistentId = this.extractPersistentId(datasetUrl)
    if (!persistentId) {
      throw new Error(nls.localize('rockit/dataRepository/extractPersistentIdFailed', 'Could not extract a dataset persistent ID from the dataset URL.'))
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
      persistentId,
    )
    const totalSteps = 4
    reportProgress?.({
      completedSteps: 0,
      totalSteps,
      message: nls.localize('rockit/dataRepository/downloadingDatasetArchive', 'Downloading dataset archive...'),
    })
    const zipBytes = await this.downloadDatasetZip(repository, persistentId)
    const zipPath = targetDirectory.resolve('dataverse-dataset.zip')
    await this.fileService.writeFile(zipPath, BinaryBuffer.wrap(zipBytes))

    reportProgress?.({
      completedSteps: 1,
      totalSteps,
      message: nls.localize('rockit/dataRepository/extractingDatasetArchive', 'Extracting dataset archive...'),
    })
    const extractedFileCount = await this.extractZip(zipBytes, targetDirectory)
    const hasRoCrateMetadata = await this.fileService.exists(
      targetDirectory.resolve('ro-crate-metadata.json'),
    )
    reportProgress?.({
      completedSteps: 2,
      totalSteps,
      message: nls.localize('rockit/dataRepository/generatingImportLinkMapping', 'Generating remote link mapping...'),
    })
    const link = await this.exportService.persistImportedDatasetLink(
      targetDirectory,
      repository,
      persistentId,
    )

    reportProgress?.({
      completedSteps: 3,
      totalSteps,
      message: nls.localize('rockit/dataRepository/openingImportedDataset', 'Opening imported dataset...'),
    })
    this.workspaceService.open(targetDirectory, { preserveWindow: false })
    reportProgress?.({ completedSteps: totalSteps, totalSteps, message: '' })

    return {
      persistentId,
      targetDirectory,
      zipPath,
      extractedFileCount,
      hasRoCrateMetadata,
      mappingFileName: link.mappingFileName,
    }
  }

  protected async downloadDatasetZip(
    repository: DataRepositoryConfig,
    persistentId: string,
  ): Promise<Uint8Array> {
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const url = new URL('/api/access/dataset/:persistentId/', `${baseUrl}/`)
    url.searchParams.set('persistentId', persistentId)

    const headers: Record<string, string> = { accept: 'application/zip' }
    if (repository.apiKey) {
      headers['X-Dataverse-key'] = repository.apiKey
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
    })
    if (!response.ok) {
      const message = await this.readErrorResponseMessage(response)
      throw new Error(
        nls.localize(
          'rockit/dataRepository/dataverseZipDownloadFailed',
          'Dataverse dataset ZIP download failed ({0}): {1}',
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

  protected async createUniqueImportDirectory(
    parent: URI,
    persistentId: string,
  ): Promise<URI> {
    const baseName = this.createImportDirectoryName(persistentId)
    let candidate = parent.resolve(baseName)
    let suffix = 2

    while (await this.fileService.exists(candidate)) {
      candidate = parent.resolve(`${baseName}-${suffix}`)
      suffix += 1
    }

    await this.fileService.createFolder(candidate)
    return candidate
  }

  protected createImportDirectoryName(persistentId: string): string {
    const parts = persistentId
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
    const rawName = parts.length ? parts[parts.length - 1] : persistentId
    const sanitized = rawName
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+$/, '')

    return sanitized || 'dataverse-import'
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

  protected extractPersistentId(value: string): string | undefined {
    const trimmed = value.trim()
    if (!trimmed) {
      return undefined
    }
    if (/^(doi|hdl):/i.test(trimmed)) {
      return trimmed
    }
    try {
      const url = new URL(trimmed)
      const persistentId = url.searchParams.get('persistentId')
      if (persistentId?.trim()) {
        return persistentId.trim()
      }
      const path = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      if (url.hostname.toLowerCase() === 'doi.org' && path) {
        return `doi:${path}`
      }
      if (url.hostname.toLowerCase() === 'hdl.handle.net' && path) {
        return `hdl:${path}`
      }
    } catch {
      // Not a URL; fall back to accepting compact persistent ID-like values.
    }
    return trimmed.includes('/') ? undefined : trimmed
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

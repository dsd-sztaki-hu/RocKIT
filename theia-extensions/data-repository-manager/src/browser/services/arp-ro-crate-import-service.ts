import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import URI from '@theia/core/lib/common/uri'
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { inject, injectable } from 'inversify'
import JSZip = require('jszip')

import { DataRepositoryConfig } from '../types'

export interface ArpRoCrateImportResult {
  datasetPid: string
  targetDirectory: URI
  zipPath: URI
  extractedFileCount: number
}

@injectable()
export class ArpRoCrateImportService {
  constructor(
    @inject(FileDialogService) protected readonly fileDialogService: FileDialogService,
    @inject(FileService) protected readonly fileService: FileService,
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
  ) {}

  public async importFromDatasetUrl(
    repository: DataRepositoryConfig,
    datasetUrl: string,
  ): Promise<ArpRoCrateImportResult | undefined> {
    const datasetPid = this.extractDatasetPid(datasetUrl)
    if (!datasetPid) {
      throw new Error('Could not extract a dataset handle or persistent ID from the dataset URL.')
    }

    const importParentDirectory = await this.fileDialogService.showOpenDialog({
      title: 'Select Import Folder',
      openLabel: 'Import Here',
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    })
    if (!importParentDirectory) {
      return undefined
    }

    const targetDirectory = await this.createUniqueImportDirectory(
      importParentDirectory,
      datasetPid,
    )
    const zipBytes = await this.downloadRoCrateZip(repository, datasetPid)
    const zipPath = targetDirectory.resolve('rocrate.zip')
    await this.fileService.writeFile(zipPath, BinaryBuffer.wrap(zipBytes))

    const extractedFileCount = await this.extractZip(zipBytes, targetDirectory)
    const metadataUri = targetDirectory.resolve('ro-crate-metadata.json')
    if (!(await this.fileService.exists(metadataUri))) {
      throw new Error('The downloaded ZIP did not contain ro-crate-metadata.json.')
    }

    this.workspaceService.open(targetDirectory, { preserveWindow: false })

    return {
      datasetPid,
      targetDirectory,
      zipPath,
      extractedFileCount,
    }
  }

  protected async downloadRoCrateZip(
    repository: DataRepositoryConfig,
    datasetPid: string,
  ): Promise<Uint8Array> {
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const url = new URL(
      `/api/access/datafiles/rocrate/${this.encodeDatasetPidPath(datasetPid)}`,
      `${baseUrl}/`,
    )
    const headers: Record<string, string> = { accept: 'application/zip' }
    if (repository.apiKey) {
      headers['x-dataverse-key'] = repository.apiKey
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
    })
    if (!response.ok) {
      const message = await response.text().catch(() => '')
      throw new Error(
        `ARP RO-Crate ZIP download failed (${response.status}): ${message.slice(0, 500)}`,
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

  protected async createUniqueImportDirectory(parent: URI, datasetPid: string): Promise<URI> {
    const baseName = this.createImportDirectoryName(datasetPid)
    let candidate = parent.resolve(baseName)
    let suffix = 2

    while (await this.fileService.exists(candidate)) {
      candidate = parent.resolve(`${baseName}-${suffix}`)
      suffix += 1
    }

    await this.fileService.createFolder(candidate)
    return candidate
  }

  protected createImportDirectoryName(datasetPid: string): string {
    const tail = datasetPid
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
      .pop()

    const rawName = tail || datasetPid
    const sanitized = rawName
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+$/, '')

    return sanitized || 'ro-crate-import'
  }

  protected resolveSafeChild(root: URI, relativePath: string): URI {
    const target = relativePath
      .split('/')
      .filter((segment) => segment.length > 0)
      .reduce((uri, segment) => uri.resolve(segment), root)

    if (!root.isEqualOrParent(target)) {
      throw new Error(`Refusing to extract ZIP entry outside target folder: ${relativePath}`)
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
      throw new Error(`Refusing to extract unsafe ZIP entry: ${value}`)
    }
    return normalized
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
      // Not a URL; fall back to treating it as a PID-like value.
    }
    return trimmed.includes('/') ? undefined : trimmed
  }

  protected encodeDatasetPidPath(datasetPid: string): string {
    return datasetPid
      .split('/')
      .map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ':'))
      .join('/')
  }

  protected normalizeBaseUrl(baseUrl: string): string {
    const normalized = baseUrl.trim().replace(/\/+$/, '')
    if (!normalized) {
      throw new Error('Repository base URL is empty.')
    }
    return normalized.endsWith('/api/v1') ? normalized.slice(0, -'/api/v1'.length) : normalized
  }
}

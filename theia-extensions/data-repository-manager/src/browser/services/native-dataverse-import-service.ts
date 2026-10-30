// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import { nls } from '@theia/core/lib/common/nls'
import URI from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { inject, injectable } from 'inversify'
import JSZip = require('jszip')

import { DataRepositoryConfig } from '../types'
import { NativeDataverseExportService } from './native-dataverse-export-service'

export interface NativeDataverseImportResult {
  persistentId: string
  targetDirectory: URI
  zipPath: URI
  extractedFileCount: number
  hasRoCrateMetadata: boolean
  mappingFileName: string
}

export interface DataverseProviderImportDownload {
  providerId: 'dataverse'
  cancelled?: boolean
  persistentId?: string
  importedWorkspaceUri?: string
  archiveUri?: string
  datasetVersionData?: Record<string, unknown>
  landingPage?: string
}

@injectable()
export class NativeDataverseImportService {
  constructor(
    @inject(FileService) protected readonly fileService: FileService,
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
    @inject(NativeDataverseExportService)
    protected readonly exportService: NativeDataverseExportService,
  ) {}

  public async completeProviderImport(
    repository: DataRepositoryConfig,
    download: DataverseProviderImportDownload,
  ): Promise<NativeDataverseImportResult | { cancelled: true }> {
    if (download.cancelled) return { cancelled: true }
    if (
      download.providerId !== 'dataverse' ||
      !download.persistentId ||
      !download.importedWorkspaceUri ||
      !download.archiveUri ||
      !download.datasetVersionData
    ) {
      throw new Error('The Dataverse provider returned an incomplete import download.')
    }
    const targetDirectory = new URI(download.importedWorkspaceUri)
    const zipPath = new URI(download.archiveUri)
    if (targetDirectory.isEqual(zipPath) || !targetDirectory.isEqualOrParent(zipPath)) {
      throw new Error('The Dataverse provider returned an import archive outside its workspace.')
    }

    let extractedFileCount: number
    try {
      const archive = await this.fileService.readFile(zipPath)
      extractedFileCount = await this.extractZip(archive.value.buffer, targetDirectory)
    } finally {
      if (await this.fileService.exists(zipPath)) {
        await this.fileService.delete(zipPath)
      }
    }
    const hasRoCrateMetadata = await this.fileService.exists(
      targetDirectory.resolve('ro-crate-metadata.json'),
    )
    const link = await this.exportService.persistImportedDatasetLink(
      targetDirectory,
      repository,
      download.persistentId,
      download.datasetVersionData,
    )
    this.workspaceService.open(targetDirectory, { preserveWindow: false })
    return {
      persistentId: download.persistentId,
      targetDirectory,
      zipPath,
      extractedFileCount,
      hasRoCrateMetadata,
      mappingFileName: link.mappingFileName,
    }
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

}

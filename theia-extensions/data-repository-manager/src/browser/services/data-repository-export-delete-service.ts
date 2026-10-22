// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import { nls } from '@theia/core/lib/common/nls'
import { URI } from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { inject, injectable } from 'inversify'
import { DataRepositoryExportTarget } from '../types'
import {
  ExportLogEntry,
  normalizeExportLogEntries,
  serializeExportLogEntries,
} from './export-log'

@injectable()
export class DataRepositoryExportDeleteService {
  constructor(
    @inject(FileService) protected readonly fileService: FileService,
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
  ) {}

  async unlinkExport(target: DataRepositoryExportTarget): Promise<void> {
    const root = this.workspaceService.tryGetRoots()?.[0]?.resource
    if (!root) {
      throw new Error(
        nls.localize('rockit/dataRepository/noWorkspace', 'No workspace is open.'),
      )
    }
    const rockit = root.resolve('.rockit')
    const logUri = rockit.resolve('export-log.json')
    const entries = await this.readLog(logUri)
    const remaining = entries.filter(
      (entry) =>
        this.normalizeUrl(entry.repository) !== this.normalizeUrl(target.repository) ||
        entry.mappingFile !== target.mappingFile,
    )
    await this.fileService.writeFile(
      logUri,
      BinaryBuffer.fromString(
        `${JSON.stringify(serializeExportLogEntries(remaining), null, 2)}\n`,
      ),
    )
    const mappingUri = rockit.resolve(target.mappingFile)
    if (await this.fileService.exists(mappingUri)) {
      await this.fileService.delete(mappingUri)
    }
  }

  protected async readLog(uri: URI): Promise<ExportLogEntry[]> {
    if (!(await this.fileService.exists(uri))) {
      return []
    }
    try {
      const parsed = JSON.parse((await this.fileService.readFile(uri)).value.toString())
      return normalizeExportLogEntries(parsed)
    } catch (error) {
      throw new Error(
        nls.localize(
          'rockit/dataRepository/readExportLogFailed',
          'Could not read .rockit/export-log.json: {0}',
          error instanceof Error ? error.message : String(error),
        ),
      )
    }
  }

  protected normalizeUrl(value: unknown): string {
    return typeof value === 'string' ? value.trim().replace(/\/+$/, '').toLowerCase() : ''
  }

}

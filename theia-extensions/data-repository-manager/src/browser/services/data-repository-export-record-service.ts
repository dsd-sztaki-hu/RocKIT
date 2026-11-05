// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import { nls } from '@theia/core/lib/common/nls'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { inject, injectable } from 'inversify'
import { DataRepositoryExportTarget } from '../types'
import { ExportLogEntry, normalizeExportLogEntries } from './export-log'

@injectable()
export class DataRepositoryExportRecordService {
  constructor(
    @inject(FileService) protected readonly fileService: FileService,
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
  ) {}

  async readExport(target: DataRepositoryExportTarget): Promise<ExportLogEntry> {
    const { records } = await this.readLog()
    const entry = normalizeExportLogEntries(records).find(record => this.matches(record, target))
    if (!entry) throw new Error(nls.localize(
      'rockit/dataRepository/exportRecordMissing', 'This export record no longer exists.',
    ))
    return entry
  }

  async changeCrosswalk(target: DataRepositoryExportTarget, crosswalkId?: string): Promise<void> {
    const { uri, content, records } = await this.readLog()
    const matching = records.filter(record => this.matches(record, target))
    if (!matching.length) throw new Error(nls.localize(
      'rockit/dataRepository/exportRecordMissing', 'This export record no longer exists.',
    ))
    for (const record of matching) {
      // An explicit null overrides crosswalks retained in legacy history.
      record.crosswalkFile = crosswalkId || null
    }
    await this.fileService.writeFile(
      uri,
      BinaryBuffer.fromString(`${JSON.stringify(records, null, 2)}\n`),
      { etag: content.etag, mtime: content.mtime },
    )
  }

  protected async readLog() {
    const root = this.workspaceService.tryGetRoots()?.[0]?.resource
    if (!root) throw new Error(nls.localize(
      'rockit/dataRepository/noWorkspace', 'No workspace is open.',
    ))
    const uri = root.resolve('.rockit').resolve('export-log.json')
    const content = await this.fileService.readFile(uri)
    const records: unknown = JSON.parse(content.value.toString())
    if (!Array.isArray(records)) throw new Error(nls.localize(
      'rockit/dataRepository/invalidExportLog', 'The export log must contain a list of records.',
    ))
    return { uri, content, records: records as Array<Record<string, unknown>> }
  }

  protected matches(record: Record<string, unknown>, target: DataRepositoryExportTarget): boolean {
    return !!record && typeof record === 'object' &&
      typeof record.repository === 'string' &&
      record.repository.trim().replace(/\/+$/, '').toLowerCase() ===
        target.repository.trim().replace(/\/+$/, '').toLowerCase() &&
      typeof record.mappingFile === 'string' && record.mappingFile.trim() === target.mappingFile
  }
}

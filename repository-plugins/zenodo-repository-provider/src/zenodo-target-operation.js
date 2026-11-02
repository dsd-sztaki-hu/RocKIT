// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const {
  appendExportLogEvent,
  normalizeExportLogEntries,
  serializeExportLogEntries,
} = require('./export-log')
const { ZenodoCreateOperation } = require('./zenodo-create-operation')

class ZenodoTargetOperation extends ZenodoCreateOperation {
  async list(input) {
    const repository = this.repository(input)
    const rootUri = this.workspaceRoot()
    const entries = normalizeExportLogEntries(
      await this.readExportLog(
        this.vscode.Uri.joinPath(rootUri, '.rockit', 'export-log.json'),
      ),
    )
    const currentDatasetName = await this.currentDatasetName(rootUri)
    const baseUrl = this.normalizeBaseUrl(repository.baseUrl)
    const latestByMappingFile = new Map()
    for (const entry of entries) {
      if (
        this.normalizeBaseUrl(entry.repository) !== baseUrl ||
        !this.text(entry.mappingFile)
      ) {
        continue
      }
      const depositionId = this.text(entry.pid) || this.extractDepositionId(entry.target)
      if (!depositionId) continue
      latestByMappingFile.set(entry.mappingFile, {
        pid: depositionId,
        target: entry.target,
        repository: entry.repository,
        mappingFile: entry.mappingFile,
        crosswalkFile: entry.crosswalkFile,
        lastSuccessfulActionAt: entry.lastSuccessfulActionAt,
        syncType: entry.syncType,
        remoteState: entry.remoteState,
        status: entry.status,
        errorMessage: entry.errorMessage,
        datasetName: entry.datasetName || currentDatasetName,
      })
    }
    return Array.from(latestByMappingFile.values()).sort((left, right) =>
      (right.lastSuccessfulActionAt || '').localeCompare(
        left.lastSuccessfulActionAt || '',
      ),
    )
  }

  async markFailed(input) {
    this.repository(input)
    const target = input?.exportTarget
    if (!target || typeof target !== 'object') {
      throw new Error('The Zenodo export target is missing.')
    }
    const message = this.text(input?.message)
    if (!message) throw new Error('An export recovery failure message is required.')
    const rootUri = this.workspaceRoot()
    const uri = this.vscode.Uri.joinPath(rootUri, '.rockit', 'export-log.json')
    const entries = normalizeExportLogEntries(await this.readExportLog(uri))
    await this.writeJson(
      uri,
      serializeExportLogEntries(
        appendExportLogEvent(entries, {
          ...target,
          status: 'failed',
          errorMessage: message,
        }),
      ),
    )
    return { providerId: 'zenodo', remoteId: this.text(target.pid), status: 'failed' }
  }

  repository(input) {
    const repository = input?.repository
    if (!repository || typeof repository !== 'object') {
      throw new Error('The Zenodo repository configuration is missing.')
    }
    return repository
  }

  async currentDatasetName(rootUri) {
    try {
      const crate = this.parseCrate(
        await this.vscode.workspace.fs.readFile(
          this.vscode.Uri.joinPath(rootUri, 'ro-crate-metadata.json'),
        ),
      )
      return this.rootDatasetName(crate)
    } catch {
      return undefined
    }
  }

  extractDepositionId(value) {
    const text = this.text(value)
    if (!text) return undefined
    const direct = text.match(/^(?:zenodo:)?(\d+)$/i)
    if (direct) return direct[1]
    try {
      return decodeURIComponent(new URL(text).pathname).match(
        /\/(?:deposit|record|uploads)\/(\d+)/,
      )?.[1]
    } catch {
      return undefined
    }
  }

  text(value) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    return undefined
  }
}

module.exports = { ZenodoTargetOperation }

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const { DataverseCreateOperation } = require('./dataverse-create-operation')

const ARCHIVE_NAME = '.rockit-dataverse-import.zip'

class DataverseImportOperation extends DataverseCreateOperation {
  async execute(input, progress = { report() {} }) {
    const repository = this.object(input?.repository)
    if (!repository?.baseUrl) {
      throw new Error('The Dataverse repository configuration is missing.')
    }
    const persistentId = this.extractPersistentId(input?.recordUrl)
    if (!persistentId) {
      throw new Error(
        'Could not extract a dataset persistent ID from the Dataverse dataset URL.',
      )
    }
    const parentUri = await this.importParent(input?.targetParentUri)
    if (!parentUri) return { providerId: 'dataverse', cancelled: true }

    const client = this.clientFactory(repository)
    progress.report({ message: 'Loading Dataverse dataset metadata...' })
    const version = await this.loadDatasetVersion(client, persistentId)
    const datasetVersionData = this.object(version.payload?.data)
    if (!datasetVersionData) {
      throw new Error('The Dataverse dataset response did not contain dataset data.')
    }

    progress.report({ message: 'Downloading Dataverse dataset archive...' })
    const archive = await client.downloadDatasetZip(persistentId)
    this.requireSuccess(archive, 'Dataverse dataset ZIP download')
    if (!(archive.bytes instanceof Uint8Array)) {
      throw new Error('Dataverse returned an invalid dataset ZIP download.')
    }

    const targetUri = await this.createUniqueImportDirectory(parentUri, persistentId)
    const archiveUri = this.vscode.Uri.joinPath(targetUri, ARCHIVE_NAME)
    await this.vscode.workspace.fs.writeFile(archiveUri, archive.bytes)
    return {
      providerId: 'dataverse',
      persistentId,
      importedWorkspaceUri: String(targetUri),
      archiveUri: String(archiveUri),
      datasetVersionData,
      landingPage: this.datasetUrl(repository.baseUrl, persistentId),
    }
  }

  async loadDatasetVersion(client, persistentId) {
    const draft = await client.getDatasetVersion(persistentId, ':draft')
    if (draft?.ok && this.object(draft.payload)?.status !== 'ERROR') return draft
    const latest = await client.getDatasetVersion(persistentId, ':latest')
    this.requireSuccess(latest, 'Dataverse dataset lookup')
    return latest
  }

  extractPersistentId(value) {
    const input = this.text(value)
    if (!input) return undefined
    if (/^(doi|hdl):/i.test(input)) return input
    try {
      const url = new URL(input)
      const persistentId = this.text(url.searchParams.get('persistentId'))
      if (persistentId) return persistentId
      const path = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      if (url.hostname.toLowerCase() === 'doi.org' && path) return `doi:${path}`
      if (url.hostname.toLowerCase() === 'hdl.handle.net' && path) return `hdl:${path}`
    } catch { /* Report the common invalid input below. */ }
    return input.includes('/') ? undefined : input
  }

  async importParent(provided) {
    if (provided) {
      return typeof provided === 'string' ? this.vscode.Uri.parse(provided) : provided
    }
    const selected = await this.vscode.window.showOpenDialog({
      title: 'Select Import Folder',
      openLabel: 'Import Here',
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    })
    return selected?.[0]
  }

  async createUniqueImportDirectory(parentUri, persistentId) {
    const tail = persistentId.split('/').map(value => value.trim()).filter(Boolean).at(-1)
    const base = (tail || persistentId)
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/\s+/g, ' ').trim().replace(/^\.+$/, '') || 'dataverse-import'
    let name = base
    let suffix = 2
    while (await this.exists(this.vscode.Uri.joinPath(parentUri, name))) {
      name = `${base}-${suffix++}`
    }
    const target = this.vscode.Uri.joinPath(parentUri, name)
    await this.vscode.workspace.fs.createDirectory(target)
    return target
  }

  async exists(uri) {
    try {
      await this.vscode.workspace.fs.stat(uri)
      return true
    } catch {
      return false
    }
  }

  datasetUrl(baseUrl, persistentId) {
    const base = String(baseUrl).trim().replace(/\/+$/, '').replace(/\/api\/v1$/i, '')
    const encoded = encodeURIComponent(persistentId)
      .replace(/%3A/gi, ':').replace(/%2F/gi, '/')
    return `${base}/dataset.xhtml?persistentId=${encoded}`
  }
}

module.exports = { DataverseImportOperation, ARCHIVE_NAME }

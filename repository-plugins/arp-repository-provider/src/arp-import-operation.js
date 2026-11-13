// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const { ArpCreateOperation } = require('./arp-create-operation')
const { withRepositoryInput } = require('./repository-progress')

const ARCHIVE_NAME = '.rockit-arp-import.zip'

class ArpImportOperation extends ArpCreateOperation {
  async execute(input, progress = { report() {} }) {
    const repository = this.object(input?.repository)
    if (!repository?.baseUrl) {
      throw new Error('The ARP repository configuration is missing.')
    }
    const datasetPid = this.extractDatasetPid(input?.recordUrl)
    if (!datasetPid) {
      throw new Error('Could not extract a dataset handle or persistent ID from the dataset URL.')
    }
    const parentUri = await withRepositoryInput(progress, () => this.importParent(input?.targetParentUri))
    if (!parentUri) return { providerId: 'arp', cancelled: true }

    progress.report({ message: 'Downloading ARP dataset archive...' })
    const response = await this.clientFactory(repository).downloadRoCrateZip(datasetPid)
    this.requireSuccess(response, 'ARP RO-Crate ZIP download')
    if (!(response.bytes instanceof Uint8Array)) {
      throw new Error('ARP returned an invalid RO-Crate ZIP download.')
    }

    const targetUri = await this.createUniqueImportDirectory(parentUri, datasetPid)
    const archiveUri = this.vscode.Uri.joinPath(targetUri, ARCHIVE_NAME)
    await this.vscode.workspace.fs.writeFile(archiveUri, response.bytes)
    progress.report({ message: 'ARP dataset archive downloaded.' })
    return {
      providerId: 'arp',
      datasetPid,
      importedWorkspaceUri: String(targetUri),
      archiveUri: String(archiveUri),
      landingPage: this.datasetUrl(repository.baseUrl, datasetPid),
    }
  }

  extractDatasetPid(value) {
    if (typeof value !== 'string' || !value.trim()) return undefined
    const trimmed = value.trim()
    if (/^(hdl|doi):/i.test(trimmed)) return trimmed
    try {
      const url = new URL(trimmed)
      const persistentId = url.searchParams.get('persistentId')
      if (persistentId?.trim()) return persistentId.trim()
      const path = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      if (url.hostname.toLowerCase() === 'hdl.handle.net' && path) return `hdl:${path}`
      if (url.hostname.toLowerCase() === 'doi.org' && path) return `doi:${path}`
    } catch { /* Report the common invalid input below. */ }
    return trimmed.includes('/') ? undefined : trimmed
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

  async createUniqueImportDirectory(parentUri, datasetPid) {
    const tail = datasetPid.split('/').map(value => value.trim()).filter(Boolean).at(-1)
    const base = (tail || datasetPid)
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/\s+/g, ' ').trim().replace(/^\.+$/, '') || 'ro-crate-import'
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

  datasetUrl(baseUrl, pid) {
    const base = String(baseUrl).trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '')
    const encodedPid = encodeURIComponent(pid).replace(/%3A/gi, ':').replace(/%2F/gi, '/')
    return `${base}/dataset.xhtml?persistentId=${encodedPid}`
  }
}

module.exports = { ArpImportOperation, ARCHIVE_NAME }

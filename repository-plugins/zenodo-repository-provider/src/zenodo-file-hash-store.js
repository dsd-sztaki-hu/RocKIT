// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const FILE_HASH_STORE = 'file-hashes.json'

class ZenodoFileHashStore {
  constructor({ vscode, now = () => new Date() }) {
    this.vscode = vscode
    this.now = now
  }

  async readFileHashes(rootUri) {
    return (await this.read(rootUri)).files
  }

  isFileRecordUnchanged(stored, comparison) {
    const localLastModified = comparison.localLastModified
    const localSize = comparison.localSize
    if (
      !stored ||
      localLastModified === undefined ||
      !Number.isFinite(localLastModified) ||
      localSize === undefined ||
      !Number.isFinite(localSize)
    ) {
      return false
    }
    const remoteMd5 = this.normalizeMd5(comparison.remoteMd5)
    if (!remoteMd5 || remoteMd5 !== stored.md5) {
      return false
    }
    if (
      comparison.remoteSize !== undefined &&
      Number.isFinite(comparison.remoteSize) &&
      comparison.remoteSize !== localSize
    ) {
      return false
    }
    if (stored.sourceSize !== localSize) {
      return false
    }
    return Date.parse(stored.sourceLastModifiedAt) === Math.trunc(localLastModified)
  }

  async recordKnownHash(rootUri, localFileId, lastModified, sourceSize, md5) {
    const normalizedMd5 = this.normalizeMd5(md5)
    if (
      !normalizedMd5 ||
      lastModified === undefined ||
      !Number.isFinite(lastModified) ||
      sourceSize === undefined ||
      !Number.isFinite(sourceSize)
    ) {
      return false
    }
    const store = await this.read(rootUri)
    store.files[localFileId] = {
      md5: normalizedMd5,
      hashUpdatedAt: this.now().toISOString(),
      sourceLastModifiedAt: new Date(lastModified).toISOString(),
      sourceSize,
    }
    await this.write(rootUri, store)
    return true
  }

  async read(rootUri) {
    const uri = this.vscode.Uri.joinPath(rootUri, '.rockit', FILE_HASH_STORE)
    try {
      const parsed = JSON.parse(
        new TextDecoder().decode(await this.vscode.workspace.fs.readFile(uri)),
      )
      if (!this.record(parsed) || !this.record(parsed.files)) {
        return { files: {} }
      }
      const files = {}
      for (const [id, value] of Object.entries(parsed.files)) {
        if (!this.record(value)) continue
        const md5 = this.normalizeMd5(value.md5)
        const hashUpdatedAt = this.validDate(value.hashUpdatedAt)
        const sourceLastModifiedAt = this.validDate(value.sourceLastModifiedAt)
        const sourceSize = Number.isFinite(value.sourceSize) ? value.sourceSize : undefined
        if (md5 && hashUpdatedAt && sourceLastModifiedAt && sourceSize !== undefined) {
          files[id] = { md5, hashUpdatedAt, sourceLastModifiedAt, sourceSize }
        }
      }
      return { files }
    } catch {
      return { files: {} }
    }
  }

  async write(rootUri, store) {
    const rockitUri = this.vscode.Uri.joinPath(rootUri, '.rockit')
    await this.vscode.workspace.fs.createDirectory(rockitUri)
    const sortedFiles = Object.fromEntries(
      Object.entries(store.files).sort(([left], [right]) => left.localeCompare(right)),
    )
    const content = new TextEncoder().encode(
      `${JSON.stringify({ files: sortedFiles }, null, 2)}\n`,
    )
    await this.vscode.workspace.fs.writeFile(
      this.vscode.Uri.joinPath(rockitUri, FILE_HASH_STORE),
      content,
    )
  }

  normalizeMd5(value) {
    if (typeof value !== 'string') return undefined
    const normalized = value.trim().replace(/^md5:/i, '').toLowerCase()
    return /^[a-f0-9]{32}$/.test(normalized) ? normalized : undefined
  }

  validDate(value) {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined
  }

  record(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
  }
}

module.exports = { FILE_HASH_STORE, ZenodoFileHashStore }

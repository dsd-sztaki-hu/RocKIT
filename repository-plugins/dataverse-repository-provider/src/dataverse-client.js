// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

class DataverseClient {
  constructor({ baseUrl, token, fetchImpl = fetch, timeoutMs = 120000 }) {
    this.baseUrl = String(baseUrl || '')
      .trim()
      .replace(/\/+$/, '')
      .replace(/\/api\/v1$/i, '')
    if (!this.baseUrl) throw new Error('Repository base URL is empty.')
    this.token = token
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
  }

  getRootDataverse() {
    return this.request(`${this.baseUrl}/api/dataverses/root`)
  }

  getCurrentUser() {
    return this.request(`${this.baseUrl}/api/v1/users/:me`)
  }

  getCurrentApiToken() {
    return this.request(`${this.baseUrl}/api/v1/users/token`)
  }

  async supportsRepository() {
    const root = await this.getRootDataverse()
    return Boolean(
      this.success(root) &&
      typeof root.payload?.data?.id === 'number' &&
      root.payload?.data?.alias === 'root'
    )
  }

  createDataset(collectionId, payload) {
    return this.request(
      `${this.baseUrl}/api/v1/dataverses/${encodeURIComponent(collectionId)}/datasets`,
      { method: 'POST', body: JSON.stringify(payload) },
    )
  }

  getCollectionMetadataBlocks(collectionId) {
    return this.request(
      `${this.baseUrl}/api/dataverses/${encodeURIComponent(collectionId)}/metadatablocks`,
    )
  }

  getCollection(collectionId) {
    return this.request(
      `${this.baseUrl}/api/v1/dataverses/${encodeURIComponent(collectionId)}?returnChildCount=true`,
    )
  }

  getCollectionContents(collectionId) {
    return this.request(
      `${this.baseUrl}/api/v1/dataverses/${encodeURIComponent(collectionId)}/contents`,
    )
  }

  searchCollections({ query = '*', subtree, perPage = 100, start = 0, queryEntities } = {}) {
    const url = new URL(`${this.baseUrl}/api/v1/search`)
    url.searchParams.set('q', query)
    url.searchParams.set('type', 'dataverse')
    url.searchParams.set('sort', 'name')
    url.searchParams.set('order', 'asc')
    url.searchParams.set('per_page', String(perPage))
    url.searchParams.set('start', String(start))
    if (subtree) url.searchParams.set('subtree', subtree)
    if (queryEntities !== undefined) url.searchParams.set('query_entities', String(queryEntities))
    return this.request(url.toString())
  }

  getCollectionUserPermissions(collectionId) {
    return this.request(
      `${this.baseUrl}/api/v1/dataverses/${encodeURIComponent(collectionId)}/userPermissions`,
    )
  }

  deleteDraft(persistentId) {
    const url = new URL(`${this.baseUrl}/api/datasets/:persistentId/versions/:draft`)
    url.searchParams.set('persistentId', persistentId)
    return this.request(url.toString(), { method: 'DELETE' })
  }

  getDatasetVersion(persistentId, version = ':draft') {
    const url = new URL(`${this.baseUrl}/api/datasets/:persistentId/versions/${version}`)
    url.searchParams.set('persistentId', persistentId)
    return this.request(url.toString())
  }

  downloadJsonFile(fileId) {
    return this.request(
      `${this.baseUrl}/api/access/datafile/${encodeURIComponent(fileId)}`,
    )
  }

  downloadFile(fileId) {
    return this.downloadBytes(
      `${this.baseUrl}/api/access/datafile/${encodeURIComponent(fileId)}`,
    )
  }

  downloadDatasetZip(persistentId) {
    const url = new URL(`${this.baseUrl}/api/access/dataset/:persistentId/`)
    url.searchParams.set('persistentId', persistentId)
    return this.downloadBytes(url.toString(), { accept: 'application/zip' })
  }

  replaceFile(fileId, entryPath, content) {
    const normalized = String(entryPath || '')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
    const separator = normalized.lastIndexOf('/')
    const directory = separator === -1 ? '' : normalized.slice(0, separator)
    const filename = normalized.slice(separator + 1)
    if (!filename) throw new Error('Cannot replace a file without a filename.')
    const form = new FormData()
    form.append('file', new Blob([content]), filename)
    form.append(
      'jsonData',
      JSON.stringify({
        forceReplace: false,
        ...(directory ? { directoryLabel: directory } : {}),
      }),
    )
    return this.request(
      `${this.baseUrl}/api/files/${encodeURIComponent(fileId)}/replace`,
      {
        method: 'POST',
        body: form,
      },
    )
  }

  deleteFile(fileId) {
    return this.request(`${this.baseUrl}/api/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
    })
  }

  updateDraftMetadata(persistentId, payload) {
    const url = new URL(`${this.baseUrl}/api/datasets/:persistentId/versions/:draft`)
    url.searchParams.set('persistentId', persistentId)
    return this.request(url.toString(), {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  updateDatasetLicense(datasetId, payload) {
    return this.request(
      `${this.baseUrl}/api/datasets/${encodeURIComponent(String(datasetId))}/license`,
      { method: 'PUT', body: JSON.stringify(payload) },
    )
  }

  uploadFile(persistentId, entryPath, content) {
    const normalized = String(entryPath || '')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
    const separator = normalized.lastIndexOf('/')
    const directory = separator === -1 ? '' : normalized.slice(0, separator)
    const filename = normalized.slice(separator + 1)
    if (!filename) throw new Error('Cannot upload a file without a filename.')
    const form = new FormData()
    form.append('file', new Blob([content]), filename)
    form.append(
      'jsonData',
      JSON.stringify(directory ? { directoryLabel: directory } : {}),
    )
    return this.request(
      `${this.baseUrl}/api/v1/datasets/:persistentId/add?persistentId=${encodeURIComponent(persistentId)}`,
      { method: 'POST', body: form },
    )
  }

  async validateConnection() {
    if (!this.token) throw new Error('A Dataverse API token is required.')

    const root = await this.getRootDataverse()
    if (!(
      this.success(root) &&
      typeof root.payload?.data?.id === 'number' &&
      root.payload?.data?.alias === 'root'
    )) {
      throw new Error(
        `The server does not expose a compatible Dataverse API (${root.status}) at ${root.url}.`,
      )
    }

    const user = await this.getCurrentUser()
    if (!this.success(user) || !user.payload?.data?.id) {
      throw new Error(`Dataverse rejected the API token (${user.status}) at ${user.url}.`)
    }

    let expirationDate
    try {
      const token = await this.getCurrentApiToken()
      if (this.success(token)) expirationDate = this.extractExpirationDate(token.payload)
    } catch {
      // Some Dataverse deployments do not expose token details. Authentication
      // is still valid when the current-user request succeeded.
    }
    return {
      userName:
        this.text(user.payload.data.displayName) ||
        this.text(user.payload.data.identifier) ||
        String(user.payload.data.id),
      ...(expirationDate ? { expirationDate } : {}),
    }
  }

  extractExpirationDate(payload) {
    const direct =
      this.text(payload?.data?.expirationDate) ||
      this.text(payload?.data?.expiryDate) ||
      this.text(payload?.data?.expiresAt)
    const message = this.text(payload?.data?.message)
    const candidate =
      direct ||
      message?.match(
        /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?/,
      )?.[0]
    if (!candidate) return undefined
    const normalized = candidate
      .replace(' ', 'T')
      .replace(/\s+(?=Z$|[+-]\d{2}:?\d{2}$)/, '')
    const date = new Date(normalized)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }

  success(result) {
    return Boolean(result?.ok && result.payload?.status !== 'ERROR')
  }

  async request(url, { method = 'GET', body } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    const headers = { accept: 'application/json' }
    if (typeof body === 'string') headers['content-type'] = 'application/json'
    if (this.token) headers['x-dataverse-key'] = this.token
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        redirect: 'follow',
        signal: controller.signal,
      })
      const text = await response.text()
      let payload = {}
      if (text) {
        try {
          payload = JSON.parse(text)
        } catch {
          payload = text
        }
      }
      return {
        status: response.status,
        ok: response.ok,
        url: response.url || url,
        payload,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async downloadBytes(url, additionalHeaders = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    const headers = { ...additionalHeaders }
    if (this.token) headers['x-dataverse-key'] = this.token
    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: controller.signal,
      })
      const bytes = new Uint8Array(await response.arrayBuffer())
      return { status: response.status, ok: response.ok, url: response.url || url, bytes }
    } finally {
      clearTimeout(timer)
    }
  }

  text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }
}

module.exports = { DataverseClient }

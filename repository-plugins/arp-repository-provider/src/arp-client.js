// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

/**
 * Transport for ARP's RO-Crate endpoints. It intentionally returns HTTP status
 * and parsed payload so operations can retain the existing validation and error
 * handling behavior when they move out of RocKIT.
 */
class ArpClient {
  constructor({ baseUrl, token, fetchImpl = fetch, timeoutMs = 120000 }) {
    this.baseUrl = String(baseUrl || '').trim().replace(/\/+$/, '')
    if (!this.baseUrl) throw new Error('Repository base URL is empty.')
    this.token = token
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
  }

  validateRoCrate(crate) {
    const url = new URL('/api/arp/validateRoCrate', `${this.baseUrl}/`)
    url.searchParams.set('strict', 'true')
    return this.request(url.toString(), { method: 'POST', body: JSON.stringify(crate) })
  }

  getRoCrate(pid) {
    return this.request(`${this.baseUrl}/api/arp/rocrate/${pid}`)
  }

  updateRoCrate(pid, crate) {
    return this.request(`${this.baseUrl}/api/arp/rocrate/${pid}`, {
      method: 'POST', body: JSON.stringify(crate),
    })
  }

  getAllowedMetadataLanguages(collectionId) {
    return this.request(`${this.baseUrl}/api/v1/dataverses/${encodeURIComponent(collectionId)}/allowedMetadataLanguages`)
  }

  createDataset(collectionId, payload) {
    return this.request(`${this.baseUrl}/api/v1/dataverses/${encodeURIComponent(collectionId)}/datasets`, {
      method: 'POST', body: JSON.stringify(payload),
    })
  }

  deleteDraft(pid) {
    const url = new URL(`${this.baseUrl}/api/v1/datasets/:persistentId/versions/:draft`)
    url.searchParams.set('persistentId', pid)
    return this.request(url.toString(), { method: 'DELETE' })
  }

  replaceFile(fileId, entryPath, description, content) {
    const normalized = entryPath.replace(/\\/g, '/').replace(/\/+$/, '')
    const separator = normalized.lastIndexOf('/')
    const directory = separator === -1 ? '' : normalized.slice(0, separator)
    const filename = normalized.slice(separator + 1)
    if (!filename) throw new Error('Cannot replace a file without a filename.')
    const form = new FormData()
    form.append('file', new Blob([content]), filename)
    form.append('jsonData', JSON.stringify({
      forceReplace: false,
      ...(description ? { description } : {}),
      ...(directory ? { directoryLabel: directory } : {}),
    }))
    return this.request(`${this.baseUrl}/api/files/${encodeURIComponent(fileId)}/replace`, {
      method: 'POST', body: form,
    })
  }

  deleteFile(fileId) {
    return this.request(`${this.baseUrl}/api/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
    })
  }

  uploadFile(pid, entryPath, content) {
    const normalized = entryPath.replace(/\\/g, '/').replace(/\/+$/, '')
    const separator = normalized.lastIndexOf('/')
    const directory = separator === -1 ? '' : normalized.slice(0, separator)
    const filename = normalized.slice(separator + 1)
    if (!filename) throw new Error('Cannot upload a file without a filename.')
    const form = new FormData()
    form.append('file', new Blob([content]), filename)
    form.append('jsonData', JSON.stringify(directory ? { directoryLabel: directory } : {}))
    return this.request(`${this.baseUrl}/api/v1/datasets/:persistentId/add?persistentId=${encodeURIComponent(pid)}`, {
      method: 'POST', body: form,
    })
  }

  async supportsRoCrateUpload() {
    const result = await this.request(`${this.baseUrl}/api/arp/uploadRoCrateZip`, {
      method: 'OPTIONS',
    })
    return result.ok && (!result.allow || result.allow.split(',').some(
      method => method.trim().toUpperCase() === 'POST',
    ))
  }

  async validateToken() {
    if (!this.token) throw new Error('An ARP API token is required.')
    const result = await this.request(`${this.baseUrl}/api/v1/users/:me`)
    if (!result.ok || result.payload?.status !== 'OK' || !result.payload?.data?.id) {
      throw new Error(`ARP rejected the API token (${result.status}) at ${result.url}.`)
    }
    return result.payload.data
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
        try { payload = JSON.parse(text) } catch { payload = text }
      }
      return {
        status: response.status,
        ok: response.ok,
        url: response.url || url,
        allow: response.headers?.get('allow') || undefined,
        payload,
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

module.exports = { ArpClient }

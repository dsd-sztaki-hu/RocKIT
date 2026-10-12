// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

class ZenodoApiError extends Error {
  constructor(message, status, url, payload) {
    super(`${message} (${status}) at ${url}: ${payloadSummary(payload)}`)
    this.name = 'ZenodoApiError'
    this.status = status
    this.url = url
    this.payload = payload
  }
}

const DEFAULT_USER_AGENT =
  'RocKIT-Zenodo-Repository-Provider/0.1.0 (+https://github.com/dsd-sztaki-hu/RocKIT)'

class ZenodoClient {
  constructor({
    baseUrl,
    token,
    fetchImpl = globalThis.fetch,
    timeoutMs = 120000,
    userAgent = DEFAULT_USER_AGENT,
  }) {
    if (typeof fetchImpl !== 'function') {
      throw new Error('A fetch implementation is required.')
    }
    this.baseUrl = normalizeBaseUrl(baseUrl)
    this.token = requireText(token, 'A Zenodo API token is required.')
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
    this.userAgent = requireText(userAgent, 'A user agent is required.')
  }

  createDeposition() {
    return this.requestJson(
      '/api/deposit/depositions',
      {
        method: 'POST',
        headers: this.jsonHeaders(),
        body: JSON.stringify({}),
      },
      'Zenodo deposition creation failed',
    )
  }

  getDeposition(depositionId) {
    return this.requestJson(
      `/api/deposit/depositions/${encodeURIComponent(requireText(depositionId, 'A deposition id is required.'))}`,
      { method: 'GET', headers: this.authorizationHeaders() },
      'Zenodo deposition lookup failed',
    )
  }

  updateDepositionMetadata(depositionId, metadata, selfUrl) {
    const path =
      selfUrl ||
      `/api/deposit/depositions/${encodeURIComponent(requireText(depositionId, 'A deposition id is required.'))}`
    return this.requestJson(
      path,
      {
        method: 'PUT',
        headers: this.jsonHeaders(),
        body: JSON.stringify({ metadata }),
      },
      'Zenodo metadata upload failed',
    )
  }

  async listDepositionFiles(depositionId) {
    const payload = await this.requestJson(
      `/api/deposit/depositions/${encodeURIComponent(requireText(depositionId, 'A deposition id is required.'))}/files`,
      { method: 'GET', headers: this.authorizationHeaders() },
      'Zenodo file listing failed',
    )
    if (!Array.isArray(payload)) {
      throw new Error('Zenodo returned an invalid deposition file list.')
    }
    return payload
  }

  uploadFile(bucketUrl, filename, content) {
    const url = `${requireText(bucketUrl, 'A Zenodo bucket URL is required.').replace(/\/+$/, '')}/${encodeURIComponent(requireText(filename, 'A filename is required.'))}`
    return this.requestJson(
      url,
      {
        method: 'PUT',
        headers: {
          ...this.authorizationHeaders(),
          'content-type': 'application/octet-stream',
        },
        body: content,
      },
      `Zenodo file upload failed for '${filename}'`,
    )
  }

  deleteFile(depositionId, fileId) {
    return this.requestJson(
      `/api/deposit/depositions/${encodeURIComponent(requireText(depositionId, 'A deposition id is required.'))}/files/${encodeURIComponent(requireText(fileId, 'A file id is required.'))}`,
      { method: 'DELETE', headers: this.authorizationHeaders() },
      'Zenodo file deletion failed',
    )
  }

  authorizationHeaders() {
    return {
      accept: 'application/json',
      authorization: `Bearer ${this.token}`,
      'user-agent': this.userAgent,
    }
  }

  jsonHeaders() {
    return { ...this.authorizationHeaders(), 'content-type': 'application/json' }
  }

  async requestJson(pathOrUrl, init, errorPrefix) {
    const url = this.resolveUrl(pathOrUrl)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        redirect: 'follow',
        signal: controller.signal,
      })
      const payload = await readResponsePayload(response)
      if (!response.ok) {
        throw new ZenodoApiError(
          errorPrefix,
          response.status,
          response.url || url,
          payload,
        )
      }
      return payload
    } finally {
      clearTimeout(timeout)
    }
  }

  resolveUrl(pathOrUrl) {
    try {
      return new URL(pathOrUrl).toString()
    } catch {
      return new URL(pathOrUrl, `${this.baseUrl}/`).toString()
    }
  }
}

function normalizeBaseUrl(value) {
  const text = requireText(value, 'A Zenodo base URL is required.')
  const parsed = new URL(text)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('The Zenodo base URL must use HTTP or HTTPS.')
  }
  return text.replace(/\/+$/, '').replace(/\/api$/, '')
}

function requireText(value, message) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(message)
  }
  return value.trim()
}

async function readResponsePayload(response) {
  const text = await response.text()
  if (!text) {
    return {}
  }
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function payloadSummary(payload) {
  if (typeof payload === 'string') {
    return payload.slice(0, 500)
  }
  if (payload && typeof payload === 'object') {
    const message = payload.message ?? payload.error ?? payload.details
    if (typeof message === 'string') {
      return message.slice(0, 500)
    }
  }
  try {
    return JSON.stringify(payload).slice(0, 500)
  } catch {
    return String(payload).slice(0, 500)
  }
}

module.exports = { DEFAULT_USER_AGENT, ZenodoApiError, ZenodoClient }

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

class ZenodoDetectOperation {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
  }

  async execute(input) {
    const baseUrl = normalizeBaseUrl(input?.baseUrl)
    if (!baseUrl || typeof this.fetchImpl !== 'function') return { supported: false }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(`${baseUrl}/api/deposit/depositions`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'follow',
        signal: controller.signal,
      })
      return {
        // Zenodo protects this endpoint. A successful response or an explicit
        // authentication/authorization rejection proves that the endpoint
        // exists without requiring or exposing the user's API token.
        supported: [200, 401, 403].includes(response.status),
      }
    } catch {
      return { supported: false }
    } finally {
      clearTimeout(timeout)
    }
  }
}

function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol)) return undefined
    return value.trim().replace(/\/+$/, '').replace(/\/api$/i, '')
  } catch {
    return undefined
  }
}

module.exports = { ZenodoDetectOperation }

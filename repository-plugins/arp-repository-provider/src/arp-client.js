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

  async request(url, { method = 'GET', body } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    const headers = { accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
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
        payload,
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

module.exports = { ArpClient }

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

class ArpDeleteOperation {
  constructor({ clientFactory }) {
    this.clientFactory = clientFactory
  }

  async execute(input, progress = { report() {} }) {
    const repository = input?.repository
    if (!repository || typeof repository !== 'object') {
      throw new Error('The ARP repository configuration is missing.')
    }
    const exportTarget = input?.exportTarget
    if (!exportTarget || typeof exportTarget !== 'object') {
      throw new Error('The ARP export target is missing.')
    }
    const pid = this.text(exportTarget.pid)
    if (!pid) {
      throw new Error('The ARP dataset PID is missing from the export target.')
    }

    progress.report({ message: `Deleting ARP draft ${pid}...` })
    const result = await this.clientFactory(repository).deleteDraft(pid)
    if (!result?.ok || this.isError(result.payload)) {
      throw new Error(
        `The remote repository rejected the deletion (${result?.status ?? 'unknown'}): ` +
          this.payloadSummary(result?.payload),
      )
    }

    return {
      providerId: 'arp',
      remoteId: pid,
      deleted: true,
    }
  }

  text(value) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    return undefined
  }

  isError(payload) {
    return !!payload && typeof payload === 'object' && !Array.isArray(payload) &&
      payload.status === 'ERROR'
  }

  payloadSummary(payload) {
    if (typeof payload === 'string') return payload.slice(0, 400)
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const message = payload.message ?? payload.error
      if (typeof message === 'string') return message.slice(0, 400)
    }
    return JSON.stringify(payload ?? {}).slice(0, 400)
  }
}

module.exports = { ArpDeleteOperation }

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

class DataverseDeleteOperation {
  constructor({ clientFactory }) {
    this.clientFactory = clientFactory
  }

  async execute(input, progress = { report() {} }) {
    const repository = input?.repository
    if (!repository || typeof repository !== 'object') {
      throw new Error('The Dataverse repository configuration is missing.')
    }
    const exportTarget = input?.exportTarget
    if (!exportTarget || typeof exportTarget !== 'object') {
      throw new Error('The Dataverse export target is missing.')
    }
    const persistentId = this.text(exportTarget.pid)
    if (!persistentId) {
      throw new Error(
        'The Dataverse dataset persistent ID is missing from the export target.',
      )
    }

    progress.report({ message: `Deleting Dataverse draft ${persistentId}...` })
    const result = await this.clientFactory(repository).deleteDraft(persistentId)
    if (!result?.ok || this.isError(result.payload)) {
      throw new Error(
        `The remote repository rejected the deletion (${result?.status ?? 'unknown'}): ` +
          this.payloadSummary(result?.payload),
      )
    }

    return {
      providerId: 'dataverse',
      remoteId: persistentId,
      deleted: true,
    }
  }

  text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }

  isError(payload) {
    return (
      !!payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      payload.status === 'ERROR'
    )
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

module.exports = { DataverseDeleteOperation }

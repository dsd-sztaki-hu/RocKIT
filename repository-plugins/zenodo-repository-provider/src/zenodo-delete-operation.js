// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

class ZenodoDeleteOperation {
  constructor({ clientFactory }) {
    this.clientFactory = clientFactory
  }

  async execute(input, progress = { report() {} }) {
    const repository = input?.repository
    if (!repository || typeof repository !== 'object') {
      throw new Error('The Zenodo repository configuration is missing.')
    }
    const exportTarget = input?.exportTarget
    if (!exportTarget || typeof exportTarget !== 'object') {
      throw new Error('The Zenodo export target is missing.')
    }
    const depositionId = this.text(exportTarget.pid)
    if (!depositionId) {
      throw new Error('The Zenodo deposition id is missing from the export target.')
    }

    progress.report({ message: `Deleting Zenodo deposition ${depositionId}...` })
    await this.clientFactory(repository).deleteDeposition(depositionId)
    return {
      providerId: 'zenodo',
      remoteId: depositionId,
      deleted: true,
    }
  }

  text(value) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    return undefined
  }
}

module.exports = { ZenodoDeleteOperation }

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

class ZenodoValidateOperation {
  constructor({ clientFactory }) {
    this.clientFactory = clientFactory
  }

  async execute(input, progress = { report() {} }) {
    const repository = input?.repository
    if (!repository || typeof repository !== 'object') {
      throw new Error('The Zenodo repository configuration is missing.')
    }

    progress.report({ message: 'Validating the Zenodo connection and API token...' })
    await this.clientFactory(repository).listDepositions(1)
    return {
      providerId: 'zenodo',
      valid: true,
      userName: 'Zenodo',
    }
  }
}

module.exports = { ZenodoValidateOperation }

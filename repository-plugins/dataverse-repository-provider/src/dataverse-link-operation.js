// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const { DataverseImportOperation } = require('./dataverse-import-operation')

class DataverseLinkOperation extends DataverseImportOperation {
  async execute(input, progress = { report() {} }) {
    const repository = this.object(input?.repository)
    if (!repository?.baseUrl) {
      throw new Error('The Dataverse repository configuration is missing.')
    }
    const persistentId = this.extractPersistentId(input?.datasetUrl)
    if (!persistentId) {
      throw new Error(
        'Could not extract a dataset persistent ID from the Dataverse dataset URL.',
      )
    }

    progress.report({ message: `Loading Dataverse dataset ${persistentId}...` })
    const version = await this.loadDatasetVersion(
      this.clientFactory(repository),
      persistentId,
    )
    const datasetVersionData = this.object(version.payload?.data)
    if (!datasetVersionData) {
      throw new Error('The Dataverse dataset response did not contain dataset data.')
    }

    return {
      providerId: 'dataverse',
      persistentId,
      target: this.datasetUrl(repository.baseUrl, persistentId),
      remoteDatasetTitle: this.datasetTitle(datasetVersionData),
      remoteFiles: this.remoteFiles(datasetVersionData),
    }
  }

  datasetTitle(value) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const title = this.datasetTitle(item)
        if (title) return title
      }
      return undefined
    }
    const record = this.object(value)
    if (!record) return undefined
    if (record.typeName === 'title') return this.text(record.value)
    for (const item of Object.values(record)) {
      const title = this.datasetTitle(item)
      if (title) return title
    }
    return undefined
  }

  remoteFiles(value) {
    if (Array.isArray(value)) {
      return value.flatMap(item => this.remoteFiles(item))
    }
    const record = this.object(value)
    if (!record) return []
    const dataFile = this.object(record.dataFile)
    if (dataFile) {
      const id = typeof dataFile.id === 'number'
        ? String(dataFile.id)
        : this.text(dataFile.id)
      const name = this.text(record.label) || this.text(dataFile.filename)
      if (id && name) {
        const directory = this.text(record.directoryLabel) ||
          this.text(dataFile.directoryLabel)
        return [{
          id,
          path: [directory, name].filter(Boolean).join('/').replace(/\\/g, '/'),
        }]
      }
    }
    return Object.values(record).flatMap(item => this.remoteFiles(item))
  }
}

module.exports = { DataverseLinkOperation }

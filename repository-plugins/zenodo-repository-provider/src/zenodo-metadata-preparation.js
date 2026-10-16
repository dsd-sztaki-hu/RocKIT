// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const {
  buildZenodoMetadataFromCrosswalk,
  missingRequiredZenodoMetadataFields,
  zenodoMetadataOptions,
} = require('../lib/zenodo-metadata-crosswalk')

const PROMPT_REQUIRED_METADATA_COMMAND = 'rockit.repositories.promptRequiredMetadata'

class ZenodoMetadataPromptCancelledError extends Error {
  constructor() {
    super('Zenodo export was cancelled while completing required metadata.')
    this.name = 'ZenodoMetadataPromptCancelledError'
  }
}

class ZenodoMetadataPreparation {
  constructor({ vscode }) {
    this.vscode = vscode
  }

  async prepare(crate, client, crosswalk) {
    const { metadata, diagnostics } = buildZenodoMetadataFromCrosswalk(crate, crosswalk)
    let missing = missingRequiredZenodoMetadataFields(metadata, crosswalk)
    const fallbackAccessRight = diagnostics.some(
      (diagnostic) =>
        diagnostic.targetField === 'access_right' && diagnostic.outcome === 'defaulted',
    )
    const needsAccessPolicy = missing.some((field) =>
      ['access_right', 'license', 'embargo_date', 'access_conditions'].includes(field),
    )

    if (fallbackAccessRight || needsAccessPolicy) {
      const supplied = await this.promptForAccessPolicy(metadata, client, crosswalk)
      Object.assign(metadata, supplied)
      for (const field of ['license', 'embargo_date', 'access_conditions']) {
        if (!Object.hasOwn(supplied, field)) {
          delete metadata[field]
        }
      }
      missing = missingRequiredZenodoMetadataFields(metadata, crosswalk)
    }

    if (missing.length) {
      throw new Error(
        `The RO-Crate cannot be exported to Zenodo because these required metadata fields are missing: ${missing.join(', ')}.`,
      )
    }
    return metadata
  }

  async promptForAccessPolicy(metadata, client, crosswalk) {
    const defaultLicense =
      this.text(metadata.license) ||
      (metadata.upload_type === 'dataset' ? 'cc-zero' : 'cc-by')
    const loadedLicenses = await this.loadLicenseOptions(client, crosswalk)
    const licenses = loadedLicenses.some((option) => option.value === defaultLicense)
      ? loadedLicenses
      : [
          { value: defaultLicense, label: `${defaultLicense} (current value)` },
          ...loadedLicenses,
        ]
    const supplied = await this.vscode.commands.executeCommand(
      PROMPT_REQUIRED_METADATA_COMMAND,
      {
        kind: 'form',
        title: 'Required Zenodo Metadata',
        description: 'Complete the repository-required values that could not be mapped from the RO-Crate.',
        acceptLabel: 'Export',
        fields: [
          {
            id: 'access_right',
            label: 'Access right',
            type: 'select',
            required: true,
            defaultValue: this.text(metadata.access_right) || 'open',
            options: zenodoMetadataOptions('access_right', crosswalk),
          },
          {
            id: 'license',
            label: 'License',
            type: 'select',
            required: true,
            searchable: true,
            defaultValue: defaultLicense,
            options: licenses,
            visibleWhen: { field: 'access_right', values: ['open', 'embargoed'] },
            description: 'The selected license applies to all files in this deposition. Zenodo licenses the metadata separately under Creative Commons Zero.',
          },
          {
            id: 'embargo_date',
            label: 'Embargo end date',
            type: 'date',
            required: true,
            defaultValue: this.text(metadata.embargo_date) || '',
            visibleWhen: { field: 'access_right', values: ['embargoed'] },
          },
          {
            id: 'access_conditions',
            label: 'Access conditions',
            type: 'textarea',
            required: true,
            defaultValue: this.text(metadata.access_conditions) || '',
            visibleWhen: { field: 'access_right', values: ['restricted'] },
          },
        ],
      },
    )
    if (!this.object(supplied)) {
      throw new ZenodoMetadataPromptCancelledError()
    }
    return supplied
  }

  async loadLicenseOptions(client, crosswalk) {
    const fallback = this.withDefaultLicenses(zenodoMetadataOptions('license', crosswalk))
    try {
      const payload = await client.listLicenses()
      const options = this.licenseResources(payload).flatMap((resource) => {
        const metadata = this.object(resource.metadata) || resource
        const value = this.text(metadata.id) || this.text(resource.id)
        if (!value) {
          return []
        }
        const title = this.text(metadata.title) || this.text(resource.title)
        return [
          { value, label: title && title !== value ? `${title} (${value})` : value },
        ]
      })
      if (!options.length) {
        return fallback
      }
      return this.withDefaultLicenses(
        Array.from(
          new Map(options.map((option) => [option.value, option])).values(),
        ).sort((left, right) => left.label.localeCompare(right.label)),
      )
    } catch (error) {
      console.warn('Could not load Zenodo licenses; using crosswalk vocabulary.', error)
      return fallback
    }
  }

  licenseResources(payload) {
    if (Array.isArray(payload)) {
      return payload.filter((item) => this.object(item))
    }
    const hits = this.object(payload)?.hits
    const nested = this.object(hits)?.hits
    return Array.isArray(nested) ? nested.filter((item) => this.object(item)) : []
  }

  withDefaultLicenses(options) {
    const byValue = new Map(options.map((option) => [option.value, option]))
    for (const value of ['cc-zero', 'cc-by']) {
      if (!byValue.has(value)) {
        byValue.set(value, { value, label: value })
      }
    }
    return Array.from(byValue.values())
  }

  text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }

  object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  }
}

module.exports = {
  PROMPT_REQUIRED_METADATA_COMMAND,
  ZenodoMetadataPreparation,
  ZenodoMetadataPromptCancelledError,
}

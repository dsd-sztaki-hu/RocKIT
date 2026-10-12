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

const ACCESS_RIGHTS = [
  { value: 'open', label: 'Open' },
  { value: 'embargoed', label: 'Embargoed' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'closed', label: 'Closed' },
]

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

  async prepare(crate, client) {
    const { metadata, diagnostics } = buildZenodoMetadataFromCrosswalk(crate)
    let missing = missingRequiredZenodoMetadataFields(metadata)
    const fallbackAccessRight = diagnostics.some(
      (diagnostic) =>
        diagnostic.targetField === 'access_right' && diagnostic.outcome === 'defaulted',
    )
    const needsAccessPolicy = missing.some((field) =>
      ['access_right', 'license', 'embargo_date', 'access_conditions'].includes(field),
    )

    if (fallbackAccessRight || needsAccessPolicy) {
      const supplied = await this.promptForAccessPolicy(metadata, client)
      Object.assign(metadata, supplied)
      for (const field of ['license', 'embargo_date', 'access_conditions']) {
        if (!Object.hasOwn(supplied, field)) {
          delete metadata[field]
        }
      }
      missing = missingRequiredZenodoMetadataFields(metadata)
    }

    if (missing.length) {
      throw new Error(
        `The RO-Crate cannot be exported to Zenodo because these required metadata fields are missing: ${missing.join(', ')}.`,
      )
    }
    return metadata
  }

  async promptForAccessPolicy(metadata, client) {
    const currentAccessRight = this.text(metadata.access_right) || 'open'
    const accessRight = await this.pick(
      'Required Zenodo Metadata',
      'Select the access right for this deposition',
      ACCESS_RIGHTS,
      currentAccessRight,
    )
    const result = { access_right: accessRight }

    if (accessRight === 'open' || accessRight === 'embargoed') {
      const defaultLicense =
        this.text(metadata.license) ||
        (metadata.upload_type === 'dataset' ? 'cc-zero' : 'cc-by')
      const loadedLicenses = await this.loadLicenseOptions(client)
      const licenses = loadedLicenses.some((option) => option.value === defaultLicense)
        ? loadedLicenses
        : [
            { value: defaultLicense, label: `${defaultLicense} (current value)` },
            ...loadedLicenses,
          ]
      result.license = await this.pick(
        'Required Zenodo Metadata',
        'Select the license that applies to all files',
        licenses,
        defaultLicense,
      )
    }

    if (accessRight === 'embargoed') {
      result.embargo_date = await this.input(
        'Required Zenodo Metadata',
        'Enter the embargo end date (YYYY-MM-DD)',
        this.text(metadata.embargo_date),
        (value) =>
          /^\d{4}-\d{2}-\d{2}$/.test(value) ? undefined : 'Use the YYYY-MM-DD format.',
      )
    }

    if (accessRight === 'restricted') {
      result.access_conditions = await this.input(
        'Required Zenodo Metadata',
        'Describe the conditions under which access may be granted',
        this.text(metadata.access_conditions),
        (value) => (value.trim() ? undefined : 'Access conditions are required.'),
      )
    }

    return result
  }

  async loadLicenseOptions(client) {
    const fallback = this.withDefaultLicenses(zenodoMetadataOptions('license'))
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

  async pick(title, placeHolder, options, selectedValue) {
    const ordered = [
      ...options.filter((option) => option.value === selectedValue),
      ...options.filter((option) => option.value !== selectedValue),
    ]
    const selected = await this.vscode.window.showQuickPick(
      ordered.map((option) => ({
        label: option.label,
        description: option.value,
        value: option.value,
      })),
      { title, placeHolder, matchOnDescription: true },
    )
    if (!selected) {
      throw new ZenodoMetadataPromptCancelledError()
    }
    return selected.value
  }

  async input(title, prompt, value, validateInput) {
    const selected = await this.vscode.window.showInputBox({
      title,
      prompt,
      value: value || '',
      ignoreFocusOut: true,
      validateInput,
    })
    if (selected === undefined) {
      throw new ZenodoMetadataPromptCancelledError()
    }
    return selected.trim()
  }

  text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }

  object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  }
}

module.exports = {
  ACCESS_RIGHTS,
  ZenodoMetadataPreparation,
  ZenodoMetadataPromptCancelledError,
}

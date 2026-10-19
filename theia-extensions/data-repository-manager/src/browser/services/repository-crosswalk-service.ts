// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { inject, injectable } from 'inversify'
import { CrosswalkRegistry } from 'crosswalk-manager/lib/browser/crosswalk-registry'
import {
  applyZenodoMetadataToRoCrate,
  buildZenodoMetadataFromCrosswalk,
  missingRequiredZenodoMetadataFields,
  zenodoMetadataOptions,
} from 'crosswalk-manager/lib/browser/zenodo-crosswalk-engine'

import { RepositoryRequiredMetadataDialog } from '../components/repository-required-metadata-dialog'

type JsonObject = Record<string, unknown>

export interface PrepareRepositoryMetadataInput {
  repositoryType: string
  crosswalkId: string
  crate: JsonObject
  existingMetadata?: JsonObject
  forUpdate?: boolean
  repositoryOptions?: Record<string, Array<{ value: string; label: string }>>
}

export interface ApplyRepositoryMetadataInput {
  repositoryType: string
  crosswalkId: string
  crate: JsonObject
  metadata: JsonObject
}

const PRESERVED_ZENODO_ACCESS_FIELDS = [
  'access_right',
  'license',
  'embargo_date',
  'access_conditions',
]

/**
 * Application-owned crosswalk boundary around repository operations.
 *
 * RocKIT maps metadata before invoking a provider and maps its response after
 * it returns. Providers never receive crosswalk documents or call this service.
 */
@injectable()
export class RepositoryCrosswalkService {
  constructor(
    @inject(CrosswalkRegistry)
    protected readonly registry: CrosswalkRegistry,
  ) {}

  async prepareRepositoryMetadata(input: PrepareRepositoryMetadataInput): Promise<JsonObject> {
    this.requireRepositoryType(input?.repositoryType, 'zenodo')
    const crosswalk = await this.readCrosswalk(input?.crosswalkId)
    const { metadata, diagnostics } = buildZenodoMetadataFromCrosswalk(input.crate, crosswalk)

    if (input.forUpdate) {
      const missing = missingRequiredZenodoMetadataFields(metadata, crosswalk)
        .filter(field => !PRESERVED_ZENODO_ACCESS_FIELDS.includes(field))
      if (missing.length) {
        throw new Error(`The RO-Crate cannot update Zenodo because these required metadata fields are missing: ${missing.join(', ')}.`)
      }
      return metadata
    }

    if (input.existingMetadata) {
      for (const field of PRESERVED_ZENODO_ACCESS_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(input.existingMetadata, field)) {
          metadata[field] = input.existingMetadata[field]
        } else {
          delete metadata[field]
        }
      }
      this.requireCompleteMetadata(metadata, crosswalk, 'update Zenodo')
      return metadata
    }

    let missing = missingRequiredZenodoMetadataFields(metadata, crosswalk)
    const fallbackAccessRight = diagnostics.some(
      diagnostic => diagnostic.targetField === 'access_right' && diagnostic.outcome === 'defaulted',
    )
    const needsAccessPolicy = missing.some(field =>
      PRESERVED_ZENODO_ACCESS_FIELDS.includes(field),
    )

    if (fallbackAccessRight || needsAccessPolicy) {
      const supplied = await this.promptForZenodoAccessPolicy(
        metadata,
        crosswalk,
        input.repositoryOptions?.license ?? [],
      )
      Object.assign(metadata, supplied)
      for (const field of ['license', 'embargo_date', 'access_conditions']) {
        if (!Object.prototype.hasOwnProperty.call(supplied, field)) {
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

  async applyRepositoryMetadata(input: ApplyRepositoryMetadataInput) {
    this.requireRepositoryType(input?.repositoryType, 'zenodo')
    const crosswalk = await this.readCrosswalk(input?.crosswalkId)
    return applyZenodoMetadataToRoCrate(input.crate, input.metadata, crosswalk)
  }

  protected async readCrosswalk(id: string): Promise<JsonObject> {
    if (!id?.trim()) {
      throw new Error('Select a metadata crosswalk for this repository.')
    }
    const document = await this.registry.read(id)
    if (!document) {
      throw new Error(`The selected crosswalk '${id}' is no longer registered.`)
    }
    return document as JsonObject
  }

  protected requireRepositoryType(actual: string, expected: string): void {
    if (actual !== expected) {
      throw new Error(`The application crosswalk engine does not support '${String(actual)}'.`)
    }
  }

  protected requireCompleteMetadata(metadata: JsonObject, crosswalk: JsonObject, action: string): void {
    const missing = missingRequiredZenodoMetadataFields(metadata, crosswalk)
    if (missing.length) {
      throw new Error(
        `The RO-Crate cannot ${action} because these required metadata fields are missing: ${missing.join(', ')}.`,
      )
    }
  }

  protected async promptForZenodoAccessPolicy(
    metadata: JsonObject,
    crosswalk: JsonObject,
    repositoryLicenses: Array<{ value: string; label: string }>,
  ): Promise<JsonObject> {
    const defaultLicense =
      this.text(metadata.license) || (metadata.upload_type === 'dataset' ? 'cc-zero' : 'cc-by')
    const licenses = this.withDefaultLicenses(
      repositoryLicenses.length
        ? repositoryLicenses
        : zenodoMetadataOptions('license', crosswalk),
    )
    if (!licenses.some(option => option.value === defaultLicense)) {
      licenses.unshift({ value: defaultLicense, label: `${defaultLicense} (current value)` })
    }

    const supplied = await new RepositoryRequiredMetadataDialog({
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
    }).open()
    if (!supplied) {
      throw new Error('Zenodo export was cancelled while completing required metadata.')
    }
    return supplied
  }

  protected withDefaultLicenses(options: Array<{ value: string; label: string }>) {
    const byValue = new Map(options.map(option => [option.value, option]))
    for (const value of ['cc-zero', 'cc-by']) {
      if (!byValue.has(value)) {
        byValue.set(value, { value, label: value })
      }
    }
    return Array.from(byValue.values())
  }

  protected text(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }
}

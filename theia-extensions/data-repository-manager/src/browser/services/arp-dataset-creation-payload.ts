// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { nls } from '@theia/core/lib/common/nls'

import type { NativeDataverseDatasetMetadata } from './native-dataverse-export-service'

interface DataverseMetadataField {
  typeName: string
  typeClass: 'primitive' | 'compound' | 'controlledVocabulary'
  multiple: boolean
  value: unknown
}

/** RocKIT-side metadata preparation; the ARP provider receives the finished API payload. */
export function buildArpDatasetCreationPayload(
  datasetMetadata: NativeDataverseDatasetMetadata,
  requiredCitationFields: ReadonlySet<string>,
): Record<string, unknown> {
  const title = datasetMetadata.title.trim()
  const authorNames = uniqueStrings(datasetMetadata.authorNames.map(value => value.trim()))
  const contactEmails = uniqueStrings(datasetMetadata.contactEmails.map(value => value.trim()))
  const descriptions = uniqueStrings(datasetMetadata.descriptions.map(value => value.trim()))
  const subjects = uniqueStrings(datasetMetadata.subjects.map(value => value.trim()))
  const metadataLanguage = datasetMetadata.metadataLanguage?.trim()
  const missing: string[] = []
  if (requiredCitationFields.has('title') && !title) {
    missing.push(nls.localize('rockit/dataRepository/metadataTitle', 'Title'))
  }
  if (requiredCitationFields.has('author') && !authorNames.length) {
    missing.push(nls.localize('rockit/dataRepository/authorName', 'Author Name'))
  }
  if (requiredCitationFields.has('datasetContact') && !contactEmails.length) {
    missing.push(nls.localize('rockit/dataRepository/contactEmail', 'Point of Contact Email'))
  }
  if (requiredCitationFields.has('dsDescription') && !descriptions.length) {
    missing.push(nls.localize('rockit/dataRepository/descriptionText', 'Description Text'))
  }
  if (requiredCitationFields.has('subject') && !subjects.length) {
    missing.push(nls.localize('rockit/dataRepository/subject', 'Subject'))
  }
  if (!metadataLanguage) {
    missing.push(nls.localize('rockit/dataRepository/metadataLanguage', 'Dataset Metadata Language'))
  }
  if (missing.length) {
    throw new Error(nls.localize(
      'rockit/dataRepository/missingRequiredMetadata',
      'Cannot create Dataverse dataset. Missing required metadata: {0}.',
      missing.join(', '),
    ))
  }

  const fields: DataverseMetadataField[] = []
  if (requiredCitationFields.has('title') || title) {
    fields.push(primitiveField('title', false, title))
  }
  if (requiredCitationFields.has('author') || authorNames.length) {
    fields.push(compoundField('author', authorNames.map(authorName => ({
      authorName: primitiveField('authorName', false, authorName),
    }))))
  }
  if (requiredCitationFields.has('datasetContact') || contactEmails.length) {
    fields.push(compoundField('datasetContact', contactEmails.map(datasetContactEmail => ({
      datasetContactEmail: primitiveField('datasetContactEmail', false, datasetContactEmail),
    }))))
  }
  if (requiredCitationFields.has('dsDescription') || descriptions.length) {
    fields.push(compoundField('dsDescription', descriptions.map(dsDescriptionValue => ({
      dsDescriptionValue: primitiveField('dsDescriptionValue', false, dsDescriptionValue),
    }))))
  }
  if (requiredCitationFields.has('subject') || subjects.length) {
    fields.push({ typeName: 'subject', typeClass: 'controlledVocabulary', multiple: true, value: subjects })
  }

  return {
    metadataLanguage,
    datasetVersion: {
      metadataBlocks: {
        citation: { displayName: 'Citation Metadata', fields },
      },
    },
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(value => value.trim() !== '')))
}

function primitiveField(typeName: string, multiple: boolean, value: unknown): DataverseMetadataField {
  return { typeName, typeClass: 'primitive', multiple, value }
}

function compoundField(
  typeName: string,
  values: Array<Record<string, DataverseMetadataField>>,
): DataverseMetadataField {
  return { typeName, typeClass: 'compound', multiple: true, value: values }
}

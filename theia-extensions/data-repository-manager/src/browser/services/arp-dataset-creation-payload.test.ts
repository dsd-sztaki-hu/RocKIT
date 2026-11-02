// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { buildArpDatasetCreationPayload } from './arp-dataset-creation-payload'

describe('ARP dataset creation payload', () => {
  const required = new Set(['title', 'author', 'datasetContact', 'dsDescription', 'subject'])

  it('preserves the current citation field structure and deduplicates values', () => {
    const payload = buildArpDatasetCreationPayload({
      title: ' Example dataset ',
      authorNames: [' Alice ', 'Alice', 'Bob'],
      contactEmails: ['alice@example.org'],
      descriptions: [' Description '],
      subjects: ['Medicine', 'Medicine'],
      metadataLanguage: ' en ',
    }, required)

    expect(payload).toEqual({
      metadataLanguage: 'en',
      datasetVersion: {
        metadataBlocks: {
          citation: {
            displayName: 'Citation Metadata',
            fields: [
              { typeName: 'title', typeClass: 'primitive', multiple: false, value: 'Example dataset' },
              {
                typeName: 'author', typeClass: 'compound', multiple: true,
                value: [
                  { authorName: { typeName: 'authorName', typeClass: 'primitive', multiple: false, value: 'Alice' } },
                  { authorName: { typeName: 'authorName', typeClass: 'primitive', multiple: false, value: 'Bob' } },
                ],
              },
              {
                typeName: 'datasetContact', typeClass: 'compound', multiple: true,
                value: [{ datasetContactEmail: {
                  typeName: 'datasetContactEmail', typeClass: 'primitive', multiple: false, value: 'alice@example.org',
                } }],
              },
              {
                typeName: 'dsDescription', typeClass: 'compound', multiple: true,
                value: [{ dsDescriptionValue: {
                  typeName: 'dsDescriptionValue', typeClass: 'primitive', multiple: false, value: 'Description',
                } }],
              },
              { typeName: 'subject', typeClass: 'controlledVocabulary', multiple: true, value: ['Medicine'] },
            ],
          },
        },
      },
    })
  })

  it('reports required fields before any repository request is made', () => {
    expect(() => buildArpDatasetCreationPayload({
      title: '', authorNames: [], contactEmails: [], descriptions: [], subjects: [],
    }, required)).toThrow(/Title.*Author Name.*Point of Contact Email.*Description Text.*Subject.*Dataset Metadata Language/)
  })

  it('includes meaningful optional fields without requiring them', () => {
    const payload = buildArpDatasetCreationPayload({
      title: '', authorNames: ['Alice'], contactEmails: [], descriptions: [], subjects: [],
      metadataLanguage: 'hu',
    }, new Set())
    expect(payload).toEqual({
      metadataLanguage: 'hu',
      datasetVersion: { metadataBlocks: { citation: {
        displayName: 'Citation Metadata',
        fields: [{
          typeName: 'author', typeClass: 'compound', multiple: true,
          value: [{ authorName: { typeName: 'authorName', typeClass: 'primitive', multiple: false, value: 'Alice' } }],
        }],
      } } },
    })
  })
})

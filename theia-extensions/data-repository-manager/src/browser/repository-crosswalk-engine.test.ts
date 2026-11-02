// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import {
  applyZenodoMetadataToRoCrate,
  buildZenodoMetadataFromCrosswalk,
  missingRequiredZenodoMetadataFields,
  zenodoMetadataOptions,
} from 'crosswalk-manager/lib/browser/zenodo-crosswalk-engine'
import registeredCrosswalk = require('./crosswalks/arp-zenodo-crosswalk.json')

const minimalCrate = (): Record<string, unknown> => ({
  '@context': 'https://w3id.org/ro/crate/1.1/context',
  '@graph': [
    {
      '@id': './',
      '@type': 'Dataset',
      name: 'Example dataset',
      description: 'Example description',
      datePublished: '2026-10-12T12:30:00Z',
    },
  ],
})

describe('application repository crosswalk engine', () => {
  it('maps an RO-Crate root dataset to repository metadata', () => {
    const result = buildZenodoMetadataFromCrosswalk(minimalCrate(), registeredCrosswalk)

    expect(result.metadata).toMatchObject({
      title: 'Example dataset',
      description: 'Example description',
      publication_date: '2026-10-12',
      upload_type: 'dataset',
      access_right: 'open',
    })
  })

  it('derives requirements and options from the registered crosswalk', () => {
    expect(zenodoMetadataOptions('access_right', registeredCrosswalk).map(option => option.value))
      .toEqual(['closed', 'embargoed', 'open', 'restricted'])
    expect(zenodoMetadataOptions('license', registeredCrosswalk).map(option => option.value))
      .toContain('Apache-2.0')
    expect(missingRequiredZenodoMetadataFields({}, registeredCrosswalk)).toEqual([
      'access_right',
      'creators',
      'description',
      'publication_date',
      'title',
      'upload_type',
    ])
  })

  it('applies repository metadata without mutating the input RO-Crate', () => {
    const crate = minimalCrate()
    const result = applyZenodoMetadataToRoCrate(crate, {
      title: 'Updated title',
      description: 'Updated <b>description</b>',
      keywords: ['alpha', 'beta'],
      creators: [{ name: 'Jane Doe', orcid: '0000-0001' }],
    }, registeredCrosswalk)
    const graph = result.crate['@graph'] as Array<Record<string, unknown>>
    const root = graph.find(entity => entity['@id'] === './')

    expect((crate['@graph'] as unknown[]).length).toBe(1)
    expect(root?.title).toBe('Updated title')
    expect(result.updatedFields).toEqual(['description', 'creators', 'keywords', 'title'])
    expect(graph.some(entity => entity['@type'] === 'keyword' && entity.keywordValue === 'alpha'))
      .toBe(true)
  })

  it('does not write repository access policy into unrelated local fields', () => {
    const crate = minimalCrate()
    const root = (crate['@graph'] as Array<Record<string, unknown>>)[0]
    root.conditionsOfAccess = 'Existing local access statement'
    root.accessToSources = 'Existing source access instructions'
    root.distributionDate = '2025-01-01'

    const result = applyZenodoMetadataToRoCrate(crate, {
      access_right: 'restricted',
      access_conditions: 'Contact the record owner.',
      embargo_date: '2030-12-31',
    }, registeredCrosswalk)
    const updatedRoot = (result.crate['@graph'] as Array<Record<string, unknown>>)
      .find(entity => entity['@id'] === './')

    expect(updatedRoot?.conditionsOfAccess).toBe('Existing local access statement')
    expect(updatedRoot?.accessToSources).toBe('Existing source access instructions')
    expect(updatedRoot?.distributionDate).toBe('2025-01-01')
    expect(result.updatedFields).not.toEqual(expect.arrayContaining([
      'access_right',
      'access_conditions',
      'embargo_date',
    ]))
  })
})

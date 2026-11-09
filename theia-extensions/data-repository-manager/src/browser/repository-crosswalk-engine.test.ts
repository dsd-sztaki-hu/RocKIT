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
    expect(buildZenodoMetadataFromCrosswalk(crate, registeredCrosswalk).metadata).not.toHaveProperty('access_conditions')

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

  it('uses declared Schema.org terms and requires an explicit ORCID scheme', () => {
    const orcid = '0000-0002-1825-0097'
    const crate = {
      '@context': ['https://schema.org', { localKeywords: 'https://example.org/keywords', tags: 'https://schema.org/keywords' }],
      '@graph': [
        {
          '@id': './', '@type': 'Dataset', author: [{ '@id': '#ada' }, { '@id': '#other' }],
          tags: ['metadata'], localKeywords: ['ignore'], citation: ['A published reference'],
          measurementMethod: 'Sample counting', measurementTechnique: 'Ignore',
          spatialCoverage: { '@id': '#place' }, conditionsOfAccess: 'Restricted',
        },
        {
          '@id': '#ada', '@type': 'Person', name: 'Ada Lovelace', affiliation: { '@id': '#org' },
          identifier: { '@type': 'PropertyValue', propertyID: 'ORCID', value: orcid },
        },
        {
          '@id': '#other', '@type': 'Person', name: 'Other Author',
          identifier: { '@type': 'PropertyValue', propertyID: 'Local', value: orcid },
        },
        { '@id': '#org', '@type': 'Organization', name: 'Research Institute' },
        { '@id': '#place', '@type': 'City', name: 'Budapest', description: 'Study area', latitude: 47.5 },
      ],
    }
    const { metadata } = buildZenodoMetadataFromCrosswalk(crate, registeredCrosswalk)
    expect(metadata).toMatchObject({
      creators: [{ name: 'Ada Lovelace', affiliation: 'Research Institute', orcid }, { name: 'Other Author' }],
      keywords: ['metadata'], references: ['A published reference'], method: 'Sample counting',
      locations: [{ place: 'Budapest', description: 'Study area' }], access_right: 'open',
    })
    expect(metadata.locations).toEqual([{ place: 'Budapest', description: 'Study area' }])
    expect(metadata).not.toHaveProperty('access_conditions')
    const { crate: updated } = applyZenodoMetadataToRoCrate(crate, {
      creators: [{ name: 'Updated Ada', orcid }],
      keywords: ['schema.org'], method: 'Updated method',
      locations: [{ place: 'Budapest', description: 'Updated area' }],
    }, registeredCrosswalk)
    expect(updated['@graph']).toMatchObject([
      { tags: ['schema.org'], measurementMethod: 'Updated method' },
      { name: 'Updated Ada' },
      { name: 'Other Author' },
      { name: 'Research Institute' },
      { description: 'Updated area' },
    ])
  })

  it('scopes publication fields to the deposited article and its linked journal chain', () => {
    const crate = {
      '@context': 'https://w3id.org/ro/crate/1.1/context',
      '@graph': [
        { '@id': './', '@type': 'ScholarlyArticle', isPartOf: { '@id': '#issue' }, pagination: '25–30' },
        { '@id': '#issue', '@type': 'PublicationIssue', issueNumber: '2', isPartOf: { '@id': '#volume' } },
        { '@id': '#volume', '@type': 'PublicationVolume', volumeNumber: '5', isPartOf: { '@id': '#journal' } },
        { '@id': '#journal', '@type': 'Periodical', name: 'Journal of Examples' },
        { '@id': '#other', '@type': 'PublicationVolume', volumeNumber: '999' },
      ],
    }
    const { metadata } = buildZenodoMetadataFromCrosswalk(crate, registeredCrosswalk)
    expect(metadata).toMatchObject({
      upload_type: 'publication', publication_type: 'article',
      journal_issue: '2', journal_volume: '5', journal_title: 'Journal of Examples', journal_pages: '25–30',
    })
    const { crate: updated } = applyZenodoMetadataToRoCrate(crate, { journal_issue: '3' }, registeredCrosswalk)
    expect(updated['@graph']).toMatchObject([
      { '@id': './' }, { issueNumber: '3' }, { volumeNumber: '5' }, { name: 'Journal of Examples' }, { volumeNumber: '999' },
    ])
  })

  it('reads chapter pagination and the linked book imprint from different entities', () => {
    const crate = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@id': './', '@type': 'Chapter', isPartOf: { '@id': '#book' }, pagination: '10–20' },
        { '@id': '#book', '@type': 'Book', name: 'Parent book', isbn: '978-0-00-000000-0', publisher: { '@id': '#press' } },
        { '@id': '#press', '@type': 'Organization', name: 'Academic Press' },
      ],
    }
    const { metadata } = buildZenodoMetadataFromCrosswalk(crate, registeredCrosswalk)
    expect(metadata).toMatchObject({
      upload_type: 'publication', publication_type: 'section', partof_title: 'Parent book',
      partof_pages: '10–20', imprint_isbn: '978-0-00-000000-0', imprint_publisher: 'Academic Press',
    })
    const { crate: updated } = applyZenodoMetadataToRoCrate(crate, {
      partof_pages: '10–21', imprint_publisher: 'Updated Press',
    }, registeredCrosswalk)
    expect(updated['@graph']).toMatchObject([
      { pagination: '10–21' }, { name: 'Parent book' }, { name: 'Updated Press' },
    ])
  })
})

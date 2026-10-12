// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const {
  applyZenodoMetadataToRoCrate,
  buildZenodoMetadataFromCrosswalk,
  missingRequiredZenodoMetadataFields,
  zenodoMetadataOptions,
} = require('../lib/zenodo-metadata-crosswalk')

const minimalCrate = () => ({
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

describe('Zenodo metadata crosswalk', () => {
  it('maps an RO-Crate root dataset to Zenodo metadata', () => {
    const result = buildZenodoMetadataFromCrosswalk(minimalCrate())

    assert.equal(result.metadata.title, 'Example dataset')
    assert.equal(result.metadata.description, 'Example description')
    assert.equal(result.metadata.publication_date, '2026-10-12')
    assert.equal(result.metadata.upload_type, 'dataset')
    assert.equal(result.metadata.access_right, 'open')
  })

  it('derives required fields and schema-backed options from plugin-owned data', () => {
    assert.deepEqual(
      zenodoMetadataOptions('access_right').map((option) => option.value),
      ['closed', 'embargoed', 'open', 'restricted'],
    )
    assert.deepEqual(missingRequiredZenodoMetadataFields({}), [
      'access_right',
      'creators',
      'description',
      'publication_date',
      'title',
      'upload_type',
    ])
  })

  it('maps Zenodo metadata back without mutating the input RO-Crate', () => {
    const crate = minimalCrate()
    const result = applyZenodoMetadataToRoCrate(crate, {
      title: 'Updated title',
      description: 'Updated <b>description</b>',
      keywords: ['alpha', 'beta'],
      creators: [{ name: 'Jane Doe', orcid: '0000-0001' }],
    })
    const root = result.crate['@graph'].find((entity) => entity['@id'] === './')

    assert.equal(crate['@graph'].length, 1)
    assert.equal(root.title, 'Updated title')
    assert.deepEqual(result.updatedFields, [
      'description',
      'creators',
      'keywords',
      'title',
    ])
    assert.ok(
      result.crate['@graph'].some(
        (entity) => entity['@type'] === 'keyword' && entity.keywordValue === 'alpha',
      ),
    )
  })
})

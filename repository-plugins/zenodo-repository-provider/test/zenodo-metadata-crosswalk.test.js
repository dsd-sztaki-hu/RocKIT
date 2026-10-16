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
const registeredCrosswalk = require('../../../theia-extensions/data-repository-manager/src/browser/crosswalks/arp-zenodo-crosswalk.json')

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
  it('requires RocKIT to supply the repository crosswalk', () => {
    assert.throws(
      () => buildZenodoMetadataFromCrosswalk(minimalCrate()),
      /Select a Zenodo-compatible metadata crosswalk/,
    )
  })

  it('maps an RO-Crate root dataset to Zenodo metadata', () => {
    const result = buildZenodoMetadataFromCrosswalk(minimalCrate(), registeredCrosswalk)

    assert.equal(result.metadata.title, 'Example dataset')
    assert.equal(result.metadata.description, 'Example description')
    assert.equal(result.metadata.publication_date, '2026-10-12')
    assert.equal(result.metadata.upload_type, 'dataset')
    assert.equal(result.metadata.access_right, 'open')
  })

  it('derives required fields and schema-backed options from plugin-owned data', () => {
    assert.deepEqual(
      zenodoMetadataOptions('access_right', registeredCrosswalk).map((option) => option.value),
      ['closed', 'embargoed', 'open', 'restricted'],
    )
    assert.deepEqual(missingRequiredZenodoMetadataFields({}, registeredCrosswalk), [
      'access_right',
      'creators',
      'description',
      'publication_date',
      'title',
      'upload_type',
    ])
  })

  it('uses a crosswalk document supplied by RocKIT', () => {
    const selectedCrosswalk = structuredClone(registeredCrosswalk)
    const titleMapping = selectedCrosswalk.crosswalks.canonicalToZenodo.mappings.find(
      (mapping) => mapping.target.field === 'title',
    )
    titleMapping.mappingStatus = 'repositorySpecific'

    const result = buildZenodoMetadataFromCrosswalk(minimalCrate(), selectedCrosswalk)

    assert.equal(result.metadata.title, undefined)
    assert.equal(
      result.diagnostics.find((diagnostic) => diagnostic.targetField === 'title')?.outcome,
      'omitted',
    )
  })

  it('maps Zenodo metadata back without mutating the input RO-Crate', () => {
    const crate = minimalCrate()
    const result = applyZenodoMetadataToRoCrate(crate, {
      title: 'Updated title',
      description: 'Updated <b>description</b>',
      keywords: ['alpha', 'beta'],
      creators: [{ name: 'Jane Doe', orcid: '0000-0001' }],
    }, registeredCrosswalk)
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

  it('does not write Zenodo access policy into unrelated RO-Crate fields', () => {
    const crate = minimalCrate()
    const root = crate['@graph'][0]
    root.conditionsOfAccess = 'Existing local access statement'
    root.accessToSources = 'Existing source access instructions'
    root.distributionDate = '2025-01-01'

    const result = applyZenodoMetadataToRoCrate(crate, {
      access_right: 'restricted',
      access_conditions: 'Contact the Zenodo record owner.',
      embargo_date: '2030-12-31',
    }, registeredCrosswalk)
    const updatedRoot = result.crate['@graph'].find((entity) => entity['@id'] === './')

    assert.equal(updatedRoot.conditionsOfAccess, 'Existing local access statement')
    assert.equal(updatedRoot.accessToSources, 'Existing source access instructions')
    assert.equal(updatedRoot.distributionDate, '2025-01-01')
    assert.equal(result.updatedFields.includes('access_right'), false)
    assert.equal(result.updatedFields.includes('access_conditions'), false)
    assert.equal(result.updatedFields.includes('embargo_date'), false)
  })
})

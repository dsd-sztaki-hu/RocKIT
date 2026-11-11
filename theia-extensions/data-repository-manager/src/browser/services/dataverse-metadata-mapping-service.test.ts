// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { DataverseMetadataMappingService } from './dataverse-metadata-mapping-service'

describe('Dataverse journal metadata from a cited Schema.org article', () => {
  const service = new DataverseMetadataMappingService()
  const root = {
    '@id': './', '@type': 'Dataset', datePublished: '2026-11-10',
    citation: ['https://example.org/reference', { '@id': '#article' }],
  }
  const article = {
    '@id': '#article', '@type': 'ScholarlyArticle', datePublished: '2026-11-09',
    isPartOf: { '@id': '#issue' },
  }
  const issue = { '@id': '#issue', '@type': 'PublicationIssue', issueNumber: 2 }
  const context = 'https://w3id.org/ro/crate/1.1/context'

  it('exports an issue without a volume or periodical and ignores unrelated dates', async () => {
    const metadataBlocks = await service.buildMetadataBlocks({ '@context': context, '@graph': [root, article, issue] })
    expect(metadataBlocks.journal.fields[0].value).toEqual([{
      journalIssue: { typeName: 'journalIssue', typeClass: 'primitive', multiple: false, value: '2' },
    }])
  })

  it('round-trips issue, volume and publication date to their linked owners', async () => {
    const volume = { '@id': '#volume', '@type': 'PublicationVolume', volumeNumber: '5' }
    const linkedIssue = { ...issue, isPartOf: { '@id': '#volume' }, datePublished: '2026-10-01' }
    const unrelated = { ...volume, '@id': '#unrelated', volumeNumber: '99' }
    const crate = { '@context': context, '@graph': [root, article, linkedIssue, volume, unrelated] }
    const metadataBlocks = await service.buildMetadataBlocks(crate)
    const [row] = metadataBlocks.journal.fields[0].value as Array<Record<string, { value: unknown }>>
    expect(Object.fromEntries(Object.entries(row).map(([key, field]) => [key, field.value]))).toEqual({
      journalIssue: '2', journalVolume: '5', journalPubDate: '2026-10-01',
    })
    row.journalIssue.value = '3'
    row.journalVolume.value = '6'
    row.journalPubDate.value = '2026-10-02'
    const updated = service.applyMetadataBlocksToRoCrate(crate, { metadataBlocks })
    expect(updated.crate['@graph']).toEqual([
      root, article, { ...linkedIssue, issueNumber: '3', datePublished: '2026-10-02' },
      { ...volume, volumeNumber: '6' }, unrelated,
    ])
  })
})

it('exports typed Dataset distributions with download links and skips them on reverse mapping', async () => {
  const service = new DataverseMetadataMappingService()
  const schema = 'https://schema.org/'
  const link = 'https://example.org/dataset.zip'
  const download = { '@id': '#download', '@type': schema + 'DataDownload', [schema + 'contentUrl']: link }
  const input = {
    '@graph': [
      { '@id': './', '@type': 'Dataset', [schema + 'distribution']: [
        { '@id': '#download' }, { '@id': '#missing-url' }, { '@id': '#wrong-type' },
      ] },
      { ...download, [schema + 'name']: 'ZIP archive' },
      { '@id': '#missing-url', '@type': schema + 'DataDownload', [schema + 'name']: 'Label only' },
      { ...download, '@id': '#wrong-type', '@type': schema + 'WebPage' },
      { ...download, '@id': '#unlinked' },
    ],
  }
  const metadataBlocks = await service.buildMetadataBlocks(input)
  expect(metadataBlocks.geospatial.fields).toEqual([{
    typeName: 'geographicDistribution', typeClass: 'compound', multiple: true,
    value: [{
      geographicDistributionLink: {
        typeName: 'geographicDistributionLink', typeClass: 'primitive', multiple: false, value: link,
      },
      geographicDistributionLinkLabel: {
        typeName: 'geographicDistributionLinkLabel', typeClass: 'primitive', multiple: false, value: 'ZIP archive',
      },
    }],
  }])
  expect(service.applyMetadataBlocksToRoCrate(input, { metadataBlocks })).toEqual({
    crate: input, updatedFields: [],
  })
})

describe('Dataverse astronomy acquisition metadata', () => {
  const service = new DataverseMetadataMappingService()
  const schema = 'https://schema.org/'
  const name = schema + 'name'
  const photo = {
    '@id': '#acquisition', '@type': schema + 'PhotographAction',
    [schema + 'result']: { '@id': './' },
    [schema + 'instrument']: { '@id': '#camera' },
    [schema + 'location']: { '@id': '#observatory' },
  }
  const camera = { '@id': '#camera', '@type': schema + 'Product', [name]: 'Survey camera' }
  const observatory = { '@id': '#observatory', '@type': schema + 'Place', [name]: 'Survey observatory' }
  const root = { '@id': './', '@type': 'Dataset' }

  it('maps 3D equipment only for a capture action producing a model in the dataset', async () => {
    const model = { '@id': '#model', '@type': schema + '3DModel' }
    const dataset = { ...root, [schema + 'hasPart']: { '@id': '#model' } }
    const capture = { ...photo, [schema + 'result']: { '@id': '#model' } }
    const input = { '@graph': [dataset, capture, model, camera] }
    const metadataBlocks = await service.buildMetadataBlocks(input)
    expect(Object.keys(metadataBlocks)).toEqual(['3dobjects'])
    expect(metadataBlocks['3dobjects'].fields).toEqual([
      { typeName: '3dEquipment', typeClass: 'primitive', multiple: false, value: 'Survey camera' },
    ])
    metadataBlocks['3dobjects'].fields[0].value = 'Updated camera'
    expect(service.applyMetadataBlocksToRoCrate(input, { metadataBlocks }).crate['@graph']).toEqual([
      dataset, capture, model, { ...camera, [name]: 'Updated camera' },
    ])
    expect(await service.buildMetadataBlocks({ '@graph': [root, capture, model, camera] })).toEqual({})
  })

  it('maps acquisition labels and writes them back to their respective linked entities', async () => {
    const input = { '@graph': [root, photo, camera, observatory] }
    const metadataBlocks = await service.buildMetadataBlocks(input)
    const fields = metadataBlocks.astrophysics.fields
    expect(Object.fromEntries(fields.map(field => [field.typeName, field.value]))).toEqual({
      astroInstrument: ['Survey camera'], astroFacility: ['Survey observatory'],
    })
    for (const field of fields) field.value = ['Updated ' + (field.value as string[])[0]]
    const { crate } = service.applyMetadataBlocksToRoCrate(input, { metadataBlocks })
    expect(crate['@graph']).toEqual([
      root, photo, { ...camera, [name]: 'Updated Survey camera' },
      { ...observatory, [name]: 'Updated Survey observatory' },
    ])
  })

  it('resolves compact acquisition and distribution terms using the crate context', async () => {
    const input = {
      '@context': ['https://w3id.org/ro/crate/1.1/context', {
        instrument: 'https://example.org/instrument',
        cameraUsed: 'https://schema.org/instrument',
      }],
      '@graph': [
        { ...root, distribution: { '@id': '#download' } },
        { '@id': '#acquisition', '@type': 'PhotographAction', result: { '@id': './' },
          cameraUsed: { '@id': '#camera' }, instrument: { '@id': '#other' } },
        { '@id': '#camera', '@type': 'Product', name: 'Survey camera' },
        { '@id': '#other', '@type': 'Product', name: 'Unrelated camera' },
        { '@id': '#download', '@type': 'DataDownload', name: 'Survey data', contentUrl: 'https://example.org/survey.csv' },
      ],
    }
    const metadataBlocks = await service.buildMetadataBlocks(input)
    expect(metadataBlocks.astrophysics.fields[0].value).toEqual(['Survey camera'])
    expect(metadataBlocks.geospatial.fields[0].value).toEqual([expect.objectContaining({
      geographicDistributionLinkLabel: expect.objectContaining({ value: 'Survey data' }),
    })])
    metadataBlocks.astrophysics.fields[0].value = ['Updated camera']
    const { crate } = service.applyMetadataBlocksToRoCrate(input, { metadataBlocks })
    expect(crate['@graph']).toEqual(input['@graph'].map(entity =>
      entity['@id'] === '#camera' ? { ...entity, name: 'Updated camera' } : entity))
  })

  it('ignores unrelated actions and generic actions that happen to produce the dataset', async () => {
    const unrelated = { ...photo, [schema + 'result']: { '@id': '#other-dataset' } }
    const generic = { ...photo, '@id': '#generic', '@type': schema + 'CreateAction' }
    expect(await service.buildMetadataBlocks({ '@graph': [root, unrelated, generic, camera, observatory] })).toEqual({})
  })

  it('preserves instrument names when a repository update has ambiguous ownership', async () => {
    const secondCamera = { ...camera, '@id': '#camera-2', [name]: 'Second camera' }
    const action = {
      ...photo, [schema + 'instrument']: [{ '@id': '#camera' }, { '@id': '#camera-2' }],
    }
    const input = { '@graph': [root, action, camera, secondCamera, observatory] }
    const metadataBlocks = await service.buildMetadataBlocks(input)
    const instrument = metadataBlocks.astrophysics.fields.find(field => field.typeName === 'astroInstrument')!
    expect(instrument.value).toEqual(['Survey camera', 'Second camera'])
    instrument.value = ['Updated camera']
    expect(service.applyMetadataBlocksToRoCrate(input, { metadataBlocks }).crate).toEqual(input)
  })
})

describe('Dataverse collection frequency', () => {
  const service = new DataverseMetadataMappingService()
  const field = 'https://dataverse.org/schema/socialscience/frequencyOfDataCollection'
  const frequency = 'https://schema.org/repeatFrequency'
  const crate = (type = 'https://schema.org/Schedule') => ({
    '@graph': [
      { '@id': './', '@type': 'Dataset', [field]: { '@id': '#collection' } },
      { '@id': '#collection', '@type': type, [frequency]: 'P1M' },
      { '@id': '#unrelated', '@type': 'https://schema.org/Schedule', [frequency]: 'P1D' },
    ],
  })

  it('exports collection frequency and reverses it onto the linked Schedule', async () => {
    const input = crate()
    const metadataBlocks = await service.buildMetadataBlocks(input)
    const mapped = metadataBlocks.socialscience.fields[0]
    expect(mapped.typeName).toBe('frequencyOfDataCollection')
    expect(mapped.value).toBe('P1M')
    mapped.value = 'P3M'
    const result = service.applyMetadataBlocksToRoCrate(input, { metadataBlocks })
    expect(result.crate['@graph']).toEqual([
      input['@graph'][0], { ...input['@graph'][1], [frequency]: 'P3M' }, input['@graph'][2],
    ])
  })

  it('ignores a linked entity with the wrong type and leaves its reference intact', async () => {
    const input = crate('https://schema.org/Event')
    expect(await service.buildMetadataBlocks(input)).toEqual({})
    const metadataBlocks = await service.buildMetadataBlocks(crate())
    expect(service.applyMetadataBlocksToRoCrate(input, { metadataBlocks }).crate).toEqual(input)
  })
})

describe('DataverseMetadataMappingService registry crosswalk support', () => {
  const customCrosswalk = {
    id: 'custom-dataverse',
    name: 'Custom Dataverse',
    repositories: {
      dataverse: {
        blocks: {
          citation: {
            schema: {
              name: 'citation',
              displayName: 'Citation Metadata',
              fields: {
                title: {
                  name: 'title',
                  displayName: 'Title',
                  typeClass: 'primitive',
                  multiple: false,
                },
              },
            },
          },
        },
      },
    },
    crosswalks: {
      canonicalToDataverse: {
        mappings: [
          {
            source: { canonicalCandidates: [{ localName: 'customTitle' }] },
            target: { block: 'citation', field: 'title' },
            mappingStatus: 'exactNameAndProfileMatch',
          },
        ],
      },
    },
  }

  it('builds repository metadata with the supplied registry crosswalk', async () => {
    const service = new DataverseMetadataMappingService()
    const result = await service.buildMetadataBlocks(
      {
        '@graph': [{ '@id': './', '@type': 'Dataset', customTitle: 'Mapped title' }],
      },
      undefined,
      customCrosswalk,
    )

    expect(result.citation.fields).toEqual([
      {
        typeName: 'title',
        typeClass: 'primitive',
        multiple: false,
        value: 'Mapped title',
      },
    ])
  })

  it('rejects a selected crosswalk without Dataverse mappings', async () => {
    const service = new DataverseMetadataMappingService()

    await expect(
      service.buildMetadataBlocks(
        { '@graph': [{ '@id': './', '@type': 'Dataset' }] },
        undefined,
        { id: 'wrong', name: 'Wrong repository' },
      ),
    ).rejects.toThrow('does not contain Dataverse schemas')
  })

  it('does not copy a compound entity name into missing optional child fields', async () => {
    const keywordCrosswalk = {
      repositories: {
        dataverse: {
          blocks: {
            citation: {
              schema: {
                name: 'citation',
                fields: {
                  keyword: {
                    name: 'keyword',
                    typeClass: 'compound',
                    multiple: true,
                    childFields: {
                      keywordValue: {
                        name: 'keywordValue',
                        typeClass: 'primitive',
                        multiple: false,
                      },
                      keywordVocabulary: {
                        name: 'keywordVocabulary',
                        typeClass: 'primitive',
                        multiple: false,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      crosswalks: {
        canonicalToDataverse: {
          mappings: [{
            source: { canonicalCandidates: [{ localName: 'keyword' }] },
            target: {
              block: 'citation',
              field: 'keyword',
              typeClass: 'compound',
              multiple: true,
            },
            mappingStatus: 'exactNameAndProfileMatch',
            children: [
              {
                sourceCandidates: [{ localName: 'keywordValue' }],
                target: { field: 'keywordValue' },
                mappingStatus: 'exactNameAndProfileMatch',
              },
              {
                sourceCandidates: [{ localName: 'keywordVocabulary' }],
                target: { field: 'keywordVocabulary' },
                mappingStatus: 'exactNameAndProfileMatch',
              },
            ],
          }],
        },
      },
    }
    const service = new DataverseMetadataMappingService()
    const metadataBlocks = await service.buildMetadataBlocks(
      {
        '@graph': [
          { '@id': './', '@type': 'Dataset', keyword: { '@id': '#keyword' } },
          { '@id': '#keyword', '@type': 'keyword', name: 'Cica', keywordValue: 'Cica' },
        ],
      },
      undefined,
      keywordCrosswalk,
    )

    const keyword = metadataBlocks.citation.fields[0]
    expect(keyword.value).toEqual([{
      keywordValue: {
        typeName: 'keywordValue',
        typeClass: 'primitive',
        multiple: false,
        value: 'Cica',
      },
    }])

    const reversed = service.applyMetadataBlocksToRoCrate(
      { '@graph': [{ '@id': './', '@type': 'Dataset' }] },
      { metadataBlocks },
      keywordCrosswalk,
    )
    const reversedGraph = reversed.crate['@graph'] as Array<Record<string, unknown>>
    const keywordEntity = reversedGraph
      .find(entity => entity['@type'] === 'keyword')
    expect(keywordEntity).toEqual(expect.objectContaining({
      name: 'Cica',
      keywordValue: 'Cica',
    }))
    expect(keywordEntity).not.toHaveProperty('keywordVocabulary')
  })
})

describe('Dataverse schema.org review and role-scoped names', () => {
  const service = new DataverseMetadataMappingService()
  const field = (name: string, child: string, value: string) => ({
    typeName: name, typeClass: 'compound', multiple: true,
    value: [{ [child]: { typeName: child, typeClass: 'primitive', multiple: false, value } }],
  })
  const version = (...fields: ReturnType<typeof field>[]) => ({ metadataBlocks: { citation: { fields } } })
  const graphOf = (crate: Record<string, unknown>) => crate['@graph'] as Array<Record<string, any>>
  const roleCrate = () => ({ '@graph': [
    { '@id': './', '@type': 'Dataset', author: { '@id': '#author' }, datasetContact: { '@id': '#contact' } },
    { '@id': '#author', '@type': 'Person', name: 'Same display name' },
    { '@id': '#contact', '@type': 'Person', name: 'Same display name', email: 'contact@example.org' },
    { '@id': '#unrelated', '@type': 'author', name: 'Same display name', authorName: 'Unlinked author' },
  ] as Array<Record<string, any>> })

  it('maps entity names only within their author or contact relationship', async () => {
    const blocks = await service.buildMetadataBlocks(roleCrate())
    const author = blocks.citation.fields.find(item => item.typeName === 'author')?.value as any[]
    const contact = blocks.citation.fields.find(item => item.typeName === 'datasetContact')?.value as any[]
    expect(author).toHaveLength(1)
    expect(contact).toHaveLength(1)
    expect(author[0].authorName.value).toBe('Same display name')
    expect(contact[0].datasetContactName.value).toBe('Same display name')
  })

  it.each([
    ['author', 'authorName', '#author', '#contact'],
    ['datasetContact', 'datasetContactName', '#contact', '#author'],
  ])('reverse maps %s names only to their referenced entity', (role, child, selectedId, otherId) => {
    const input = roleCrate()
    const result = service.applyMetadataBlocksToRoCrate(input, version(field(role, child, 'Updated')))
    const graph = graphOf(result.crate)
    expect(graph.find(item => item['@id'] === selectedId)?.name).toBe('Updated')
    expect(graph.find(item => item['@id'] === otherId)?.name).toBe('Same display name')
    expect(graph.find(item => item['@id'] === '#unrelated')?.authorName).toBe('Unlinked author')
    expect(input['@graph'][1].name).toBe('Same display name')
  })

  it.each([
    ['author', 'authorName', '#author'],
    ['datasetContact', 'datasetContactName', '#contact'],
  ])('preserves a distinct display name when updating explicit %s metadata', (role, child, id) => {
    const input = roleCrate()
    const selected = input['@graph'].find(item => item['@id'] === id)!
    selected[child] = 'Explicit native name'
    const result = service.applyMetadataBlocksToRoCrate(input, version(field(role, child, 'Updated native name')))
    const entity = graphOf(result.crate).find(item => item['@id'] === id)
    expect(entity?.[child]).toBe('Updated native name')
    expect(entity?.name).toBe('Same display name')
  })

  it('keeps an existing display name even when its old text matched the explicit name', () => {
    const input = roleCrate()
    input['@graph'][1].authorName = 'Same display name'
    const result = service.applyMetadataBlocksToRoCrate(input,
      version(field('author', 'authorName', 'Updated native name')))
    expect(graphOf(result.crate)[1]).toEqual(expect.objectContaining({
      name: 'Same display name', authorName: 'Updated native name',
    }))
  })

  it('updates a present but empty native name without overwriting the display name', () => {
    const input = roleCrate()
    input['@graph'][1].authorName = ''
    const result = service.applyMetadataBlocksToRoCrate(input, version(field('author', 'authorName', 'New author')))
    expect(graphOf(result.crate)[1]).toEqual(expect.objectContaining({
      name: 'Same display name', authorName: 'New author',
    }))
  })

  it('creates an author instead of borrowing an unrelated entity, even when a generated ID collides', () => {
    const input = { '@graph': [
      { '@id': './', '@type': 'Dataset', datasetContact: { '@id': '#contact' } },
      { '@id': '#contact', '@type': 'Person', name: 'Contact' },
      { '@id': '#author-1', '@type': 'author', name: 'Unlinked', authorName: 'Unlinked' },
    ] }
    const result = service.applyMetadataBlocksToRoCrate(input, version(field('author', 'authorName', 'New author')))
    const graph = graphOf(result.crate)
    expect(graph.find(item => item['@id'] === '#contact')?.name).toBe('Contact')
    expect(graph.find(item => item['@id'] === '#author-1')?.name).toBe('Unlinked')
    const linked = graph.find(item => item['@id'] === graph[0].author['@id'])
    expect(linked?.authorName).toBe('New author')
    expect(linked?.['@id']).not.toBe('#author-1')
  })

  it('uses explicit reverse role relationships when forward links are absent', async () => {
    const input = { '@graph': [
      { '@id': './', '@type': 'Dataset' },
      { '@id': '#author', '@type': 'Person', name: 'Author',
        '@reverse': { author: { '@id': './' } } },
      { '@id': '#contact', '@type': 'Person', name: 'Contact', email: 'contact@example.org',
        '@reverse': { datasetContact: { '@id': './' } } },
    ] }
    const blocks = await service.buildMetadataBlocks(input)
    expect(blocks.citation.fields.filter(item => ['author', 'datasetContact'].includes(item.typeName)))
      .toHaveLength(2)
    const result = service.applyMetadataBlocksToRoCrate(input, version(field('author', 'authorName', 'Updated')))
    expect(graphOf(result.crate).find(item => item['@id'] === '#author')?.name).toBe('Updated')
    expect(graphOf(result.crate).find(item => item['@id'] === '#contact')?.name).toBe('Contact')
  })

  it('reuses the contact entity when the existing contactPoint alias is used', () => {
    const input = roleCrate()
    input['@graph'][0].contactPoint = input['@graph'][0].datasetContact
    delete input['@graph'][0].datasetContact
    const result = service.applyMetadataBlocksToRoCrate(input,
      version(field('datasetContact', 'datasetContactName', 'Updated contact')))
    const graph = graphOf(result.crate)
    expect(graph.find(item => item['@id'] === '#contact')?.name).toBe('Updated contact')
    expect(graph.find(item => item['@id'] === '#author')?.name).toBe('Same display name')
    expect(graph[0]).not.toHaveProperty('datasetContact')
  })

  it('rejects conflicting values for one entity shared by author and contact roles', () => {
    const input = roleCrate()
    input['@graph'][0].datasetContact = { '@id': '#author' }
    const original = JSON.stringify(input)
    expect(() => service.applyMetadataBlocksToRoCrate(input, version(
      field('author', 'authorName', 'Author name'),
      field('datasetContact', 'datasetContactName', 'Contact name'),
    ))).toThrow("Conflicting Dataverse values for entity '#author' property 'name'")
    expect(JSON.stringify(input)).toBe(original)
  })

  it('allows identical values for one entity shared by both roles', () => {
    const input = roleCrate()
    input['@graph'][0].datasetContact = { '@id': '#author' }
    const result = service.applyMetadataBlocksToRoCrate(input, version(
      field('author', 'authorName', 'Shared name'),
      field('datasetContact', 'datasetContactName', 'Shared name'),
    ))
    expect(graphOf(result.crate)[1].name).toBe('Shared name')
  })

  it('uses Dataset name as the title fallback without mapping aliases, inLanguage, or structured keywords', async () => {
    const blocks = await service.buildMetadataBlocks({ '@graph': [
      { '@id': './', '@type': 'Dataset', name: 'Display name', alternateName: 'Alias',
        inLanguage: 'en', keywords: [{ '@id': '#term' }, 'https://example.org/term'] },
      { '@id': '#term', '@type': 'DefinedTerm', name: 'Term',
        inDefinedTermSet: { name: 'Term set', url: 'https://example.org/vocabulary' } },
    ] })
    expect(blocks.citation.fields).toEqual([
      expect.objectContaining({ typeName: 'title', value: 'Display name' }),
    ])
  })

  it('keeps the explicit title ahead of the Dataset name fallback', async () => {
    const blocks = await service.buildMetadataBlocks({ '@graph': [
      { '@id': './', '@type': 'Dataset', title: 'Citation title', name: 'Workspace name' },
    ] })
    expect(blocks.citation.fields.find(item => item.typeName === 'title')?.value).toBe('Citation title')
  })

  it('maps schema.org identifiers, citations, places, and only emailed authors as contact points', async () => {
    const blocks = await service.buildMetadataBlocks({ '@graph': [
      { '@id': './', '@type': 'Dataset', author: [{ '@id': '#emailed' }, { '@id': '#other' }],
        citation: 'https://example.org/citation', spatialCoverage: { '@id': '#place' } },
      { '@id': '#emailed', '@type': 'Person', name: 'Contact Author', email: 'author@example.org',
        affiliation: { '@id': '#org' }, identifier: { '@id': '#orcid' } },
      { '@id': '#other', '@type': 'Person', name: 'Other Author' },
      { '@id': '#org', '@type': 'Organization', name: 'Example Org' },
      { '@id': '#orcid', '@type': 'PropertyValue', name: 'ORCID', value: '0000-0002-1825-0097' },
      { '@id': '#place', '@type': 'Place', name: 'Goodplace' },
    ] })
    const authors = blocks.citation.fields.find(item => item.typeName === 'author')?.value as any[]
    expect(authors[0]).toEqual(expect.objectContaining({
      authorIdentifierScheme: expect.objectContaining({ value: 'ORCID' }),
      authorIdentifier: expect.objectContaining({ value: '0000-0002-1825-0097' }),
    }))
    const contacts = blocks.citation.fields.find(item => item.typeName === 'datasetContact')?.value as any[]
    expect(contacts).toEqual([expect.objectContaining({
      datasetContactName: expect.objectContaining({ value: 'Contact Author' }),
      datasetContactAffiliation: expect.objectContaining({ value: 'Example Org' }),
      datasetContactEmail: expect.objectContaining({ value: 'author@example.org' }),
    })])
    expect(blocks.citation.fields.find(item => item.typeName === 'relatedMaterial')?.value)
      .toEqual(['https://example.org/citation'])
    const coverage = blocks.geospatial.fields.find(item => item.typeName === 'geographicCoverage')?.value as any[]
    expect(coverage[0].otherGeographicCoverage.value).toBe('Goodplace')
  })

  it('prefers an explicit contact and excludes author contacts without a valid email', async () => {
    const blocks = await service.buildMetadataBlocks({ '@graph': [
      { '@id': './', '@type': 'Dataset', author: { '@id': '#author' }, contactPoint: { '@id': '#contact' } },
      { '@id': '#author', '@type': 'Person', name: 'Author', email: 'invalid' },
      { '@id': '#contact', '@type': 'ContactPoint', name: 'Repository contact', email: 'contact@example.org' },
    ] })
    const contacts = blocks.citation.fields.find(item => item.typeName === 'datasetContact')?.value as any[]
    expect(contacts).toHaveLength(1)
    expect(contacts[0].datasetContactEmail.value).toBe('contact@example.org')
  })

  it('keeps native language and plain text keywords', async () => {
    const blocks = await service.buildMetadataBlocks({ '@graph': [
      { '@id': './', '@type': 'Dataset', language: ['English'], keywords: ['water', 'climate'] },
    ] })
    expect(blocks.citation.fields.find(item => item.typeName === 'language')?.value).toEqual(['English'])
    const keywords = blocks.citation.fields.find(item => item.typeName === 'keyword')?.value as any[]
    expect(keywords.map(row => row.keywordValue.value)).toEqual(['water', 'climate'])
  })

  it('does not turn a DefinedTerm name into keyword text through a native keyword link', async () => {
    const blocks = await service.buildMetadataBlocks({ '@graph': [
      { '@id': './', '@type': 'Dataset', keyword: { '@id': '#term' } },
      { '@id': '#term', '@type': 'DefinedTerm', name: 'Term label' },
    ] })
    expect(blocks).toEqual({})
  })

  it('uses the approved schema.org/language pairing and keeps its referenced entity on reverse mapping', async () => {
    const input = { '@graph': [
      { '@id': './', '@type': 'Dataset', 'https://schema.org/language': { '@id': '#language' } },
      { '@id': '#language', '@type': 'Language', name: 'English' },
    ] }
    const blocks = await service.buildMetadataBlocks(input)
    const language = blocks.citation.fields.find(item => item.typeName === 'language')!
    expect(language.value).toEqual(['English'])
    language.value = ['Hungarian']
    const result = service.applyMetadataBlocksToRoCrate(input, { metadataBlocks: blocks })
    expect(graphOf(result.crate)[0]['https://schema.org/language']).toEqual({ '@id': '#language' })
    expect(graphOf(result.crate)[1].name).toBe('Hungarian')
  })

  it('preserves expanded schema.org name keys inside the selected role', () => {
    const input = { '@graph': [
      { '@id': './', '@type': 'Dataset', author: { '@id': '#author' } },
      { '@id': '#author', '@type': 'Person', 'https://schema.org/name': 'Author' },
    ] }
    const result = service.applyMetadataBlocksToRoCrate(input, version(field('author', 'authorName', 'Updated')))
    expect(graphOf(result.crate)[1]).toEqual({
      '@id': '#author', '@type': 'Person', 'https://schema.org/name': 'Updated',
    })
  })

  it('preserves a separate expanded display name when an explicit author name is present', () => {
    const input = { '@graph': [
      { '@id': './', '@type': 'Dataset', author: { '@id': '#author' } },
      { '@id': '#author', '@type': 'Person', 'https://schema.org/name': 'Display label', authorName: 'Native name' },
    ] }
    const result = service.applyMetadataBlocksToRoCrate(input, version(field('author', 'authorName', 'Updated')))
    expect(graphOf(result.crate)[1]).toEqual({
      '@id': '#author', '@type': 'Person', 'https://schema.org/name': 'Display label', authorName: 'Updated',
    })
  })

  it('keeps description mapping available for the ongoing review', async () => {
    const input = { '@graph': [
      { '@id': './', '@type': 'Dataset', description: 'Summary' },
    ] }
    const blocks = await service.buildMetadataBlocks(input)
    const result = service.applyMetadataBlocksToRoCrate(input, { metadataBlocks: blocks })
    expect(await service.buildMetadataBlocks(result.crate)).toEqual(blocks)
  })

  it('keeps place names but omits temporal, journal publication-date and coordinate conversions', async () => {
    const blocks = await service.buildMetadataBlocks({ '@graph': [
      { '@id': './', '@type': 'Dataset', temporalCoverage: '2020/2021', datePublished: '2022-01-01',
        spatialCoverage: { '@id': '#place' }, journalVolumeIssue: { '@id': '#journal' } },
      { '@id': '#place', '@type': 'Place', name: 'Coverage label', geo: { '@id': '#box' } },
      { '@id': '#box', '@type': 'GeoShape', box: '10 20 30 40' },
      { '@id': '#journal', '@type': 'journalVolumeIssue', name: 'Kiskacsa', datePublished: '2023-01-01' },
    ] })
    expect(blocks.citation).toBeUndefined()
    const coverage = blocks.geospatial.fields[0].value as any[]
    expect(coverage[0].otherGeographicCoverage.value).toBe('Coverage label')
    expect(coverage[0]).not.toHaveProperty('westLongitude')
  })

  it('reads the existing native Time Period child fields', async () => {
    const blocks = await service.buildMetadataBlocks({ '@graph': [
      { '@id': './', '@type': 'Dataset', timePeriodCovered: { '@id': '#period' } },
      { '@id': '#period', '@type': 'timePeriodCovered',
        timePeriodCoveredStart: '2020-01-01', timePeriodCoveredEnd: '2020-12-31' },
    ] })
    expect(blocks.citation.fields.find(item => item.typeName === 'timePeriodCovered')?.value)
      .toEqual([{
        timePeriodCoveredStart: expect.objectContaining({ value: '2020-01-01' }),
        timePeriodCoveredEnd: expect.objectContaining({ value: '2020-12-31' }),
      }])
  })
})

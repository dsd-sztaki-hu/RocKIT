// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { DataverseMetadataMappingService } from './dataverse-metadata-mapping-service'

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

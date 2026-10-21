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
})

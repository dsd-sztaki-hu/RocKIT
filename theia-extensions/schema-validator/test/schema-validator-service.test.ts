// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

jest.mock('rockit-common/lib/browser', () => ({
  MetadataSchemaManager: Symbol('MetadataSchemaManager'),
  SchemaValidatorManager: Symbol('SchemaValidatorManager'),
}))

const { SchemaValidatorService } = require('../src/browser/schema-validator-service')

describe('SchemaValidatorService', () => {
  const profile = {
    classes: {
      Dataset: {
        inputs: [
          {
            name: 'name',
            label: 'Title',
            type: ['Text'],
            required: true,
            multiple: false,
          },
          {
            name: 'datasetContact',
            label: 'Point of Contact',
            type: ['datasetContact'],
            required: false,
            multiple: true,
          },
        ],
      },
      datasetContact: {
        inputs: [
          {
            name: 'datasetContactEmail',
            label: 'E-mail',
            type: ['Text'],
            required: true,
            multiple: false,
          },
        ],
      },
    },
  }

  function createService(): any {
    const service = new SchemaValidatorService()
    ;(service as any).schemaManagerService = {
      getMergedProfile: jest.fn(),
    }
    ;(service as any).appStateService = {
      profileList: [],
    }
    return service
  }

  const baseProfileWithoutContactRules = {
    classes: {
      Dataset: {
        inputs: [
          {
            name: 'name',
            label: 'Title',
            type: ['Text'],
            required: true,
            multiple: false,
          },
        ],
      },
    },
  }

  it('keeps non-root required-field errors when a linked entity is added incrementally', async () => {
    const service = createService()
    const initialCrate = {
      '@graph': [
        {
          '@id': './',
          '@type': 'Dataset',
          name: 'Example dataset',
        },
      ],
    }

    await service.validateEntities(initialCrate, profile)

    const crateWithContactMissingEmail = {
      '@graph': [
        {
          '@id': './',
          '@type': 'Dataset',
          name: 'Example dataset',
          datasetContact: [{ '@id': '#contact' }],
        },
        {
          '@id': '#contact',
          '@type': 'datasetContact',
          name: 'Ada Example',
          datasetContactName: 'Ada Example',
        },
      ],
    }

    const errors = await service.validateEntities(crateWithContactMissingEmail, profile)

    expect((service as any).getLastRunMode()).toBe('incremental')
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: '#contact',
          entityType: 'datasetContact',
          fieldName: 'datasetContactEmail',
          errorCode: 'REQUIRED_NOT_SET',
        }),
      ]),
    )
  })

  it('revalidates non-root entities when the complete profile adds required rules', async () => {
    const service = createService()
    const crateWithContactMissingEmail = {
      '@graph': [
        {
          '@id': './',
          '@type': 'Dataset',
          name: 'Example dataset',
          datasetContact: [{ '@id': '#contact' }],
        },
        {
          '@id': '#contact',
          '@type': 'datasetContact',
          name: 'Ada Example',
          datasetContactName: 'Ada Example',
        },
      ],
    }

    const initialErrors = await service.validateEntities(
      crateWithContactMissingEmail,
      baseProfileWithoutContactRules,
    )

    expect(initialErrors).toBeUndefined()

    ;(service as any).appStateService.completeProfile = profile

    const errors = await service.validateEntities(
      crateWithContactMissingEmail,
      baseProfileWithoutContactRules,
    )

    expect((service as any).getLastRunMode()).toBe('full')
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: '#contact',
          entityType: 'datasetContact',
          fieldName: 'datasetContactEmail',
          errorCode: 'REQUIRED_NOT_SET',
        }),
      ]),
    )
  })
})

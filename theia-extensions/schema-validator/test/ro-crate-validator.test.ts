// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { validateEntities } from '../src/browser/ro-crate-validator'
import * as fs from 'fs'
import * as path from 'path'

describe('validateEntities', () => {
  const schemaManager = {
    getMergedProfile: jest.fn(),
  } as any

  it('reports a missing entity name independently of the active profile', async () => {
    const crate = {
      '@graph': [
        {
          '@id': '#contact',
          '@type': 'datasetContact',
        },
      ],
    }

    const errors = await validateEntities(crate, { classes: {} }, [], schemaManager)

    expect(errors).toEqual([
      expect.objectContaining({
        entityId: '#contact',
        entityType: 'datasetContact',
        fieldName: 'name',
        fieldLabel: 'Name',
        errorCode: 'REQUIRED_NOT_SET',
      }),
    ])
  })

  it('does not duplicate a missing-name error from the active profile', async () => {
    const profile = {
      classes: {
        datasetContact: {
          inputs: [
            {
              name: 'name',
              label: 'Name',
              type: ['Text'],
              required: true,
              multiple: false,
            },
          ],
        },
      },
    }
    const crate = {
      '@graph': [
        {
          '@id': '#contact',
          '@type': 'datasetContact',
          name: '   ',
        },
      ],
    }

    const errors = await validateEntities(crate, profile, [], schemaManager)

    expect(errors?.filter(error => error.fieldName === 'name')).toHaveLength(1)
  })

  it('reports required-field errors on linked non-root entities', async () => {
    const profile = {
      classes: {
        Dataset: {
          inputs: [
            {
              name: 'datasetContact',
              label: 'Point of Contact',
              type: ['datasetContact'],
              required: true,
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
    const crate = {
      '@graph': [
        {
          '@id': './',
          '@type': 'Dataset',
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

    const errors = await validateEntities(crate, profile, [], schemaManager)

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

  it('reports missing point-of-contact email with the bundled Dataverse profile', async () => {
    const profile = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../app-state/data/profile.json'), 'utf8'),
    )
    const crate = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../app-state/data/crate.json'), 'utf8'),
    )
    const contact = crate['@graph'].find(
      (entity: any) => entity?.['@type'] === 'datasetContact',
    )
    expect(contact).toBeTruthy()
    delete contact.datasetContactEmail

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    let errors
    try {
      errors = await validateEntities(crate, profile, [], schemaManager)
    } finally {
      warnSpy.mockRestore()
    }

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: contact['@id'],
          entityType: 'datasetContact',
          fieldName: 'datasetContactEmail',
          errorCode: 'REQUIRED_NOT_SET',
        }),
      ]),
    )
  })

  it('uses the complete profile for non-file and non-dataset entities without conformsTo', async () => {
    const baseProfile = {
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
    const completeProfile = {
      ...baseProfile,
      classes: {
        ...baseProfile.classes,
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
    const crate = {
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

    const errors = await validateEntities(crate, baseProfile, [], schemaManager, {
      completeProfile,
    })

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

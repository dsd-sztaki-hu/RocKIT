// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { validate, validateEntities } from '../src/browser/ro-crate-validator'
import * as fs from 'fs'
import * as path from 'path'

describe('validateEntities', () => {
  const schemaManager = {
    getMergedProfile: jest.fn(),
  } as any

  function validateField(
    input: Record<string, any>,
    fieldValue: any,
  ) {
    return validate(
      {
        '@id': '#entity',
        '@type': 'Thing',
        name: 'Example entity',
        field: fieldValue,
      },
      {
        classes: {
          Thing: {
            inputs: [{ name: 'field', label: 'Field', ...input }],
          },
        },
      },
    ).filter(error => error.fieldName === 'field')
  }

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

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['blank text', '   '],
    ['an empty array', []],
  ])('treats %s as a missing required value', (_label, fieldValue) => {
    const errors = validateField(
      { type: ['Text'], required: true, multiple: true },
      fieldValue,
    )

    expect(errors).toEqual([
      expect.objectContaining({ errorCode: 'REQUIRED_NOT_SET' }),
    ])
  })

  it.each([
    ['a non-URL array', ['first', 'second'], 'Text', ['SINGLE_VALUE_REQUIRED']],
    ['a URL array', ['https://example.test'], 'URL', []],
    ['an empty required URL array', [], 'URL', ['REQUIRED_NOT_SET']],
  ])('validates single-value cardinality for %s', (_label, fieldValue, inputType, expectedCodes) => {
    const errors = validateField(
      { type: [inputType], required: true, multiple: false },
      fieldValue,
    )

    expect(errors.map(error => error.errorCode)).toEqual(expectedCodes)
  })

  it('accepts multiple values when the profile allows them', () => {
    const errors = validateField(
      { type: ['Text'], required: true, multiple: true },
      ['first', 'second'],
    )

    expect(errors).toEqual([])
  })

  it.each([
    ['an allowed required value', 'draft', true, []],
    ['a disallowed required value', 'unknown', true, ['WRONG_VALUE_SET']],
    ['a missing optional value', undefined, false, []],
    ['a disallowed optional value', 'unknown', false, ['WRONG_VALUE_SET']],
  ])('validates %s against select options', (_label, fieldValue, required, expectedCodes) => {
    const errors = validateField(
      {
        type: ['Select'],
        required,
        multiple: false,
        values: ['draft', 'published'],
      },
      fieldValue,
    )

    expect(errors.map(error => error.errorCode)).toEqual(expectedCodes)
  })

  it.each([
    ['a negative value', -1, ['WRONG_VALUE_SET']],
    ['a value below the minimum', 0, ['WRONG_VALUE_SET']],
    ['the minimum boundary', 1, []],
    ['the maximum boundary', 10, []],
    ['a value above the maximum', 11, ['WRONG_VALUE_SET']],
    ['a numeric string', '5', []],
    ['a non-numeric string', 'not-a-number', ['WRONG_VALUE_SET']],
    ['NaN', Number.NaN, ['WRONG_VALUE_SET']],
  ])('validates numeric constraint for %s', (_label, fieldValue, expectedCodes) => {
    const errors = validateField(
      {
        type: ['Number'],
        required: false,
        multiple: false,
        minValue: 1,
        maxValue: 10,
      },
      fieldValue,
    )

    expect(errors.map(error => error.errorCode)).toEqual(expectedCodes)
  })

  it.each([
    ['text below the minimum length', 'AB', ['WRONG_VALUE_SET']],
    ['text at both valid constraints', 'ABC', []],
    ['text above the maximum length', 'ABCDEF', ['WRONG_VALUE_SET']],
    ['text that does not match the pattern', 'AbC', ['WRONG_VALUE_SET']],
  ])('validates %s', (_label, fieldValue, expectedCodes) => {
    const errors = validateField(
      {
        type: ['Text'],
        required: false,
        multiple: false,
        minLength: 3,
        maxLength: 5,
        regex: '^[A-Z]+$',
      },
      fieldValue,
    )

    expect(errors.map(error => error.errorCode)).toEqual(expectedCodes)
  })

  it('warns about an invalid profile regex without failing validation', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      expect(validateField({ type: ['Text'], regex: '[' }, 'value')).toEqual([])
      expect(warnSpy).toHaveBeenCalledWith(
        'Invalid regex in profile input:',
        expect.objectContaining({ name: 'field', regexSource: '[' }),
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('stops before validation when the run is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      validateEntities(
        { '@graph': [] },
        { classes: {} },
        [],
        schemaManager,
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('validates only the requested entity IDs', async () => {
    const crate = {
      '@graph': [
        { '@id': '#first', '@type': 'Thing' },
        { '@id': '#second', '@type': 'Thing' },
      ],
    }

    const errors = await validateEntities(
      crate,
      { classes: {} },
      [],
      schemaManager,
      { targetEntityIds: new Set(['#second']) },
    )

    expect(errors).toEqual([
      expect.objectContaining({ entityId: '#second', fieldName: 'name' }),
    ])
  })

  it.each(['File', 'Dataset'])('requires a name for %s entities', async entityType => {
    const errors = await validateEntities(
      { '@graph': [{ '@id': '#entity', '@type': entityType }] },
      { classes: {} },
      [],
      schemaManager,
    )

    expect(errors).toEqual([
      expect.objectContaining({
        entityType,
        fieldName: 'name',
        errorCode: 'REQUIRED_NOT_SET',
        error_hu: 'Kötelező érték nincs beállítva',
      }),
    ])
  })

  it('handles entities with missing IDs or types without throwing', async () => {
    const errors = await validateEntities(
      {
        '@graph': [
          { '@type': 'Thing', name: 'No ID' },
          { '@id': '#no-type' },
        ],
      },
      { classes: {} },
      [],
      schemaManager,
    )

    expect(errors).toEqual([
      expect.objectContaining({
        entityId: '#no-type',
        entityType: '',
        fieldName: 'name',
      }),
    ])
  })

  it('uses the first type when an entity declares multiple types', async () => {
    const errors = await validateEntities(
      {
        '@graph': [
          {
            '@id': '#entity',
            '@type': ['Thing', 'OtherThing'],
            name: 'Example entity',
          },
        ],
      },
      {
        classes: {
          Thing: {
            inputs: [
              {
                name: 'field',
                label: 'Field',
                type: ['Text'],
                required: true,
                multiple: false,
              },
            ],
          },
        },
      },
      [],
      schemaManager,
    )

    expect(errors).toEqual([
      expect.objectContaining({
        entityType: 'Thing',
        fieldName: 'field',
        errorCode: 'REQUIRED_NOT_SET',
      }),
    ])
  })

  it('validates with a successfully composed profile', async () => {
    const profileUrl = 'https://example.test/profile'
    const profileContent = { id: 'profile-content' }
    const baseProfile = { classes: { Thing: { inputs: [] } } }
    const mergedProfile = {
      classes: {
        Thing: {
          inputs: [
            {
              name: 'composedField',
              label: 'Composed field',
              type: ['Text'],
              required: true,
              multiple: false,
            },
          ],
        },
      },
    }
    const mergingSchemaManager = {
      getMergedProfile: jest.fn().mockResolvedValue(mergedProfile),
    } as any
    const crate = {
      '@graph': [
        {
          '@id': '#entity',
          '@type': 'Thing',
          name: 'Example entity',
          conformsTo: profileUrl,
        },
      ],
    }

    const errors = await validateEntities(
      crate,
      baseProfile,
      [{ id: profileUrl, content: profileContent }] as any,
      mergingSchemaManager,
    )

    expect(mergingSchemaManager.getMergedProfile).toHaveBeenCalledWith(
      crate,
      profileContent,
      baseProfile,
      profileUrl,
    )
    expect(errors).toEqual([
      expect.objectContaining({
        fieldName: 'composedField',
        errorCode: 'REQUIRED_NOT_SET',
      }),
    ])
  })

  it('warns once and uses the base profile when a composed profile is missing', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const baseProfile = {
      classes: {
        Thing: {
          inputs: [
            {
              name: 'field',
              label: 'Field',
              type: ['Text'],
              required: true,
              multiple: false,
            },
          ],
        },
      },
    }

    try {
      const errors = await validateEntities(
        {
          '@graph': [
            {
              '@id': '#first',
              '@type': 'Thing',
              name: 'First',
              conformsTo: { '@id': 'https://example.test/missing-profile' },
            },
            {
              '@id': '#second',
              '@type': 'Thing',
              name: 'Second',
              conformsTo: 'https://example.test/missing-profile',
            },
          ],
        },
        baseProfile,
        [],
        schemaManager,
      )

      expect(errors).toHaveLength(2)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(
        'No profile found in state for conformsTo URL:',
        'https://example.test/missing-profile',
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('reuses compiled rules for the same validation context', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const compiledRuleCache = new Map()
    const profileWithInvalidRegex = {
      classes: {
        Thing: {
          inputs: [
            {
              name: 'field',
              label: 'Field',
              type: ['Text'],
              regex: '[',
            },
          ],
        },
      },
    }
    const options = {
      compiledRuleCache,
      cacheNamespace: 'test-context',
    }

    try {
      await validateEntities(
        { '@graph': [{ '@id': '#first', '@type': 'Thing', name: 'First' }] },
        profileWithInvalidRegex,
        [],
        schemaManager,
        options,
      )
      await validateEntities(
        { '@graph': [{ '@id': '#second', '@type': 'Thing', name: 'Second' }] },
        profileWithInvalidRegex,
        [],
        schemaManager,
        options,
      )

      expect(compiledRuleCache).toHaveProperty('size', 1)
      expect(warnSpy).toHaveBeenCalledTimes(1)
    } finally {
      warnSpy.mockRestore()
    }
  })
})

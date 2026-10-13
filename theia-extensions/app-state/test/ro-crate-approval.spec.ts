// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import {
  collectRoCrateChangedProperties,
  maintainRoCrateApprovalFile,
  parseRoCrateApprovalFile,
  type RoCrateApprovalFile,
  removeRoCrateApprovalProperties,
} from '../src/browser/state/ro-crate-approval'

describe('collectRoCrateChangedProperties', () => {
  it('records a pure entity id change as an update on the live entity', () => {
    const before = {
      '@graph': [
        {
          '@id': './',
          '@type': 'Dataset',
          hasPart: [{ '@id': 'original.txt' }],
        },
        {
          '@id': 'original.txt',
          '@type': 'File',
          name: 'Original file',
        },
      ],
    }
    const after = {
      '@graph': [
        {
          '@id': './',
          '@type': 'Dataset',
          hasPart: [{ '@id': 'renamed.txt' }],
        },
        {
          '@id': 'renamed.txt',
          '@type': 'File',
          name: 'Original file',
        },
      ],
    }

    expect(collectRoCrateChangedProperties(before, after)).toEqual([
      {
        entityId: './',
        propertyName: 'hasPart',
        operation: 'update',
        previousValue: [{ '@id': 'original.txt' }],
      },
      {
        entityId: 'renamed.txt',
        propertyName: '@id',
        operation: 'update',
        previousValue: 'original.txt',
      },
    ])
  })

  it('keeps ambiguous identical additions and deletions as separate entity changes', () => {
    const makeFile = (id: string) => ({
      '@id': id,
      '@type': 'File',
      name: 'Same file',
    })
    const before = {
      '@graph': [makeFile('old-a.txt'), makeFile('old-b.txt')],
    }
    const after = {
      '@graph': [makeFile('new-a.txt'), makeFile('new-b.txt')],
    }

    const changes = collectRoCrateChangedProperties(before, after)

    expect(changes).toEqual(expect.arrayContaining([
      {
        entityId: 'old-a.txt',
        propertyName: '@id',
        operation: 'delete',
        previousValue: 'old-a.txt',
      },
      {
        entityId: 'new-a.txt',
        propertyName: '@id',
        operation: 'create',
        previousValue: undefined,
      },
    ]))
    expect(changes).toHaveLength(12)
  })
})

describe('maintainRoCrateApprovalFile', () => {
  it('appends new suggestions without dropping existing pending approvals', () => {
    const existing: RoCrateApprovalFile = [
      {
        '@id': './',
        approval: Array.from({ length: 5 }, (_, index) => ({
          propertyName: `existing${index + 1}`,
          previousValue: `old-${index + 1}`,
          operation: 'update',
          approved: false,
          timestamp: '2026-06-01T10:00:00.000Z',
        })),
      },
    ]

    const result = maintainRoCrateApprovalFile(
      existing,
      Array.from({ length: 10 }, (_, index) => ({
        entityId: './',
        propertyName: `new${index + 1}`,
        operation: 'create' as const,
        previousValue: undefined,
      })),
      '2026-06-12T10:00:00.000Z',
    )

    expect(result).toHaveLength(1)
    expect(result[0].approval).toHaveLength(15)
    expect(result[0].approval.map((item) => item.propertyName)).toEqual(
      expect.arrayContaining([
        ...Array.from({ length: 5 }, (_, index) => `existing${index + 1}`),
        ...Array.from({ length: 10 }, (_, index) => `new${index + 1}`),
      ]),
    )
  })

  it('replaces a pending suggestion when the same property changes again', () => {
    const existing: RoCrateApprovalFile = [
      {
        '@id': './',
        approval: [
          {
            propertyName: 'name',
            previousValue: 'Original name',
            operation: 'update',
            approved: false,
            timestamp: '2026-06-01T10:00:00.000Z',
          },
          {
            propertyName: 'description',
            previousValue: 'Original description',
            operation: 'update',
            approved: false,
            timestamp: '2026-06-01T10:00:00.000Z',
          },
        ],
      },
    ]

    const result = maintainRoCrateApprovalFile(
      existing,
      [
        {
          entityId: './',
          propertyName: 'name',
          operation: 'update',
          previousValue: 'AI-generated name',
        },
      ],
      '2026-06-12T10:00:00.000Z',
    )

    expect(result[0].approval).toEqual([
      {
        propertyName: 'description',
        previousValue: 'Original description',
        operation: 'update',
        approved: false,
        timestamp: '2026-06-01T10:00:00.000Z',
      },
      {
        propertyName: 'name',
        previousValue: 'AI-generated name',
        operation: 'update',
        approved: false,
        timestamp: '2026-06-12T10:00:00.000Z',
      },
    ])
  })

  it('preserves an approval only while the outstanding change is unchanged', () => {
    const existing: RoCrateApprovalFile = [
      {
        '@id': './',
        approval: [
          {
            propertyName: 'name',
            previousValue: 'Original name',
            operation: 'update',
            approved: true,
            timestamp: '2026-06-01T10:00:00.000Z',
          },
        ],
      },
    ]

    const unchanged = maintainRoCrateApprovalFile(
      existing,
      [{
        entityId: './',
        propertyName: 'name',
        operation: 'update',
        previousValue: 'Original name',
      }],
      '2026-06-12T10:00:00.000Z',
    )
    const changedAgain = maintainRoCrateApprovalFile(
      existing,
      [{
        entityId: './',
        propertyName: 'name',
        operation: 'update',
        previousValue: 'Intermediate name',
      }],
      '2026-06-12T10:00:00.000Z',
    )

    expect(unchanged[0].approval[0]).toEqual(expect.objectContaining({
      approved: true,
      timestamp: '2026-06-01T10:00:00.000Z',
    }))
    expect(changedAgain[0].approval[0]).toEqual(expect.objectContaining({
      approved: false,
      timestamp: '2026-06-12T10:00:00.000Z',
    }))
  })

  it('moves existing approvals to the live entity when its ID changes', () => {
    const existing: RoCrateApprovalFile = [
      {
        '@id': 'old.txt',
        approval: [
          {
            propertyName: 'name',
            previousValue: 'Old name',
            operation: 'update',
            approved: false,
            timestamp: '2026-06-01T10:00:00.000Z',
          },
        ],
      },
    ]

    const result = maintainRoCrateApprovalFile(
      existing,
      [{
        entityId: 'new.txt',
        propertyName: '@id',
        operation: 'update',
        previousValue: 'old.txt',
      }],
      '2026-06-12T10:00:00.000Z',
    )

    expect(result).toEqual([
      {
        '@id': 'new.txt',
        approval: [
          expect.objectContaining({ propertyName: '@id', previousValue: 'old.txt' }),
          expect.objectContaining({ propertyName: 'name', previousValue: 'Old name' }),
        ],
      },
    ])
  })
})

describe('parseRoCrateApprovalFile', () => {
  it('migrates legacy approval entries and ignores malformed records', () => {
    const result = parseRoCrateApprovalFile({
      changes: [
        {
          entityId: './',
          property: 'name',
          previousValue: 'Before',
          operation: 'add',
          status: 'approved',
          updatedAt: '2026-06-01T10:00:00.000Z',
        },
        { entityId: '', propertyName: 'description' },
        null,
      ],
    })

    expect(result).toEqual([
      {
        '@id': './',
        approval: [
          {
            propertyName: 'name',
            previousValue: 'Before',
            operation: 'create',
            approved: true,
            timestamp: '2026-06-01T10:00:00.000Z',
          },
        ],
      },
    ])
  })

  it.each([null, {}, { changes: 'invalid' }])(
    'returns undefined for unsupported approval data %#',
    value => {
      expect(parseRoCrateApprovalFile(value)).toBeUndefined()
    },
  )
})

describe('removeRoCrateApprovalProperties', () => {
  it('removes trusted system changes without dropping other review items', () => {
    const existing: RoCrateApprovalFile = [
      {
        '@id': '#contact',
        approval: [
          {
            propertyName: 'name',
            operation: 'create',
            approved: false,
            timestamp: '2026-06-01T10:00:00.000Z',
          },
          {
            propertyName: 'email',
            operation: 'update',
            approved: false,
            timestamp: '2026-06-01T10:00:00.000Z',
          },
        ],
      },
      {
        '@id': './',
        approval: [
          {
            propertyName: 'description',
            operation: 'update',
            approved: false,
            timestamp: '2026-06-01T10:00:00.000Z',
          },
        ],
      },
    ]

    const result = removeRoCrateApprovalProperties(existing, [
      { entityId: '#contact', propertyName: 'name' },
    ])

    expect(result).toEqual([
      {
        '@id': '#contact',
        approval: [expect.objectContaining({ propertyName: 'email' })],
      },
      {
        '@id': './',
        approval: [expect.objectContaining({ propertyName: 'description' })],
      },
    ])
  })
})

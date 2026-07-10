import {
  maintainRoCrateApprovalFile,
  removeRoCrateApprovalProperties,
  type RoCrateApprovalFile,
} from '../src/browser/state/ro-crate-approval'

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

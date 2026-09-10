import { nls } from '@theia/core/lib/common/nls'
import { Button, ConfigProvider, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd'
import type { TableColumnsType } from 'antd'
import * as React from 'react'
import {
    getEntityName,
    sanitizeGlobalEntity,
    SUPPORTED_GLOBAL_ENTITY_TYPES,
    type SupportedGlobalEntityType,
} from './global-entity-library-store'
import type {
    GlobalEntityCollection,
    GlobalEntityRecord,
    GlobalEntityRow,
} from './global-entity-library-types'

export interface GlobalEntityLibraryTableProps {
    collection: GlobalEntityCollection
    loading: boolean
    onSave: (record: GlobalEntityRecord) => Promise<void>
    onDelete: (recordId: string) => Promise<void>
    onDeleteMany: (recordIds: string[]) => Promise<void>
}

type ResizableColumnKey = 'type' | 'name' | 'properties' | 'relationships'

interface ResizableHeaderCellProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
    width?: number
    minWidth?: number
    columnKey?: ResizableColumnKey
    tableWidth?: number
    onResize?: (width: number) => void
}

const ResizableHeaderCell: React.FC<ResizableHeaderCellProps> = ({
    width,
    minWidth = 90,
    columnKey,
    tableWidth,
    onResize,
    children,
    ...cellProps
}) => {
    const startResize = (event: React.MouseEvent<HTMLSpanElement>): void => {
        if (!width || !columnKey || !tableWidth || !onResize) return
        event.preventDefault()
        event.stopPropagation()

        const startX = event.clientX
        const startWidth = width
        const tableContainer = event.currentTarget.closest<HTMLElement>('.global-entity-library-table-container')
        const previousCursor = document.body.style.cursor
        const previousUserSelect = document.body.style.userSelect
        let nextWidth = startWidth
        let animationFrame: number | undefined
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'

        const applyWidth = (): void => {
            tableContainer?.style.setProperty(`--global-entity-${columnKey}-width`, `${nextWidth}px`)
            tableContainer?.style.setProperty(
                '--global-entity-table-width',
                `${tableWidth + nextWidth - startWidth}px`,
            )
            animationFrame = undefined
        }
        const handleMouseMove = (moveEvent: MouseEvent): void => {
            nextWidth = Math.max(minWidth, startWidth + moveEvent.clientX - startX)
            if (animationFrame === undefined) {
                animationFrame = window.requestAnimationFrame(applyWidth)
            }
        }
        const stopResize = (): void => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', stopResize)
            if (animationFrame !== undefined) {
                window.cancelAnimationFrame(animationFrame)
            }
            applyWidth()
            document.body.style.cursor = previousCursor
            document.body.style.userSelect = previousUserSelect
            onResize(nextWidth)
        }

        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', stopResize)
    }

    return <th {...cellProps} style={{ ...cellProps.style, width }}>
        {children}
        {onResize && <span
            className='global-entity-library-resize-handle'
            role='separator'
            aria-orientation='vertical'
            onClick={event => event.stopPropagation()}
            onMouseDown={startResize}
        />}
    </th>
}

const DEFAULT_COLUMN_WIDTHS: Record<ResizableColumnKey, number> = {
    type: 150,
    name: 220,
    properties: 420,
    relationships: 300,
}

const newRecordId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return `global-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const stringifyValue = (value: unknown): string => {
    if (Array.isArray(value)) return value.map(item => String(item)).join(', ')
    if (value && typeof value === 'object') return JSON.stringify(value)
    return value === undefined || value === null ? '' : String(value)
}

export const GlobalEntityLibraryTable: React.FC<GlobalEntityLibraryTableProps> = ({
    collection,
    loading,
    onSave,
    onDelete,
    onDeleteMany,
}) => {
    const tableWrapperRef = React.useRef<HTMLDivElement>(null)
    const [query, setQuery] = React.useState('')
    const [editorOpen, setEditorOpen] = React.useState(false)
    const [editingRecordId, setEditingRecordId] = React.useState<string>()
    const [entityType, setEntityType] = React.useState<SupportedGlobalEntityType>('author')
    const [name, setName] = React.useState('')
    const [propertiesJson, setPropertiesJson] = React.useState('{}')
    const [relationshipsJson, setRelationshipsJson] = React.useState('{}')
    const [validationError, setValidationError] = React.useState('')
    const [saving, setSaving] = React.useState(false)
    const [deleting, setDeleting] = React.useState(false)
    const [selectedRowKeys, setSelectedRowKeys] = React.useState<React.Key[]>([])
    const [columnWidths, setColumnWidths] = React.useState(DEFAULT_COLUMN_WIDTHS)
    const tableWidth = Object.values(columnWidths).reduce((total, width) => total + width, 156)

    const resizableColumn = (key: ResizableColumnKey, minWidth: number): {
        width: number
        onHeaderCell: () => ResizableHeaderCellProps
    } => ({
        width: columnWidths[key],
        onHeaderCell: () => ({
            width: columnWidths[key],
            minWidth,
            columnKey: key,
            tableWidth,
            onResize: width => setColumnWidths(current => ({ ...current, [key]: width })),
        }),
    })

    const rows = React.useMemo<GlobalEntityRow[]>(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase()
        return Object.entries(collection)
            .flatMap(([type, records]) => records.map(record => ({
                ...record,
                entityType: type,
            })))
            .filter(row => !normalizedQuery || JSON.stringify(row)
                .toLocaleLowerCase()
                .includes(normalizedQuery))
    }, [collection, query])

    const recordsById = React.useMemo(() => {
        const records = new Map<string, GlobalEntityRecord>()
        Object.values(collection).flat().forEach(record => records.set(record.recordId, record))
        return records
    }, [collection])

    const openAdd = (): void => {
        setEditingRecordId(undefined)
        setEntityType('author')
        setName('')
        setPropertiesJson('{}')
        setRelationshipsJson('{}')
        setValidationError('')
        setEditorOpen(true)
    }

    const openEdit = (record: GlobalEntityRow): void => {
        const { '@type': _type, name: _name, ...properties } = record.entity
        setEditingRecordId(record.recordId)
        setEntityType(record.entityType as SupportedGlobalEntityType)
        setName(getEntityName(record.entity))
        setPropertiesJson(JSON.stringify(properties, null, 2))
        setRelationshipsJson(JSON.stringify(record.relationships ?? {}, null, 2))
        setValidationError('')
        setEditorOpen(true)
    }

    const saveRecord = async (): Promise<void> => {
        try {
            if (!name.trim()) throw new Error(nls.localize(
                'rockit/globalEntities/nameRequired',
                'The entity name is required.',
            ))

            const properties: unknown = JSON.parse(propertiesJson)
            const relationships: unknown = JSON.parse(relationshipsJson)
            if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
                throw new Error(nls.localize(
                    'rockit/globalEntities/propertiesObjectRequired',
                    'Additional properties must be a JSON object.',
                ))
            }
            if (!relationships || typeof relationships !== 'object' || Array.isArray(relationships)) {
                throw new Error(nls.localize(
                    'rockit/globalEntities/relationshipsObjectRequired',
                    'Relationships must be a JSON object.',
                ))
            }
            for (const targets of Object.values(relationships)) {
                if (!Array.isArray(targets) || targets.some(target => typeof target !== 'string')) {
                    throw new Error(nls.localize(
                        'rockit/globalEntities/relationshipArrayRequired',
                        'Each relationship must be an array of record IDs.',
                    ))
                }
            }

            const entity = sanitizeGlobalEntity({
                ...(properties as Record<string, unknown>),
                '@type': [entityType],
                name: name.trim(),
            })
            setSaving(true)
            await onSave({
                recordId: editingRecordId ?? newRecordId(),
                entity,
                relationships: Object.keys(relationships).length
                    ? relationships as Record<string, string[]>
                    : {},
            })
            setEditorOpen(false)
        } catch (error) {
            setValidationError(error instanceof Error ? error.message : String(error))
        } finally {
            setSaving(false)
        }
    }

    const deleteRecord = async (recordId: string): Promise<void> => {
        await onDelete(recordId)
        setSelectedRowKeys(keys => keys.filter(key => key !== recordId))
    }

    const deleteSelectedRecords = async (): Promise<void> => {
        if (!selectedRowKeys.length) return
        setDeleting(true)
        try {
            await onDeleteMany(selectedRowKeys.map(String))
            setSelectedRowKeys([])
        } finally {
            setDeleting(false)
        }
    }

    const columns: TableColumnsType<GlobalEntityRow> = [
        {
            title: nls.localize('rockit/globalEntities/type', 'Type'),
            dataIndex: 'entityType',
            ...resizableColumn('type', 110),
            ellipsis: true,
            sorter: (left, right) => left.entityType.localeCompare(right.entityType),
            filters: SUPPORTED_GLOBAL_ENTITY_TYPES.map(type => ({
                text: type === 'author'
                    ? nls.localize('rockit/globalEntities/author', 'Author')
                    : nls.localize('rockit/globalEntities/pointOfContact', 'Point of Contact'),
                value: type,
            })),
            onFilter: (value, record) => record.entityType === value,
            render: (type: string) => <Tag>{type === 'author'
                ? nls.localize('rockit/globalEntities/author', 'Author')
                : nls.localize('rockit/globalEntities/pointOfContact', 'Point of Contact')}
            </Tag>,
        },
        {
            title: nls.localize('rockit/globalEntities/name', 'Name'),
            key: 'name',
            ...resizableColumn('name', 120),
            ellipsis: true,
            sorter: (left, right) => getEntityName(left.entity).localeCompare(getEntityName(right.entity)),
            render: (_, record) => getEntityName(record.entity),
        },
        {
            title: nls.localize('rockit/globalEntities/properties', 'Properties'),
            key: 'properties',
            ...resizableColumn('properties', 160),
            ellipsis: true,
            render: (_, record) => {
                const properties = Object.entries(record.entity)
                    .filter(([property]) => property !== '@type' && property !== 'name')
                if (!properties.length) {
                    return <Typography.Text>—</Typography.Text>
                }
                const label = properties
                    .map(([property, value]) => `${property}: ${stringifyValue(value)}`)
                    .join(', ')
                return <div className='global-entity-library-cell-content' title={label}>
                    {properties.map(([property, value]) => (
                        <Tag key={property}>{property}: {stringifyValue(value)}</Tag>
                    ))}
                </div>
            },
        },
        {
            title: nls.localize('rockit/globalEntities/relationships', 'Relationships'),
            key: 'relationships',
            ...resizableColumn('relationships', 160),
            ellipsis: true,
            render: (_, record) => {
                const relationships = Object.entries(record.relationships ?? {})
                if (!relationships.length) {
                    return <Typography.Text>—</Typography.Text>
                }
                const relationshipLabels = relationships.flatMap(([property, targets]) =>
                    targets.map(targetId => {
                        const target = recordsById.get(targetId)
                        const label = target ? getEntityName(target.entity) || targetId : targetId
                        return { key: `${property}:${targetId}`, label: `${property}: ${label}` }
                    }),
                )
                return <div
                    className='global-entity-library-cell-content'
                    title={relationshipLabels.map(item => item.label).join(', ')}
                >
                    {relationshipLabels.map(item => <Tag key={item.key}>{item.label}</Tag>)}
                </div>
            },
        },
        {
            title: '',
            key: 'spacer',
            className: 'global-entity-library-spacer-column',
            render: () => null,
        },
        {
            title: nls.localize('rockit/globalEntities/actions', 'Actions'),
            key: 'actions',
            align: 'center',
            fixed: 'right',
            width: 116,
            render: (_, record) => <Space size={4}>
                <Button
                    size='small'
                    aria-label={nls.localize('rockit/globalEntities/edit', 'Edit')}
                    title={nls.localize('rockit/globalEntities/edit', 'Edit')}
                    onClick={() => openEdit(record)}
                >
                    <i className='fa fa-pencil' />
                </Button>
                <Popconfirm
                    title={nls.localize('rockit/globalEntities/deleteQuestion', 'Delete this global entity?')}
                    description={nls.localize(
                        'rockit/globalEntities/deleteDescription',
                        'References from other global records will also be removed.',
                    )}
                    okText={nls.localize('rockit/globalEntities/delete', 'Delete')}
                    cancelText={nls.localize('rockit/common/cancel', 'Cancel')}
                    onConfirm={() => deleteRecord(record.recordId)}
                >
                    <Button
                        size='small'
                        danger
                        aria-label={nls.localize('rockit/globalEntities/delete', 'Delete')}
                        title={nls.localize('rockit/globalEntities/delete', 'Delete')}
                    >
                        <i className='fa fa-trash' />
                    </Button>
                </Popconfirm>
            </Space>,
        },
    ]

    return <ConfigProvider
        getPopupContainer={() => tableWrapperRef.current || document.body}
        theme={{
            token: {
                colorBgContainer: 'var(--theia-editor-background)',
                colorText: 'var(--theia-foreground)',
                colorTextHeading: 'var(--theia-foreground)',
                colorBorder: 'var(--theia-panel-border)',
                colorBgElevated: 'var(--theia-menu-background)',
                colorTextPlaceholder: 'var(--theia-descriptionForeground)',
                colorPrimary: 'var(--theia-button-background)',
                colorIcon: 'var(--theia-icon-foreground)',
                colorIconHover: 'var(--theia-focusBorder)',
                controlItemBgHover: 'var(--theia-list-hoverBackground)',
                controlItemBgActive: 'var(--theia-list-inactiveSelectionBackground)',
                controlItemBgActiveHover: 'var(--theia-list-hoverBackground)',
                fontFamily: 'var(--theia-ui-font-family)',
            },
            components: {
                Table: {
                    headerBg: 'var(--theia-editor-background)',
                    headerColor: 'var(--theia-foreground)',
                    headerSortActiveBg: 'var(--theia-list-hoverBackground)',
                    headerSortHoverBg: 'var(--theia-list-hoverBackground)',
                    filterDropdownBg: 'var(--theia-menu-background)',
                },
                Button: {
                    defaultBg: 'var(--theia-button-secondaryBackground)',
                    defaultColor: 'var(--theia-button-secondaryForeground)',
                    defaultBorderColor: 'var(--theia-button-border, transparent)',
                },
                Input: {
                    colorBgContainer: 'var(--theia-input-background)',
                    colorText: 'var(--theia-input-foreground)',
                    colorBorder: 'var(--theia-input-border)',
                },
                Select: {
                    selectorBg: 'var(--theia-input-background)',
                    optionActiveBg: 'var(--theia-list-hoverBackground)',
                    optionSelectedBg: 'var(--theia-list-inactiveSelectionBackground)',
                    optionSelectedColor: 'var(--theia-foreground)',
                },
                Tag: {
                    defaultBg: 'transparent',
                    defaultColor: 'var(--theia-foreground)',
                },
            },
        }}
    >
        <div ref={tableWrapperRef} className='global-entity-library-table' id='global-entity-library-table'>
            <div className='global-entity-library-toolbar'>
                <Input.Search
                    id='global-entity-library-search'
                    className='global-entity-library-search'
                    allowClear
                    enterButton
                    placeholder={nls.localize('rockit/globalEntities/search', 'Search global entities')}
                    value={query}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
                />
                <Space size={8}>
                    {!!selectedRowKeys.length && <Popconfirm
                        title={nls.localize(
                            'rockit/globalEntities/deleteSelectedQuestion',
                            'Delete the selected global entities?',
                        )}
                        description={nls.localize(
                            'rockit/globalEntities/deleteSelectedDescription',
                            'References to the selected records will also be removed.',
                        )}
                        okText={nls.localize('rockit/globalEntities/delete', 'Delete')}
                        cancelText={nls.localize('rockit/common/cancel', 'Cancel')}
                        onConfirm={deleteSelectedRecords}
                    >
                        <Button danger loading={deleting}>
                            <i className='fa fa-trash' />
                            {nls.localize(
                                'rockit/globalEntities/deleteCount',
                                'Delete ({0})',
                                selectedRowKeys.length,
                            )}
                        </Button>
                    </Popconfirm>}
                    <Button
                        className='global-entity-library-add-button'
                        type='primary'
                        onClick={openAdd}
                    >
                        <i className='fa fa-plus' />
                        {nls.localize('rockit/globalEntities/add', 'Add entity')}
                    </Button>
                </Space>
            </div>
            <div
                className='global-entity-library-table-container'
                style={{
                    '--global-entity-table-width': `${tableWidth}px`,
                    '--global-entity-type-width': `${columnWidths.type}px`,
                    '--global-entity-name-width': `${columnWidths.name}px`,
                    '--global-entity-properties-width': `${columnWidths.properties}px`,
                    '--global-entity-relationships-width': `${columnWidths.relationships}px`,
                } as React.CSSProperties}
            >
                <Table
                    components={{ header: { cell: ResizableHeaderCell } }}
                    rowKey='recordId'
                    size='small'
                    loading={loading || deleting}
                    columns={columns}
                    dataSource={rows}
                    rowSelection={{
                        type: 'checkbox',
                        selectedRowKeys,
                        preserveSelectedRowKeys: true,
                        columnWidth: 40,
                        onChange: setSelectedRowKeys,
                    }}
                    pagination={{ defaultPageSize: 10, showSizeChanger: true, size: 'small' }}
                    tableLayout='fixed'
                    locale={{
                        emptyText: nls.localize(
                            'rockit/globalEntities/empty',
                            'No global entities are available.',
                        ),
                    }}
                    scroll={{ x: tableWidth, y: '100%' }}
                />
            </div>
            <Modal
                title={editingRecordId
                    ? nls.localize('rockit/globalEntities/editTitle', 'Edit global entity')
                    : nls.localize('rockit/globalEntities/addTitle', 'Add global entity')}
                open={editorOpen}
                confirmLoading={saving}
                okText={nls.localize('rockit/globalEntities/save', 'Save')}
                cancelText={nls.localize('rockit/common/cancel', 'Cancel')}
                onOk={() => void saveRecord()}
                onCancel={() => setEditorOpen(false)}
                width={680}
            >
                <div className='global-entity-library-form'>
                    <label>
                        <span>{nls.localize('rockit/globalEntities/type', 'Type')}</span>
                        <Select
                            className='global-entity-library-type-select'
                            value={entityType}
                            options={[
                                {
                                    value: 'author',
                                    label: nls.localize('rockit/globalEntities/author', 'Author'),
                                },
                                {
                                    value: 'datasetContact',
                                    label: nls.localize('rockit/globalEntities/pointOfContact', 'Point of Contact'),
                                },
                            ]}
                            onChange={setEntityType}
                        />
                    </label>
                    <label>
                        <span>{nls.localize('rockit/globalEntities/name', 'Name')}</span>
                        <Input value={name} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value)} />
                    </label>
                    <label>
                        <span>{nls.localize(
                            'rockit/globalEntities/additionalProperties',
                            'Additional properties (JSON)',
                        )}</span>
                        <Input.TextArea
                            rows={7}
                            spellCheck={false}
                            value={propertiesJson}
                            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setPropertiesJson(event.target.value)}
                        />
                    </label>
                    <label>
                        <span>{nls.localize(
                            'rockit/globalEntities/relationshipsJson',
                            'Relationships by record ID (JSON)',
                        )}</span>
                        <Input.TextArea
                            rows={4}
                            spellCheck={false}
                            value={relationshipsJson}
                            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setRelationshipsJson(event.target.value)}
                        />
                    </label>
                    {validationError && <Typography.Text>{validationError}</Typography.Text>}
                </div>
            </Modal>
        </div>
    </ConfigProvider>
}

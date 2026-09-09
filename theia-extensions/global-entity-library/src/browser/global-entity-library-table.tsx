import { nls } from '@theia/core/lib/common/nls'
import { Button, ConfigProvider, Input, Modal, Popconfirm, Space, Table, Tag, Typography } from 'antd'
import type { TableColumnsType } from 'antd'
import * as React from 'react'
import {
    getEntityName,
    getEntityTypes,
    sanitizeGlobalEntity,
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
}) => {
    const tableWrapperRef = React.useRef<HTMLDivElement>(null)
    const [query, setQuery] = React.useState('')
    const [editorOpen, setEditorOpen] = React.useState(false)
    const [editingRecordId, setEditingRecordId] = React.useState<string>()
    const [entityType, setEntityType] = React.useState('')
    const [name, setName] = React.useState('')
    const [propertiesJson, setPropertiesJson] = React.useState('{}')
    const [relationshipsJson, setRelationshipsJson] = React.useState('{}')
    const [validationError, setValidationError] = React.useState('')
    const [saving, setSaving] = React.useState(false)

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
        setEntityType('')
        setName('')
        setPropertiesJson('{}')
        setRelationshipsJson('{}')
        setValidationError('')
        setEditorOpen(true)
    }

    const openEdit = (record: GlobalEntityRow): void => {
        const { '@type': _type, name: _name, ...properties } = record.entity
        setEditingRecordId(record.recordId)
        setEntityType(getEntityTypes(record.entity).join(', '))
        setName(getEntityName(record.entity))
        setPropertiesJson(JSON.stringify(properties, null, 2))
        setRelationshipsJson(JSON.stringify(record.relationships ?? {}, null, 2))
        setValidationError('')
        setEditorOpen(true)
    }

    const saveRecord = async (): Promise<void> => {
        try {
            const types = entityType.split(',').map(type => type.trim()).filter(Boolean)
            if (!types.length) throw new Error(nls.localize(
                'rockit/globalEntities/typeRequired',
                'At least one entity type is required.',
            ))
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
                '@type': types,
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

    const columns: TableColumnsType<GlobalEntityRow> = [
        {
            title: nls.localize('rockit/globalEntities/type', 'Type'),
            dataIndex: 'entityType',
            width: 180,
            sorter: (left, right) => left.entityType.localeCompare(right.entityType),
            filters: Object.keys(collection).map(type => ({ text: type, value: type })),
            onFilter: (value, record) => record.entityType === value,
            render: (type: string) => <Tag>{type}</Tag>,
        },
        {
            title: nls.localize('rockit/globalEntities/name', 'Name'),
            key: 'name',
            sorter: (left, right) => getEntityName(left.entity).localeCompare(getEntityName(right.entity)),
            render: (_, record) => getEntityName(record.entity),
        },
        {
            title: nls.localize('rockit/globalEntities/properties', 'Properties'),
            key: 'properties',
            render: (_, record) => {
                const properties = Object.entries(record.entity)
                    .filter(([property]) => property !== '@type' && property !== 'name')
                if (!properties.length) {
                    return <Typography.Text>—</Typography.Text>
                }
                return <Space size={[4, 4]} wrap>{properties.map(([property, value]) => (
                    <Tag key={property}>{property}: {stringifyValue(value)}</Tag>
                ))}</Space>
            },
        },
        {
            title: nls.localize('rockit/globalEntities/relationships', 'Relationships'),
            key: 'relationships',
            render: (_, record) => {
                const relationships = Object.entries(record.relationships ?? {})
                if (!relationships.length) {
                    return <Typography.Text>—</Typography.Text>
                }
                return <Space size={[4, 4]} wrap>{relationships.flatMap(([property, targets]) =>
                    targets.map(targetId => {
                        const target = recordsById.get(targetId)
                        const label = target ? getEntityName(target.entity) || targetId : targetId
                        return <Tag key={`${property}:${targetId}`}>{property}: {label}</Tag>
                    }),
                )}</Space>
            },
        },
        {
            title: nls.localize('rockit/globalEntities/actions', 'Actions'),
            key: 'actions',
            align: 'center',
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
                    onConfirm={() => onDelete(record.recordId)}
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
                    allowClear
                    placeholder={nls.localize('rockit/globalEntities/search', 'Search global entities')}
                    value={query}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
                />
                <Button onClick={openAdd}>
                    <i className='fa fa-plus' />
                    {nls.localize('rockit/globalEntities/add', 'Add entity')}
                </Button>
            </div>
            <div className='global-entity-library-table-container'>
                <Table
                    rowKey='recordId'
                    size='small'
                    loading={loading}
                    columns={columns}
                    dataSource={rows}
                    pagination={{ defaultPageSize: 10, showSizeChanger: true, size: 'small' }}
                    locale={{
                        emptyText: nls.localize(
                            'rockit/globalEntities/empty',
                            'No global entities are available.',
                        ),
                    }}
                    scroll={{ x: 850 }}
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
                        <Input
                            value={entityType}
                            placeholder={nls.localize(
                                'rockit/globalEntities/typePlaceholder',
                                'Person, Organization',
                            )}
                            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEntityType(event.target.value)}
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

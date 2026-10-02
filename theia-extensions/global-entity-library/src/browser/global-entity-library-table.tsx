// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { nls } from '@theia/core/lib/common/nls'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditIcon from '@mui/icons-material/Edit'
import { IconButton } from '@mui/material'
import { Button, ConfigProvider, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd'
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
    profile?: Record<string, any>
    loading: boolean
    onSave: (record: GlobalEntityRecord) => Promise<void>
    onDelete: (recordId: string) => Promise<void>
    onDeleteMany: (recordIds: string[]) => Promise<void>
}

type SchemaFieldKind = 'text' | 'url' | 'email' | 'number' | 'date' | 'boolean' | 'select'

interface SchemaField {
    name: string
    label: string
    help?: string
    placeholder?: string
    pattern?: string
    kind: SchemaFieldKind
    multiple: boolean
    required: boolean
    values: string[]
}

const FALLBACK_FIELDS: Record<SupportedGlobalEntityType, SchemaField[]> = {
    author: [
        { name: 'authorName', label: 'Author Name', kind: 'text', multiple: false, required: true, values: [] },
        { name: 'authorAffiliation', label: 'Affiliation', kind: 'text', multiple: false, required: false, values: [] },
        { name: 'authorIdentifierScheme', label: 'Identifier Scheme', kind: 'text', multiple: false, required: false, values: [] },
        { name: 'authorIdentifier', label: 'Identifier', kind: 'text', multiple: false, required: false, values: [] },
    ],
    datasetContact: [
        { name: 'datasetContactName', label: 'Contact Name', kind: 'text', multiple: false, required: true, values: [] },
        { name: 'datasetContactAffiliation', label: 'Affiliation', kind: 'text', multiple: false, required: false, values: [] },
        { name: 'datasetContactEmail', label: 'Email', kind: 'text', multiple: false, required: false, values: [] },
    ],
}

const parseSchemaBoolean = (value: unknown): boolean =>
    value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true')

const typeTail = (value: unknown): string => {
    const text = String(value ?? '').trim()
    return text.split(/[\/#]/).pop() ?? text
}

const getRoleNameProperty = (type: SupportedGlobalEntityType): string =>
    type === 'author' ? 'authorName' : 'datasetContactName'

const schemaFieldKind = (input: Record<string, any>): SchemaFieldKind => {
    if (Array.isArray(input.values) && input.values.length) return 'select'
    if (String(input.name ?? '').toLowerCase().includes('email')) return 'email'
    const types = (Array.isArray(input.type) ? input.type : [input.type])
        .map(typeTail)
        .map(type => type.toLowerCase())
    if (types.some(type => type.includes('boolean'))) return 'boolean'
    if (types.some(type => type.includes('date') || type.includes('time'))) return 'date'
    if (types.some(type => /number|integer|float|double|decimal/.test(type))) return 'number'
    if (types.some(type => /url|uri|iri/.test(type))) return 'url'
    return 'text'
}

const getSchemaFields = (
    profile: Record<string, any> | undefined,
    type: SupportedGlobalEntityType,
): SchemaField[] => {
    const classes = profile?.classes && typeof profile.classes === 'object'
        ? profile.classes as Record<string, any>
        : {}
    const className = Object.keys(classes).find(name =>
        name === type || typeTail(name).toLowerCase() === type.toLowerCase(),
    )
    const inputs = className && Array.isArray(classes[className]?.inputs)
        ? classes[className].inputs as Record<string, any>[]
        : []
    const fields = inputs.flatMap((input): SchemaField[] => {
        const name = typeof input.name === 'string' ? input.name.trim() : ''
        if (!name || name === '@id' || name === '@type' || name === '@reverse' || name === 'name') return []
        const inputTypes = (Array.isArray(input.type) ? input.type : [input.type]).map(typeTail)
        const isRelationship = inputTypes.some(inputType => {
            const matchingClass = Object.keys(classes).find(name => typeTail(name) === inputType)
            return matchingClass && Array.isArray(classes[matchingClass]?.inputs)
        })
        if (isRelationship) return []
        return [{
            name,
            label: typeof input.label === 'string' && input.label.trim() ? input.label : name,
            help: typeof input.help === 'string' && input.help.trim() ? input.help : undefined,
            placeholder: typeof input.placeholder === 'string' ? input.placeholder : undefined,
            pattern: typeof input.regex === 'string' ? input.regex : undefined,
            kind: schemaFieldKind(input),
            multiple: parseSchemaBoolean(input.multiple),
            required: parseSchemaBoolean(input.required) || Number(input.minimum ?? input.minItems ?? 0) > 0,
            values: Array.isArray(input.values) ? input.values.map(String) : [],
        }]
    })
    const roleNameProperty = getRoleNameProperty(type)
    if (!fields.some(field => field.name === roleNameProperty)) {
        fields.unshift(FALLBACK_FIELDS[type][0])
    }
    return fields.length ? fields : FALLBACK_FIELDS[type]
}

const normalizeFormProperties = (values: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(values).flatMap(([property, value]) => {
        if (typeof value === 'string') {
            const normalized = value.trim()
            return normalized ? [[property, normalized]] : []
        }
        if (Array.isArray(value)) {
            const normalized = value
                .map(item => typeof item === 'string' ? item.trim() : item)
                .filter(item => item !== '' && item !== undefined && item !== null)
            return normalized.length ? [[property, normalized]] : []
        }
        return value === undefined || value === null ? [] : [[property, value]]
    }))

type ColumnKey = 'type' | 'name' | 'properties' | 'relationships' | 'actions'
type ResizableColumnKey = Exclude<ColumnKey, 'actions'>
type ColumnWidths = Record<ColumnKey, number>

const COLUMN_KEYS: ColumnKey[] = ['type', 'name', 'properties', 'relationships', 'actions']
const NEXT_COLUMN: Record<ResizableColumnKey, ColumnKey> = {
    type: 'name',
    name: 'properties',
    properties: 'relationships',
    relationships: 'actions',
}
const MIN_COLUMN_WIDTHS: ColumnWidths = {
    type: 110,
    name: 120,
    properties: 160,
    relationships: 160,
    actions: 116,
}

interface ResizableHeaderCellProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
    width?: number
    minWidth?: number
    columnKey?: ResizableColumnKey
    onResize?: (widths: ColumnWidths) => void
}

const ResizableHeaderCell: React.FC<ResizableHeaderCellProps> = ({
    width,
    minWidth = 90,
    columnKey,
    onResize,
    children,
    ...cellProps
}) => {
    const startResize = (event: React.MouseEvent<HTMLSpanElement>): void => {
        if (!width || !columnKey || !onResize) return
        event.preventDefault()
        event.stopPropagation()

        const tableContainer = event.currentTarget.closest<HTMLElement>('.global-entity-library-table-container')
        const headerCells = tableContainer?.querySelectorAll<HTMLElement>('.ant-table-thead > tr > th')
        if (!tableContainer || !headerCells || headerCells.length < COLUMN_KEYS.length + 1) return

        const renderedWidths = COLUMN_KEYS.reduce((widths, key, index) => {
            widths[key] = headerCells[index + 1].getBoundingClientRect().width
            tableContainer.style.setProperty(`--global-entity-${key}-width`, `${widths[key]}px`)
            return widths
        }, {} as ColumnWidths)
        const nextColumnKey = NEXT_COLUMN[columnKey]
        const startX = event.clientX
        const startWidth = renderedWidths[columnKey]
        const startNextWidth = renderedWidths[nextColumnKey]
        const minimumNextWidth = MIN_COLUMN_WIDTHS[nextColumnKey]
        const minimumDelta = minWidth - startWidth
        const maximumDelta = startNextWidth - minimumNextWidth
        const previousCursor = document.body.style.cursor
        const previousUserSelect = document.body.style.userSelect
        let nextWidth = startWidth
        let nextAdjacentWidth = startNextWidth
        let animationFrame: number | undefined
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'

        const applyWidth = (): void => {
            tableContainer?.style.setProperty(`--global-entity-${columnKey}-width`, `${nextWidth}px`)
            tableContainer?.style.setProperty(
                `--global-entity-${nextColumnKey}-width`,
                `${nextAdjacentWidth}px`,
            )
            animationFrame = undefined
        }
        const handleMouseMove = (moveEvent: MouseEvent): void => {
            const delta = Math.min(maximumDelta, Math.max(minimumDelta, moveEvent.clientX - startX))
            nextWidth = startWidth + delta
            nextAdjacentWidth = startNextWidth - delta
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
            onResize({
                ...renderedWidths,
                [columnKey]: nextWidth,
                [nextColumnKey]: nextAdjacentWidth,
            })
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

const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
    type: 150,
    name: 220,
    properties: 420,
    relationships: 300,
    actions: 180,
}

const MIN_TABLE_WIDTH = 800

const fitDefaultColumnWidths = (availableWidth: number): ColumnWidths => {
    const widths = { ...DEFAULT_COLUMN_WIDTHS }
    const defaultWidth = Object.values(widths).reduce((total, width) => total + width, 0)
    let difference = availableWidth - defaultWidth

    if (difference >= 0) {
        widths.properties += difference * 0.5
        widths.relationships += difference * 0.3
        widths.actions += difference * 0.2
        return widths
    }

    for (const key of ['properties', 'relationships', 'name', 'type'] as ColumnKey[]) {
        const reducibleWidth = widths[key] - MIN_COLUMN_WIDTHS[key]
        const reduction = Math.min(reducibleWidth, -difference)
        widths[key] -= reduction
        difference += reduction
        if (difference >= 0) break
    }
    return widths
}

const fitCurrentColumnWidths = (current: ColumnWidths, availableWidth: number): ColumnWidths => {
    const widths = { ...current }
    const currentWidth = Object.values(widths).reduce((total, width) => total + width, 0)
    let difference = availableWidth - currentWidth
    if (Math.abs(difference) < 0.5) return current
    if (difference > 0) {
        widths.actions += difference
        return widths
    }
    for (const key of ['actions', 'relationships', 'properties', 'name', 'type'] as ColumnKey[]) {
        const reducibleWidth = widths[key] - MIN_COLUMN_WIDTHS[key]
        const reduction = Math.min(reducibleWidth, -difference)
        widths[key] -= reduction
        difference += reduction
        if (difference >= 0) break
    }
    return widths
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
    profile,
    loading,
    onSave,
    onDelete,
    onDeleteMany,
}) => {
    const tableWrapperRef = React.useRef<HTMLDivElement>(null)
    const tableContainerRef = React.useRef<HTMLDivElement>(null)
    const manuallyResizedColumns = React.useRef(false)
    const [query, setQuery] = React.useState('')
    const [editorOpen, setEditorOpen] = React.useState(false)
    const [editingRecordId, setEditingRecordId] = React.useState<string>()
    const [entityType, setEntityType] = React.useState<SupportedGlobalEntityType>('author')
    const [propertyValues, setPropertyValues] = React.useState<Record<string, unknown>>({})
    const [relationshipsJson, setRelationshipsJson] = React.useState('{}')
    const [validationError, setValidationError] = React.useState('')
    const [saving, setSaving] = React.useState(false)
    const [deleting, setDeleting] = React.useState(false)
    const [selectedRowKeys, setSelectedRowKeys] = React.useState<React.Key[]>([])
    const [columnWidths, setColumnWidths] = React.useState(DEFAULT_COLUMN_WIDTHS)
    const tableWidth = 40 + Object.values(columnWidths).reduce((total, width) => total + width, 0)
    const schemaFields = React.useMemo(
        () => getSchemaFields(profile, entityType),
        [profile, entityType],
    )

    React.useLayoutEffect(() => {
        const container = tableContainerRef.current
        if (!container) return
        let animationFrame: number | undefined
        const updateWidths = (): void => {
            animationFrame = undefined
            if (container.clientWidth <= 0) return
            const body = container.querySelector<HTMLElement>('.ant-table-body')
            const scrollbarWidth = body ? body.offsetWidth - body.clientWidth : 0
            const availableWidth = Math.max(MIN_TABLE_WIDTH, container.clientWidth - scrollbarWidth) - 40
            setColumnWidths(current => manuallyResizedColumns.current
                ? fitCurrentColumnWidths(current, availableWidth)
                : fitDefaultColumnWidths(availableWidth))
        }
        const observer = new ResizeObserver(() => {
            if (animationFrame === undefined) {
                animationFrame = window.requestAnimationFrame(updateWidths)
            }
        })
        observer.observe(container)
        const body = container.querySelector<HTMLElement>('.ant-table-body')
        if (body) observer.observe(body)
        updateWidths()
        return () => {
            observer.disconnect()
            if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame)
        }
    }, [])
    const resizableColumn = (key: ResizableColumnKey, minWidth: number): {
        width: number
        onHeaderCell: () => ResizableHeaderCellProps
    } => ({
        width: columnWidths[key],
        onHeaderCell: () => ({
            width: columnWidths[key],
            minWidth,
            columnKey: key,
            onResize: widths => {
                manuallyResizedColumns.current = true
                setColumnWidths(widths)
            },
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
        setPropertyValues({})
        setRelationshipsJson('{}')
        setValidationError('')
        setEditorOpen(true)
    }

    const openEdit = (record: GlobalEntityRow): void => {
        const { '@type': _type, name: _name, ...properties } = record.entity
        const type = record.entityType as SupportedGlobalEntityType
        const roleNameProperty = getRoleNameProperty(type)
        setEditingRecordId(record.recordId)
        setEntityType(type)
        setPropertyValues({
            ...properties,
            [roleNameProperty]: properties[roleNameProperty] ?? getEntityName(record.entity),
        })
        setRelationshipsJson(JSON.stringify(record.relationships ?? {}, null, 2))
        setValidationError('')
        setEditorOpen(true)
    }

    const saveRecord = async (): Promise<void> => {
        try {
            const normalizedProperties = normalizeFormProperties(propertyValues)
            const roleNameProperty = getRoleNameProperty(entityType)
            const displayName = String(normalizedProperties[roleNameProperty] ?? '').trim()
            if (!displayName) throw new Error(nls.localize(
                'rockit/globalEntities/nameRequired',
                'The entity name is required.',
            ))
            for (const field of schemaFields.filter(candidate => candidate.required)) {
                const value = normalizedProperties[field.name]
                if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) {
                    throw new Error(nls.localize(
                        'rockit/globalEntities/fieldRequired',
                        '{0} is required.',
                        field.label,
                    ))
                }
            }
            for (const field of schemaFields.filter(candidate => candidate.pattern)) {
                const value = normalizedProperties[field.name]
                if (typeof value === 'string' && field.pattern) {
                    let matches = true
                    try {
                        matches = new RegExp(field.pattern).test(value)
                    } catch (error) {
                        console.warn(`Ignoring invalid validation pattern for ${field.name}:`, error)
                    }
                    if (!matches) {
                        throw new Error(nls.localize(
                            'rockit/globalEntities/fieldInvalid',
                            '{0} has an invalid value.',
                            field.label,
                        ))
                    }
                }
            }

            const relationships: unknown = JSON.parse(relationshipsJson)
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
                ...normalizedProperties,
                '@type': [entityType],
                name: displayName,
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

    const changeEntityType = (type: SupportedGlobalEntityType): void => {
        const currentName = String(propertyValues[getRoleNameProperty(entityType)] ?? '').trim()
        setEntityType(type)
        setPropertyValues(currentName ? { [getRoleNameProperty(type)]: currentName } : {})
    }

    const setPropertyValue = (property: string, value: unknown): void => {
        setPropertyValues(current => ({ ...current, [property]: value }))
    }

    const renderSchemaField = (field: SchemaField): React.ReactNode => {
        const value = propertyValues[field.name]
        if (field.multiple) {
            const values = Array.isArray(value) ? value.map(String) : value ? [String(value)] : []
            return <Select
                mode='tags'
                placeholder={field.placeholder}
                value={values}
                options={field.values.map(item => ({ value: item, label: item }))}
                onChange={next => setPropertyValue(field.name, next)}
            />
        }
        if (field.kind === 'select') {
            return <Select
                allowClear
                showSearch
                placeholder={field.placeholder}
                value={value === undefined ? undefined : String(value)}
                options={field.values.map(item => ({ value: item, label: item }))}
                onChange={next => setPropertyValue(field.name, next)}
            />
        }
        if (field.kind === 'boolean') {
            return <Select
                allowClear
                value={typeof value === 'boolean' ? value : undefined}
                options={[
                    { value: true, label: nls.localize('rockit/common/yes', 'Yes') },
                    { value: false, label: nls.localize('rockit/common/no', 'No') },
                ]}
                onChange={next => setPropertyValue(field.name, next)}
            />
        }
        if (field.kind === 'number') {
            return <InputNumber
                value={typeof value === 'number' ? value : undefined}
                onChange={next => setPropertyValue(field.name, next)}
            />
        }
        return <Input
            type={field.kind === 'date' ? 'date' : field.kind === 'url' ? 'url' : field.kind === 'email' ? 'email' : 'text'}
            placeholder={field.placeholder}
            value={value === undefined || value === null ? '' : String(value)}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setPropertyValue(field.name, event.target.value)}
        />
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
            className: 'global-entity-library-last-resizable-column',
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
            title: nls.localize('rockit/globalEntities/actions', 'Actions'),
            key: 'actions',
            className: 'global-entity-library-actions-column',
            align: 'center',
            width: columnWidths.actions,
            render: (_, record) => <div className='global-entity-library-actions-container'>
                <IconButton
                    className='global-entity-library-action-button global-entity-library-action-button--edit'
                    size='small'
                    aria-label={nls.localize('rockit/globalEntities/edit', 'Edit')}
                    title={nls.localize('rockit/globalEntities/edit', 'Edit')}
                    onClick={event => {
                        event.stopPropagation()
                        openEdit(record)
                    }}
                >
                    <EditIcon className='global-entity-library-action-icon' />
                </IconButton>
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
                    <IconButton
                        className='global-entity-library-action-button global-entity-library-action-button--delete'
                        size='small'
                        aria-label={nls.localize('rockit/globalEntities/delete', 'Delete')}
                        title={nls.localize('rockit/globalEntities/delete', 'Delete')}
                        onClick={event => event.stopPropagation()}
                    >
                        <DeleteOutlineIcon className='global-entity-library-action-icon' />
                    </IconButton>
                </Popconfirm>
            </div>,
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
                ref={tableContainerRef}
                className='global-entity-library-table-container'
                style={{
                    '--global-entity-table-width': `${tableWidth}px`,
                    '--global-entity-type-width': `${columnWidths.type}px`,
                    '--global-entity-name-width': `${columnWidths.name}px`,
                    '--global-entity-properties-width': `${columnWidths.properties}px`,
                    '--global-entity-relationships-width': `${columnWidths.relationships}px`,
                    '--global-entity-actions-width': `${columnWidths.actions}px`,
                } as React.CSSProperties}
            >
                <Table
                    components={{ header: { cell: ResizableHeaderCell } }}
                    rowKey='recordId'
                    size='small'
                    showSorterTooltip={false}
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
                width={760}
            >
                <div className='global-entity-library-form'>
                    <Form layout='vertical'>
                        <section className='global-entity-library-form-section'>
                            <div className='global-entity-library-form-section-heading'>
                                <Typography.Title level={5}>{nls.localize(
                                    'rockit/globalEntities/generalInformation',
                                    'General information',
                                )}</Typography.Title>
                                <Typography.Text type='secondary'>{nls.localize(
                                    'rockit/globalEntities/schemaFieldsHint',
                                    'Fields are provided by the active metadata profile.',
                                )}</Typography.Text>
                            </div>
                            <Form.Item label={nls.localize('rockit/globalEntities/type', 'Type')} required>
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
                                    onChange={changeEntityType}
                                />
                            </Form.Item>
                            <div className='global-entity-library-property-grid'>
                                {schemaFields.map(field => <Form.Item
                                    key={field.name}
                                    label={field.label}
                                    required={field.required || field.name === getRoleNameProperty(entityType)}
                                    extra={field.help}
                                >
                                    {renderSchemaField(field)}
                                </Form.Item>)}
                            </div>
                        </section>
                        <section className='global-entity-library-form-section'>
                            <div className='global-entity-library-form-section-heading'>
                                <Typography.Title level={5}>{nls.localize(
                                    'rockit/globalEntities/relationships',
                                    'Relationships',
                                )}</Typography.Title>
                                <Typography.Text type='secondary'>{nls.localize(
                                    'rockit/globalEntities/relationshipsHint',
                                    'Relationship editing will be replaced by a record selector in a later version.',
                                )}</Typography.Text>
                            </div>
                            <Form.Item label={nls.localize(
                                'rockit/globalEntities/relationshipsJson',
                                'Relationships by record ID (JSON)',
                            )}>
                                <Input.TextArea
                                    rows={4}
                                    spellCheck={false}
                                    value={relationshipsJson}
                                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setRelationshipsJson(event.target.value)}
                                />
                            </Form.Item>
                        </section>
                    </Form>
                    {validationError && <Typography.Text type='danger'>{validationError}</Typography.Text>}
                </div>
            </Modal>
        </div>
    </ConfigProvider>
}

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { IconButton, Tooltip } from '@mui/material'
import { nls } from '@theia/core/lib/common/nls'
import * as React from '@theia/core/shared/react'
import { ConfigProvider, Popconfirm, Table, Typography } from 'antd'
import type { TableColumnsType } from 'antd'
import { CrosswalkRegistryEntry } from '../crosswalk-manager-types'

const repositoryLabel = (value: string): string => {
    if (value.toLocaleLowerCase() === 'arp') return 'ARP'
    return value.charAt(0).toLocaleUpperCase() + value.slice(1)
}

export interface CrosswalkTableProps {
    crosswalks: CrosswalkRegistryEntry[]
    isLoading: boolean
    deletingId?: string
    onDelete: (entry: CrosswalkRegistryEntry) => Promise<void>
}

type ColumnKey = 'name' | 'repositories' | 'rules' | 'imported' | 'actions'
type ResizableColumnKey = Exclude<ColumnKey, 'actions'>
type ColumnWidths = Record<ColumnKey, number>

const COLUMN_KEYS: ColumnKey[] = ['name', 'repositories', 'rules', 'imported', 'actions']
const NEXT_COLUMN: Record<ResizableColumnKey, ColumnKey> = {
    name: 'repositories',
    repositories: 'rules',
    rules: 'imported',
    imported: 'actions',
}
const MIN_COLUMN_WIDTHS: ColumnWidths = {
    name: 140,
    repositories: 150,
    rules: 120,
    imported: 180,
    actions: 90,
}
const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
    name: 300,
    repositories: 280,
    rules: 150,
    imported: 240,
    actions: 116,
}
const MIN_TABLE_WIDTH = 800

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

        const tableContainer = event.currentTarget.closest<HTMLElement>('.crosswalk-manager-table-container')
        const headerCells = tableContainer?.querySelectorAll<HTMLElement>('.ant-table-thead > tr > th')
        if (!tableContainer || !headerCells || headerCells.length < COLUMN_KEYS.length) return

        const renderedWidths = COLUMN_KEYS.reduce((widths, key, index) => {
            widths[key] = headerCells[index].getBoundingClientRect().width
            tableContainer.style.setProperty(`--crosswalk-${key}-width`, `${widths[key]}px`)
            return widths
        }, {} as ColumnWidths)
        const nextColumnKey = NEXT_COLUMN[columnKey]
        const startX = event.clientX
        const startWidth = renderedWidths[columnKey]
        const startNextWidth = renderedWidths[nextColumnKey]
        const minimumDelta = minWidth - startWidth
        const maximumDelta = startNextWidth - MIN_COLUMN_WIDTHS[nextColumnKey]
        const previousCursor = document.body.style.cursor
        const previousUserSelect = document.body.style.userSelect
        let nextWidth = startWidth
        let nextAdjacentWidth = startNextWidth
        let animationFrame: number | undefined
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'

        const applyWidth = (): void => {
            tableContainer.style.setProperty(`--crosswalk-${columnKey}-width`, `${nextWidth}px`)
            tableContainer.style.setProperty(`--crosswalk-${nextColumnKey}-width`, `${nextAdjacentWidth}px`)
            animationFrame = undefined
        }
        const handleMouseMove = (moveEvent: MouseEvent): void => {
            const delta = Math.min(maximumDelta, Math.max(minimumDelta, moveEvent.clientX - startX))
            nextWidth = startWidth + delta
            nextAdjacentWidth = startNextWidth - delta
            if (animationFrame === undefined) animationFrame = window.requestAnimationFrame(applyWidth)
        }
        const stopResize = (): void => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', stopResize)
            if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame)
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
            className='crosswalk-table-resize-handle'
            role='separator'
            aria-orientation='vertical'
            onClick={event => event.stopPropagation()}
            onMouseDown={startResize}
        />}
    </th>
}

const fitDefaultColumnWidths = (availableWidth: number): ColumnWidths => {
    const widths = { ...DEFAULT_COLUMN_WIDTHS }
    let difference = availableWidth - Object.values(widths).reduce((total, width) => total + width, 0)
    if (difference >= 0) {
        widths.name += difference * 0.4
        widths.repositories += difference * 0.3
        widths.imported += difference * 0.2
        widths.actions += difference * 0.1
        return widths
    }
    for (const key of ['name', 'repositories', 'imported', 'rules', 'actions'] as ColumnKey[]) {
        const reduction = Math.min(widths[key] - MIN_COLUMN_WIDTHS[key], -difference)
        widths[key] -= reduction
        difference += reduction
        if (difference >= 0) break
    }
    return widths
}

const fitCurrentColumnWidths = (current: ColumnWidths, availableWidth: number): ColumnWidths => {
    const widths = { ...current }
    let difference = availableWidth - Object.values(widths).reduce((total, width) => total + width, 0)
    if (Math.abs(difference) < 0.5) return current
    if (difference > 0) {
        widths.actions += difference
        return widths
    }
    for (const key of ['actions', 'imported', 'repositories', 'name', 'rules'] as ColumnKey[]) {
        const reduction = Math.min(widths[key] - MIN_COLUMN_WIDTHS[key], -difference)
        widths[key] -= reduction
        difference += reduction
        if (difference >= 0) break
    }
    return widths
}

export const CrosswalkTable: React.FC<CrosswalkTableProps> = React.memo(({
    crosswalks,
    isLoading,
    deletingId,
    onDelete,
}) => {
    const tableWrapperRef = React.useRef<HTMLDivElement>(null)
    const tableContainerRef = React.useRef<HTMLDivElement>(null)
    const manuallyResizedColumns = React.useRef(false)
    const [columnWidths, setColumnWidths] = React.useState(DEFAULT_COLUMN_WIDTHS)
    const tableWidth = Object.values(columnWidths).reduce((total, width) => total + width, 0)

    React.useLayoutEffect(() => {
        const container = tableContainerRef.current
        if (!container) return
        let animationFrame: number | undefined
        const updateWidths = (): void => {
            animationFrame = undefined
            if (container.clientWidth <= 0) return
            const body = container.querySelector<HTMLElement>('.ant-table-body')
            const scrollbarWidth = body ? body.offsetWidth - body.clientWidth : 0
            const availableWidth = Math.max(MIN_TABLE_WIDTH, container.clientWidth - scrollbarWidth)
            setColumnWidths(current => manuallyResizedColumns.current
                ? fitCurrentColumnWidths(current, availableWidth)
                : fitDefaultColumnWidths(availableWidth))
        }
        const observer = new ResizeObserver(() => {
            if (animationFrame === undefined) animationFrame = window.requestAnimationFrame(updateWidths)
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

    const columns: TableColumnsType<CrosswalkRegistryEntry> = [
        {
            title: nls.localize('rockit/crosswalkManager/name', 'Name'),
            dataIndex: 'name',
            key: 'name',
            ...resizableColumn('name', MIN_COLUMN_WIDTHS.name),
            sorter: (left, right) => left.name.localeCompare(right.name),
            ellipsis: true,
            render: (value: string) => <Typography.Text ellipsis>{value}</Typography.Text>,
        },
        {
            title: nls.localize('rockit/crosswalkManager/repositories', 'Repositories'),
            dataIndex: 'repositories',
            key: 'repositories',
            ...resizableColumn('repositories', MIN_COLUMN_WIDTHS.repositories),
            sorter: (left, right) => (left.repositories ?? []).join().localeCompare(
                (right.repositories ?? []).join(),
            ),
            ellipsis: true,
            render: (values: string[] | undefined) => values?.length
                ? values.map(repositoryLabel).join(' - ')
                : '—',
        },
        {
            title: nls.localize('rockit/crosswalkManager/rules', 'Rule counter'),
            dataIndex: 'ruleCount',
            key: 'ruleCount',
            ...resizableColumn('rules', MIN_COLUMN_WIDTHS.rules),
            sorter: (left, right) => (left.ruleCount ?? 0) - (right.ruleCount ?? 0),
            render: (value: number | undefined) => value === undefined
                ? '—'
                : new Intl.NumberFormat().format(value),
        },
        {
            title: nls.localize('rockit/crosswalkManager/importedAt', 'Imported'),
            dataIndex: 'importedAt',
            key: 'importedAt',
            className: 'crosswalk-table-last-resizable-column',
            ...resizableColumn('imported', MIN_COLUMN_WIDTHS.imported),
            sorter: (left, right) => (left.importedAt ?? '').localeCompare(right.importedAt ?? ''),
            render: (value: string | undefined, entry) => entry.builtIn
                ? nls.localize('rockit/crosswalkManager/builtIn', 'Built-in')
                : value ? new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
            }).format(new Date(value)) : '—',
        },
        {
            title: nls.localize('rockit/crosswalkManager/actions', 'Action'),
            key: 'action',
            className: 'crosswalk-table-actions-column',
            width: columnWidths.actions,
            align: 'center',
            render: (_value, entry) => <div className='crosswalk-table-actions-container'>
                <Popconfirm
                    disabled={entry.builtIn || deletingId === entry.id}
                    title={nls.localize('rockit/crosswalkManager/deleteQuestion', 'Delete this crosswalk?')}
                    description={nls.localize(
                        'rockit/crosswalkManager/deleteDescription',
                        'The stored crosswalk file will be removed from RocKIT.',
                    )}
                    okText={nls.localize('rockit/crosswalkManager/delete', 'Delete')}
                    cancelText={nls.localize('rockit/crosswalkManager/cancel', 'Cancel')}
                    okButtonProps={{ danger: true }}
                    onConfirm={() => onDelete(entry)}
                >
                    <Tooltip title={entry.builtIn
                        ? nls.localize('rockit/crosswalkManager/builtInCannotDelete', 'Built-in crosswalks cannot be deleted.')
                        : nls.localize('rockit/crosswalkManager/delete', 'Delete')}>
                        <span>
                            <IconButton
                                size='small'
                                disabled={entry.builtIn || deletingId === entry.id}
                                className='crosswalk-table-action-button crosswalk-table-action-button-delete'
                                aria-label={nls.localize('rockit/crosswalkManager/delete', 'Delete')}
                            >
                                <DeleteOutlineIcon className='crosswalk-table-action-icon' />
                            </IconButton>
                        </span>
                    </Tooltip>
                </Popconfirm>
            </div>,
        },
    ]

    const emptyState = <div className='crosswalk-table-empty-state'>
        <AccountTreeOutlinedIcon className='crosswalk-table-empty-icon' />
        <div className='crosswalk-table-empty-title'>
            {nls.localize('rockit/crosswalkManager/empty', 'No Crosswalks')}
        </div>
        <div className='crosswalk-table-empty-description'>
            {nls.localize(
                'rockit/crosswalkManager/emptyDescription',
                'Use Import Crosswalk to add a crosswalk JSON file.',
            )}
        </div>
    </div>

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
            },
        }}
    >
        <div
            ref={tableContainerRef}
            className='crosswalk-manager-table-container'
            style={{
                '--crosswalk-table-width': `${tableWidth}px`,
                '--crosswalk-name-width': `${columnWidths.name}px`,
                '--crosswalk-repositories-width': `${columnWidths.repositories}px`,
                '--crosswalk-rules-width': `${columnWidths.rules}px`,
                '--crosswalk-imported-width': `${columnWidths.imported}px`,
                '--crosswalk-actions-width': `${columnWidths.actions}px`,
            } as React.CSSProperties}
        >
            <Table<CrosswalkRegistryEntry>
                components={{ header: { cell: ResizableHeaderCell } }}
                dataSource={crosswalks}
                columns={columns}
                rowKey='id'
                size='small'
                showSorterTooltip={false}
                loading={isLoading}
                pagination={false}
                tableLayout='fixed'
                scroll={{ x: tableWidth, y: '100%' }}
                locale={{ emptyText: emptyState }}
            />
        </div>
    </ConfigProvider>
})

// src/browser/components/metadata-schema-table.tsx

import * as React from 'react';
import { Button, Input, Table, ConfigProvider, theme } from 'antd';
import type { InputRef, TableColumnsType } from 'antd';
import type { FilterDropdownProps, Key } from 'antd/es/table/interface';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import CircularProgress from '@mui/material/CircularProgress';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ReplayIcon from '@mui/icons-material/Replay';
import { IconButton, Tooltip } from '@mui/material';

import type { SchemaInfo, SchemaTableProps } from '../types';
import '../styles/metadata-schema-table.css';

export const MetadataSchemaTable: React.FC<SchemaTableProps> = React.memo(({ 
    schemas, 
    isLoading, 
    onSelectionChange, 
    onDelete,
    onRetry,
    allowDeleteValidSchemas = true,
    disableInvalidRows = false,
    selectionType = 'checkbox',
    selectedKeys = [] 
}) => {
    const searchInput = React.useRef<InputRef>(null);
    const tableWrapperRef = React.useRef<HTMLDivElement>(null);
    
    const isRowSelection = selectionType === 'row';

    const handleSearch = (confirm: () => void) => confirm();
    const handleReset = (clearFilters: () => void) => clearFilters();

    const getColumnSearchProps = (dataIndex: string | string[]) => ({
        filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: FilterDropdownProps) => (
            <div 
                className="schema-table__filter-dropdown"
                onKeyDown={(e: React.KeyboardEvent) => e.stopPropagation()}
            >
                <Input
                    ref={searchInput}
                    placeholder={`Search ${Array.isArray(dataIndex) ? dataIndex.join('.') : dataIndex}`}
                    value={selectedKeys[0]}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => 
                        setSelectedKeys(e.target.value ? [e.target.value] : [])
                    }
                    onPressEnter={() => handleSearch(confirm)}
                    className="schema-table__filter-input"
                />
                <div className="schema-table__filter-actions">
                    <Button 
                        type="primary" 
                        onClick={() => handleSearch(confirm)} 
                        size="small" 
                        className="schema-table__filter-btn"
                    >
                        Search
                    </Button>
                    <Button 
                        onClick={() => clearFilters && handleReset(clearFilters)} 
                        size="small" 
                        className="schema-table__filter-btn"
                    >
                        Reset
                    </Button>
                </div>
            </div>
        ),
        filterIcon: (filtered: boolean) => (
            <SearchIcon className={`schema-table__header-icon ${filtered ? 'schema-table__header-icon--active' : ''}`} />
        ),
        onFilter: (value: boolean | Key, record: any) => {
            const recordValue = Array.isArray(dataIndex) 
                ? dataIndex.reduce((obj, key) => obj?.[key], record) 
                : record[dataIndex];
            return (recordValue || '').toString().toLowerCase().includes(value.toString().toLowerCase());
        },
        onFilterDropdownOpenChange: (visible: boolean) => {
            if (visible) setTimeout(() => searchInput.current?.select(), 100);
        },
    });

    const columns: TableColumnsType<SchemaInfo> = [
        {
            title: 'Name',
            dataIndex: 'name',
            width: 220,
            ellipsis: true,
            sorter: (a, b) => {
                const aPriority = (a.status === 'ok' || !a.status) ? 1 : 0;
                const bPriority = (b.status === 'ok' || !b.status) ? 1 : 0;
                if (aPriority !== bPriority) return aPriority - bPriority;
                return a.name.localeCompare(b.name);
            },
            ...getColumnSearchProps('name'),
        },
        {
            title: 'Status',
            dataIndex: 'status',
            width: 130,
            sorter: (a, b) => {
                const getVal = (s: string) => s === 'failed' ? 2 : (s === 'ok' || !s) ? 3 : 1; 
                return getVal(a.status || 'ok') - getVal(b.status || 'ok');
            },
            render: (text: string, record: SchemaInfo) => {
                const status = text || 'ok';
                if (status === 'downloading' || status === 'processing') {
                    return (
                        <Tooltip title={record.statusMessage || 'Processing...'} placement="right">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--theia-focusBorder)' }}>
                                <CircularProgress size={14} color="inherit" />
                                <span style={{ fontSize: '12px' }}>{status === 'downloading' ? 'Downloading' : 'Processing'}</span>
                            </div>
                        </Tooltip>
                    );
                } else if (status === 'failed') {
                    return (
                        <Tooltip title={record.statusMessage || 'Failed'} placement="right">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--theia-errorForeground)' }}>
                                <ErrorOutlineIcon style={{ fontSize: '16px' }} />
                                <span style={{ fontSize: '12px' }}>Failed</span>
                            </div>
                        </Tooltip>
                    );
                } else {
                    return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#4caf50' }}>
                            <CheckCircleIcon style={{ fontSize: '16px' }} />
                            <span style={{ fontSize: '12px' }}>Ready</span>
                        </div>
                    );
                }
            }
        },
        {
            title: 'Version',
            dataIndex: 'version',
            width: 90,
            sorter: (a, b) => a.version.localeCompare(b.version),
        },
        {
            title: 'Source',
            dataIndex: 'source',
            width: 100,
            filters: [{ text: 'Local', value: 'local' }, { text: 'Remote', value: 'remote' }],
            onFilter: (value, record) => record.source === value,
            filterIcon: (filtered: boolean) => (
                <FilterListIcon className={`schema-table__header-icon ${filtered ? 'schema-table__header-icon--active' : ''}`} />
            ),
            render: (text: string) => (
                <span className={`schema-table__badge ${text === 'remote' ? 'schema-table__badge--remote' : 'schema-table__badge--local'}`}>
                    {text}
                </span>
            )
        },
        {
            title: 'Ref (@id)',
            dataIndex: ['aux', 'reference'],
            width: 240,
            ellipsis: true,
            ...getColumnSearchProps(['aux', 'reference']),
            render: (text: string) => text ? <a href={text} target="_blank" rel="noreferrer" className="schema-table__link" onClick={e => e.stopPropagation()}>{text}</a> : ''
        },
        {
            title: 'Conforms To',
            dataIndex: 'conformsTo',
            width: 240,
            ellipsis: true,
            ...getColumnSearchProps('conformsTo'),
            render: (text: string) => text ? <a href={text} target="_blank" rel="noreferrer" className="schema-table__link" onClick={e => e.stopPropagation()}>{text}</a> : ''
        }
    ];

    if (onDelete || onRetry) {
        columns.push({
            title: 'Action',
            key: 'action',
            width: 90,
            align: 'center',
            render: (_, record) => {
                const isTransient = record.status === 'downloading' || record.status === 'processing' || record.status === 'failed';
                const isOk = record.status === 'ok' || !record.status;
                
                if (isOk && !allowDeleteValidSchemas) {
                    return null; // Ensure the Selector window stays safe
                }

                return (
                    <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                        {record.status === 'failed' && onRetry && (
                            <Tooltip title="Retry" classes={{ tooltip: 'schema-table__tooltip' }} placement="top">
                                <IconButton 
                                    size="small" 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRetry(record.id);
                                    }}
                                    className="schema-table__action-btn"
                                >
                                    <ReplayIcon className="schema-table__retry-icon" fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        )}
                        {onDelete && (
                            <IconButton
                                size="small"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDelete([record.id]);
                                }}
                                className="schema-table__action-btn schema-table__delete-btn"
                                aria-label={isTransient ? 'Abort or remove schema task' : 'Delete schema'}
                            >
                                <DeleteOutlineIcon className="schema-table__delete-icon" />
                            </IconButton>
                        )}
                    </div>
                );
            }
        });
    }

    const activeSelectionType = isRowSelection ? undefined : selectionType;

    const emptyState = (
        <div className="schema-table__empty-state">
            <AccountTreeIcon className="schema-table__empty-icon" />
            <div className="schema-table__empty-title">No Metadata Schemas</div>
            <div className="schema-table__empty-desc">
                Click <strong>Import File</strong>, <strong>Import URL</strong>, or <strong>Browse Remote</strong> to add schemas.
            </div>
        </div>
    );

    return (
        <ConfigProvider
            getPopupContainer={() => tableWrapperRef.current || document.body}
            theme={{
                algorithm: theme.darkAlgorithm,
                token: {
                    colorBgContainer: 'var(--theia-editor-background)',
                    colorBgElevated: 'var(--theia-editor-background)',
                    colorText: 'var(--theia-foreground)',
                    colorTextHeading: 'var(--theia-foreground)',
                    colorBorder: 'var(--theia-panel-border)',
                    colorBorderSecondary: 'var(--theia-panel-border)',
                    colorPrimary: '#007acc',
                },
                components: {
                    Table: {
                        headerBg: 'var(--theia-list-headerBackground)',
                        headerColor: 'var(--theia-list-headerForeground)',
                        borderColor: 'var(--theia-panel-border)',
                        headerBorderRadius: 0,
                    },
                    Button: {
                        colorBgContainer: 'var(--theia-button-background)',
                        colorText: 'var(--theia-button-foreground)',
                        colorPrimaryHover: 'var(--theia-button-hoverBackground)',
                    },
                    Input: {
                        colorBgContainer: 'var(--theia-input-background)',
                        colorText: 'var(--theia-input-foreground)',
                        colorBorder: 'var(--theia-input-border)',
                    },
                    Pagination: {
                        itemActiveBg: 'var(--theia-button-background)',
                    }
                }
            }}
        >
            <div 
                ref={tableWrapperRef} 
                className={`schema-table-wrapper mode-${isRowSelection ? 'row' : 'checkbox'}`} 
            >
                <div className="schema-table-container">
                    <Table
                        dataSource={schemas}
                        columns={columns}
                        rowKey="id"
                        locale={{ emptyText: emptyState }}
                        rowSelection={activeSelectionType ? { 
                            type: activeSelectionType, 
                            selectedRowKeys: selectedKeys,
                            onChange: onSelectionChange,
                            columnWidth: 40,
                            // Only apply the disabled logic if the component explicitly asks for it
                            getCheckboxProps: disableInvalidRows ? (record) => ({
                                disabled: record.status !== 'ok' && record.status !== undefined,
                            }) : undefined
                        } : undefined}
                        
                        onRow={(record) => {
                            const isSelected = selectedKeys && selectedKeys.includes(record.id);
                            const isInvalid = record.status !== 'ok' && record.status !== undefined;
                            const isInteractionDisabled = disableInvalidRows && isInvalid;
                            
                            return {
                                onClick: () => {
                                    if (isInteractionDisabled) return;
                                    
                                    if (isRowSelection) {
                                        onSelectionChange([record.id]);
                                    } else {
                                        // Allow clicking anywhere on the row to toggle the checkbox
                                        const newKeys = isSelected 
                                            ? selectedKeys.filter(k => k !== record.id)
                                            : [...selectedKeys, record.id];
                                        onSelectionChange(newKeys);
                                    }
                                },
                                className: isSelected ? 'ant-table-row-selected' : '',
                                style: isInteractionDisabled 
                                    ? { cursor: 'not-allowed', opacity: 0.8 } 
                                    : { cursor: 'pointer' } // explicitly show it's clickable
                            };
                        }}
                        
                        size="small"
                        pagination={{ 
                            defaultPageSize: 10, 
                            showSizeChanger: true,
                            size: "small",
                            position: ['bottomRight'],
                            className: 'schema-table__pagination'
                        }}
                        loading={isLoading}
                        scroll={{ x: 1150, y: '100%' }}
                    />
                </div>
            </div>
        </ConfigProvider>
    );
});

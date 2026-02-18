// src/browser/components/metadata-schema-table.tsx

import * as React from 'react';
import { Button, Input, Table, ConfigProvider, theme } from 'antd';
import type { InputRef, TableColumnsType } from 'antd';
import type { FilterDropdownProps, Key } from 'antd/es/table/interface';
import type { SchemaInfo, SchemaTableProps } from '../types';

// MUI Icons
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { IconButton, Tooltip } from '@mui/material';

// Import CSS
import '../styles/metadata-schema-table.css';

export const MetadataSchemaTable: React.FC<SchemaTableProps> = React.memo(({ 
    schemas, 
    isLoading, 
    onSelectionChange, 
    onDelete,
    selectionType = 'checkbox',
    selectedKeys = [] 
}) => {
    const searchInput = React.useRef<InputRef>(null);
    // Reference to the wrapper div to attach popups to (Fixes Z-Index issues)
    const tableWrapperRef = React.useRef<HTMLDivElement>(null);
    
    // Determine layout mode: 'row' (Selector) vs 'checkbox' (Manager)
    const isRowSelection = selectionType === 'row';

    const handleSearch = (confirm: () => void) => confirm();
    const handleReset = (clearFilters: () => void) => clearFilters();

    const getColumnSearchProps = (dataIndex: keyof SchemaInfo) => ({
        filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: FilterDropdownProps) => (
            <div 
                className="schema-table__filter-dropdown"
                onKeyDown={(e: React.KeyboardEvent) => e.stopPropagation()}
            >
                <Input
                    ref={searchInput}
                    placeholder={`Search ${dataIndex}`}
                    value={selectedKeys[0]}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => 
                        setSelectedKeys(e.target.value ? [e.target.value] : [])
                    }
                    onPressEnter={() => handleSearch(confirm)}
                    className="schema-table__filter-input"
                />
                <div className="schema-table__filter-actions">
                    <Button type="primary" onClick={() => handleSearch(confirm)} size="small" style={{ width: 90 }}>
                        Search
                    </Button>
                    <Button onClick={() => clearFilters && handleReset(clearFilters)} size="small" style={{ width: 90 }}>
                        Reset
                    </Button>
                </div>
            </div>
        ),
        filterIcon: (filtered: boolean) => (
            <SearchIcon style={{ 
                color: filtered ? 'var(--theia-focusBorder)' : 'var(--theia-icon-foreground)',
                fontSize: '16px',
                opacity: filtered ? 1 : 0.7
            }} />
        ),
        onFilter: (value: boolean | Key, record: SchemaInfo) =>
            (record[dataIndex] || '').toString().toLowerCase().includes(value.toString().toLowerCase()),
        onFilterDropdownOpenChange: (visible: boolean) => {
            if (visible) setTimeout(() => searchInput.current?.select(), 100);
        },
    });

    const columns: TableColumnsType<SchemaInfo> = [
        {
            title: 'Schema Name',
            dataIndex: 'name',
            sorter: (a, b) => a.name.localeCompare(b.name),
            ...getColumnSearchProps('name'),
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
                <FilterListIcon style={{ 
                    color: filtered ? 'var(--theia-focusBorder)' : 'var(--theia-icon-foreground)',
                    fontSize: '16px',
                    opacity: filtered ? 1 : 0.7
                }} />
            ),
            render: (text: string) => (
                <span className={`schema-table__badge ${text === 'remote' ? 'schema-table__badge--remote' : 'schema-table__badge--local'}`}>
                    {text}
                </span>
            )
        },
        {
            title: 'Ref (@id)',
            dataIndex: 'reference',
            ellipsis: true,
            ...getColumnSearchProps('reference'),
            render: (text: string) => text ? <a href={text} target="_blank" rel="noreferrer" className="schema-table__link" onClick={e => e.stopPropagation()}>{text}</a> : ''
        },
        {
            title: 'Conforms To',
            dataIndex: 'conformsTo',
            ellipsis: true,
            ...getColumnSearchProps('conformsTo'),
            render: (text: string) => text ? <a href={text} target="_blank" rel="noreferrer" className="schema-table__link" onClick={e => e.stopPropagation()}>{text}</a> : ''
        },
        {
            title: 'Download URL',
            dataIndex: 'downloadUrl',
            ellipsis: true,
            ...getColumnSearchProps('downloadUrl'),
            render: (text: string) => text ? <a href={text} target="_blank" rel="noreferrer" className="schema-table__link" onClick={e => e.stopPropagation()}>{text}</a> : ''
        }
    ];

    if (onDelete) {
        columns.push({
            title: 'Action',
            key: 'action',
            width: 70,
            align: 'center',
            render: (_, record) => (
                <Tooltip title="Delete Schema" PopperProps={{ style: { zIndex: 99999 } }}>
                    <IconButton 
                        size="small" 
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete([record.path]);
                        }}
                        className="schema-table__action-btn"
                    >
                        <DeleteOutlineIcon style={{ fontSize: '18px' }} />
                    </IconButton>
                </Tooltip>
            ),
        });
    }

    const activeSelectionType = isRowSelection ? undefined : selectionType;

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
                // This class triggers the specific CSS rules for VS Code style or standard style
                className={`schema-table-wrapper mode-${isRowSelection ? 'row' : 'checkbox'}`} 
            >
                <div className="schema-table-container">
                    <Table
                        dataSource={schemas}
                        columns={columns}
                        rowKey="path"
                        rowSelection={activeSelectionType ? { 
                            type: activeSelectionType, 
                            selectedRowKeys: selectedKeys,
                            onChange: onSelectionChange,
                            columnWidth: 40
                        } : undefined}
                        
                        onRow={(record) => {
                            const isSelected = selectedKeys && selectedKeys.includes(record.path);
                            
                            return {
                                onClick: () => {
                                    // Only allow row click selection in 'Selector' mode
                                    if (isRowSelection) {
                                        onSelectionChange([record.path]);
                                    }
                                },
                                // The styling for this class is defined in metadata-schema-table.css
                                className: isSelected ? 'ant-table-row-selected' : '',
                            };
                        }}
                        
                        size="small"
                        pagination={{ 
                            pageSize: 15, 
                            showSizeChanger: true,
                            size: "small",
                            position: ['bottomRight'],
                            style: { marginBottom: 8, marginRight: 8 }
                        }}
                        loading={isLoading}
                        scroll={{ y: '100%' }}
                    />
                </div>
            </div>
        </ConfigProvider>
    );
});
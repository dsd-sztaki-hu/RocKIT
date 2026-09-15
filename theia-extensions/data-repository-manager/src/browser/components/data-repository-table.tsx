// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import * as React from 'react';
import { Table, ConfigProvider, Input, Button } from 'antd';
import type { InputRef, TableColumnsType } from 'antd';
import type { FilterDropdownProps, Key } from 'antd/es/table/interface';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import StorageIcon from '@mui/icons-material/Storage';
import SearchIcon from '@mui/icons-material/Search';
import { IconButton, Tooltip } from '@mui/material';
import { DataRepositoryConfig, DataRepositoryTableProps } from '../types';
import { nls } from '@theia/core/lib/common/nls';

import '../styles/data-repository-table.css';

export const DataRepositoryTable: React.FC<DataRepositoryTableProps> = React.memo(({ 
    repositories, 
    isLoading,
    selectedKeys = [],
    onSelectionChange,
    onDelete,
    onEdit
}) => {
    const tableWrapperRef = React.useRef<HTMLDivElement>(null);
    const searchInput = React.useRef<InputRef>(null);

    const handleSearch = (confirm: () => void) => confirm();
    const handleReset = (clearFilters: () => void) => clearFilters();

    // Text Search Filter Configuration
    const getColumnSearchProps = (dataIndex: keyof DataRepositoryConfig) => ({
        filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: FilterDropdownProps) => (
            <div 
                className="data-repo-table__filter-dropdown"
                onKeyDown={(e: React.KeyboardEvent) => e.stopPropagation()}
            >
                <Input
                    ref={searchInput}
                    placeholder={nls.localize('rockit/dataRepository/searchField', 'Search {0}', dataIndex)}
                    value={selectedKeys[0]}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => 
                        setSelectedKeys(e.target.value ? [e.target.value] : [])
                    }
                    onPressEnter={() => handleSearch(confirm)}
                    className="data-repo-table__filter-input"
                />
                <div className="data-repo-table__filter-actions">
                    <Button 
                        onClick={() => clearFilters && handleReset(clearFilters)} 
                        size="small" 
                        className="data-repo-table__filter-btn data-repo-table__filter-btn--reset"
                    >
                        {nls.localize('rockit/dataRepository/reset', 'Reset')}
                    </Button>
                    <Button 
                        type="primary" 
                        onClick={() => handleSearch(confirm)} 
                        size="small" 
                        className="data-repo-table__filter-btn data-repo-table__filter-btn--search"
                    >
                        {nls.localize('rockit/dataRepository/search', 'Search')}
                    </Button>
                </div>
            </div>
        ),
        filterIcon: (filtered: boolean) => (
            <SearchIcon style={{ 
                fontSize: 16, 
                color: filtered ? 'var(--theia-focusBorder)' : 'var(--theia-icon-foreground)' 
            }} />
        ),
        onFilter: (value: boolean | Key, record: DataRepositoryConfig) =>
            (record[dataIndex] || '').toString().toLowerCase().includes(value.toString().toLowerCase()),
        onFilterDropdownOpenChange: (visible: boolean) => {
            if (visible) setTimeout(() => searchInput.current?.select(), 100);
        },
    });

    const columns: TableColumnsType<DataRepositoryConfig> = [
        {
            title: nls.localize('rockit/dataRepository/repositoryName', 'Repository Name'),
            dataIndex: 'title',
            key: 'title',
            sorter: (a, b) => a.title.localeCompare(b.title),
            ...getColumnSearchProps('title'),
            ellipsis: true,
        },
        {
            title: nls.localize('rockit/dataRepository/baseUrl', 'Base URL'),
            dataIndex: 'baseUrl',
            key: 'baseUrl',
            sorter: (a, b) => a.baseUrl.localeCompare(b.baseUrl),
            ...getColumnSearchProps('baseUrl'),
            ellipsis: true,
            render: (text: string) => (
                <a 
                    href={text} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="data-repo-table__link"
                    onClick={(e) => e.stopPropagation()}
                >
                    {text}
                </a>
            )
        }
    ];

    if (onDelete || onEdit) {
        columns.push({
            title: nls.localize('rockit/dataRepository/action', 'Action'),
            key: 'action',
            width: 90, 
            align: 'center',
            render: (_, record) => (
                <div className="data-repo-table__actions-container">
                    {onEdit && (
                        <Tooltip title={nls.localize('rockit/dataRepository/editRepository', 'Edit Repository')} classes={{ tooltip: 'data-repo-table__tooltip' }}>
                            <IconButton 
                                size="small" 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onEdit(record);
                                }}
                                className="data-repo-table__action-btn data-repo-table__action-btn--edit"
                            >
                                <EditIcon className="data-repo-table__action-icon" />
                            </IconButton>
                        </Tooltip>
                    )}
                    {onDelete && (
                        <Tooltip title={nls.localize('rockit/dataRepository/deleteRepository', 'Delete Repository')} classes={{ tooltip: 'data-repo-table__tooltip' }}>
                            <IconButton 
                                size="small" 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDelete(record);
                                }}
                                className="data-repo-table__action-btn data-repo-table__action-btn--delete"
                            >
                                <DeleteOutlineIcon className="data-repo-table__action-icon" />
                            </IconButton>
                        </Tooltip>
                    )}
                </div>
            ),
        });
    }

    const customEmptyState = (
        <div className="data-repo-table__empty-state">
            <StorageIcon className="data-repo-table__empty-icon" />
            <div className="data-repo-table__empty-title">{nls.localize('rockit/dataRepository/noRepositories', 'No Data Repositories')}</div>
            <div className="data-repo-table__empty-desc">
                {nls.localize('rockit/dataRepository/noRepositoriesDescription', 'Use Add Repository to connect to a remote server.')}
            </div>
        </div>
    );

    return (
        <ConfigProvider
            getPopupContainer={() => tableWrapperRef.current || document.body}
            theme={{
                // Completely dynamic theme mapping to Theia's CSS Variables
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
                    }
                }
            }}
        >
            <div ref={tableWrapperRef} className="data-repo-table-wrapper">
                <Table
                    dataSource={repositories}
                    columns={columns}
                    rowKey="id"
                    size="small"
                    loading={isLoading}
                    pagination={false}
                    scroll={{ y: '100%' }}
                    locale={{ emptyText: customEmptyState }}
                    rowSelection={{
                        type: 'checkbox',
                        selectedRowKeys: selectedKeys,
                        onChange: (keys) => onSelectionChange && onSelectionChange(keys as React.Key[]),
                        columnWidth: 40
                    }}
                    onRow={(record) => {
                        const isSelected = selectedKeys && selectedKeys.includes(record.id);
                        return {
                            onClick: () => {
                                if (onSelectionChange && selectedKeys) {
                                    const newKeys = isSelected 
                                        ? selectedKeys.filter(k => k !== record.id) 
                                        : [...selectedKeys, record.id];
                                    onSelectionChange(newKeys);
                                }
                            },
                            className: isSelected ? 'ant-table-row-selected' : '',
                            style: { cursor: 'pointer' }
                        };
                    }}
                />
            </div>
        </ConfigProvider>
    );
});

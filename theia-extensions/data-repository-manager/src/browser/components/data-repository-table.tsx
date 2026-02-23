import * as React from 'react';
import { Table, ConfigProvider, theme } from 'antd';
import type { TableColumnsType } from 'antd';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import StorageIcon from '@mui/icons-material/Storage';
import { IconButton, Tooltip } from '@mui/material';
import { DataRepositoryConfig, DataRepositoryTableProps } from '../types';

import '../styles/data-repository-table.css';

export const DataRepositoryTable: React.FC<DataRepositoryTableProps> = React.memo(({ 
    repositories, 
    isLoading,
    onDelete,
    onEdit
}) => {
    const tableWrapperRef = React.useRef<HTMLDivElement>(null);

    const columns: TableColumnsType<DataRepositoryConfig> = [
        {
            title: 'Title (Display Name)',
            dataIndex: 'title',
            key: 'title',
            sorter: (a, b) => a.title.localeCompare(b.title),
            ellipsis: true,
        },
        {
            title: 'Type',
            dataIndex: 'type',
            key: 'type',
            width: 150,
            ellipsis: true,
        },
        {
            title: 'Base URL',
            dataIndex: 'baseUrl',
            key: 'baseUrl',
            ellipsis: true,
            render: (text: string) => (
                <a href={text} target="_blank" rel="noreferrer" className="data-repo-table__link">
                    {text}
                </a>
            )
        }
    ];

    if (onDelete || onEdit) {
        columns.push({
            title: 'Action',
            key: 'action',
            width: 90,
            align: 'center',
            render: (_, record) => (
                <div className="data-repo-table__actions-container">
                    {onEdit && (
                        <Tooltip title="Edit Repository" classes={{ tooltip: 'data-repo-table__tooltip' }}>
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
                        <Tooltip title="Delete Repository" classes={{ tooltip: 'data-repo-table__tooltip' }}>
                            <IconButton 
                                size="small" 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDelete(record.id);
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
            <div className="data-repo-table__empty-title">No Data Repositories</div>
            <div className="data-repo-table__empty-desc">
                Click <strong>Add Repository</strong> to connect to a remote server.
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
                    colorText: 'var(--theia-foreground)',
                    colorTextHeading: 'var(--theia-foreground)',
                    colorBorder: 'var(--theia-panel-border)',
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
                />
            </div>
        </ConfigProvider>
    );
});
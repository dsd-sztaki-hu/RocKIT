import * as React from 'react';
import { Table, ConfigProvider, theme } from 'antd';
import type { TableColumnsType } from 'antd';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { IconButton, Tooltip } from '@mui/material';
import { DataRepositoryConfig, DataRepositoryTableProps } from '../types';

import '../styles/data-repository-table.css';

export const DataRepositoryTable: React.FC<DataRepositoryTableProps> = React.memo(({ 
    repositories, 
    isLoading,
    onDelete
}) => {
    const tableWrapperRef = React.useRef<HTMLDivElement>(null);

    const columns: TableColumnsType<DataRepositoryConfig> = [
        {
            title: 'Title (Display Name)',
            dataIndex: 'title',
            key: 'title',
            sorter: (a, b) => a.title.localeCompare(b.title),
        },
        {
            title: 'Type',
            dataIndex: 'type',
            key: 'type',
            width: 150,
        },
        {
            title: 'Base URL',
            dataIndex: 'baseUrl',
            key: 'baseUrl',
            render: (text: string) => <a href={text} target="_blank" rel="noreferrer" className="data-repo-table__link">{text}</a>
        }
    ];

    if (onDelete) {
        columns.push({
            title: 'Action',
            key: 'action',
            width: 70,
            align: 'center',
            render: (_, record) => (
                <Tooltip title="Delete Repository" classes={{ tooltip: 'data-repo-table__tooltip' }}>
                    <IconButton 
                        size="small" 
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(record.id);
                        }}
                        className="data-repo-table__action-btn"
                    >
                        <DeleteOutlineIcon className="data-repo-table__delete-icon" />
                    </IconButton>
                </Tooltip>
            ),
        });
    }

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
                />
            </div>
        </ConfigProvider>
    );
});
import { Button, Input, Table } from 'antd';
import type { InputRef } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { FilterDropdownProps, Key } from 'antd/es/table/interface';
import * as React from 'react';

import type { SchemaInfo } from './types';

interface SchemaTableProps {
    schemas: SchemaInfo[];
    isLoading: boolean;
    onSelectionChange: (selectedRowKeys: Key[]) => void;
    onDelete: (schemaPaths: string[]) => void;
}

export const SchemaTable: React.FC<SchemaTableProps> = ({ schemas, isLoading, onSelectionChange, onDelete }) => {
    const searchInput = React.useRef<InputRef>(null);

    const handleSearch = (confirm: () => void) => {
        confirm();
    };

    const handleReset = (clearFilters: () => void) => {
        clearFilters();
    };

    const getColumnSearchProps = (dataIndex: keyof SchemaInfo) => ({
        filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: FilterDropdownProps) => (
            <div style={{ padding: 8 }}>
                <Input
                    ref={searchInput}
                    placeholder={`Search ${dataIndex}`}
                    value={selectedKeys[0]}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setSelectedKeys(e.target.value ? [e.target.value] : [])
                    }
                    onPressEnter={() => handleSearch(confirm)}
                    style={{ marginBottom: 8, display: 'block' }}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                    <Button
                        type="primary"
                        onClick={() => handleSearch(confirm)}
                        size="small"
                        style={{ width: 90 }}
                    >
                        Search
                    </Button>
                    <Button
                        onClick={() => clearFilters && handleReset(clearFilters)}
                        size="small"
                        style={{ width: 90 }}
                    >
                        Reset
                    </Button>
                </div>
            </div>
        ),
        filterIcon: (filtered: boolean) => (
            <span style={{ color: filtered ? '#1890ff' : undefined }}>🔍</span>
        ),
        onFilter: (value: boolean | Key, record: SchemaInfo) =>
            record[dataIndex]
                .toString()
                .toLowerCase()
                .includes(value.toString().toLowerCase()),
        onFilterDropdownOpenChange: (visible: boolean) => {
            if (visible) {
                setTimeout(() => searchInput.current?.select(), 100);
            }
        },
    });

    const columns: ColumnsType<SchemaInfo> = [
        {
            title: 'Schema Name',
            dataIndex: 'name',
            key: 'name',
            sorter: (a, b) => a.name.localeCompare(b.name),
            ...getColumnSearchProps('name'),
        },
        {
            title: 'Version',
            dataIndex: 'version',
            key: 'version',
            width: 100,
            sorter: (a, b) => a.version.localeCompare(b.version),
        },
        {
            title: 'Source',
            dataIndex: 'source',
            key: 'source',
            width: 100,
            filters: [
                { text: 'Local', value: 'local' },
                { text: 'Remote', value: 'remote' },
            ],
            onFilter: (value, record) => record.source === value,
        },
        {
            title: 'Reference (@id)',
            dataIndex: 'reference',
            key: 'reference',
            ellipsis: true,
            ...getColumnSearchProps('reference'),
        },
        {
            title: 'Action',
            key: 'action',
            width: 90,
            render: (_, record) => (
                <Button 
                    type="link" 
                    danger 
                    size="small" 
                    style={{ padding: 0 }} 
                    onClick={() => onDelete([record.path])}
                >
                    Delete
                </Button>
            ),
        },
    ];

    const rowSelection = {
        onChange: (selectedRowKeys: Key[]) => {
            onSelectionChange(selectedRowKeys);
        },
    };

    return (
        <Table
            dataSource={schemas}
            columns={columns}
            rowKey={(record) => record.path}
            rowSelection={{ type: 'checkbox', ...rowSelection }}
            size="small"
            pagination={{
                pageSize: 10,
                showSizeChanger: true,
                showTotal: (total) => `Total ${total} schemas`
            }}
            loading={isLoading}
        />
    );
};
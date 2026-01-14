import * as React from 'react';
import { Button, Input, Table } from 'antd';
import type { InputRef, TableColumnsType } from 'antd';
import type { FilterDropdownProps, Key } from 'antd/es/table/interface';
import type { SchemaInfo, SchemaTableProps } from '../types';

export const MetadataSchemaTable: React.FC<SchemaTableProps> = React.memo(({ 
    schemas, 
    isLoading, 
    onSelectionChange, 
    onDelete,
    selectionType = 'checkbox'
}) => {
    const searchInput = React.useRef<InputRef>(null);

    const handleSearch = (confirm: () => void) => confirm();
    const handleReset = (clearFilters: () => void) => clearFilters();

    const getColumnSearchProps = (dataIndex: keyof SchemaInfo) => ({
        filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: FilterDropdownProps) => (
            <div style={{ padding: 8 }}>
                <Input
                    ref={searchInput}
                    placeholder={`Search ${dataIndex}`}
                    value={selectedKeys[0]}
                    // FIX: Added explicit type annotation here
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
                    onPressEnter={() => handleSearch(confirm)}
                    style={{ marginBottom: 8, display: 'block' }}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
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
            <span style={{ color: filtered ? '#1890ff' : undefined }}>🔍</span>
        ),
        onFilter: (value: boolean | Key, record: SchemaInfo) =>
            record[dataIndex].toString().toLowerCase().includes(value.toString().toLowerCase()),
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
            width: 100,
            sorter: (a, b) => a.version.localeCompare(b.version),
        },
        {
            title: 'Source',
            dataIndex: 'source',
            width: 100,
            filters: [{ text: 'Local', value: 'local' }, { text: 'Remote', value: 'remote' }],
            onFilter: (value, record) => record.source === value,
        },
        {
            title: 'Reference (@id)',
            dataIndex: 'reference',
            ellipsis: true,
            ...getColumnSearchProps('reference'),
        },
    ];

    if (onDelete) {
        columns.push({
            title: 'Action',
            key: 'action',
            width: 90,
            render: (_, record) => (
                <Button 
                    type="link" danger size="small" 
                    onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        onDelete([record.path]);
                    }}
                >
                    Delete
                </Button>
            ),
        });
    }

    return (
        <Table
            dataSource={schemas}
            columns={columns}
            rowKey="path"
            rowSelection={{ type: selectionType, onChange: onSelectionChange }}
            size="small"
            pagination={{ pageSize: 10, showSizeChanger: true }}
            loading={isLoading}
        />
    );
});
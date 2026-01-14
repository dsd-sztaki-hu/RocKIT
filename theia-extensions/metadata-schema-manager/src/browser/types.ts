import type { Key } from 'antd/es/table/interface';

export interface SchemaInfo {
    name: string;
    source: 'local' | 'remote';
    version: string;
    reference: string;
    path: string;
}

export interface SchemaTableProps {
    schemas: SchemaInfo[];
    isLoading: boolean;
    onSelectionChange: (selectedRowKeys: Key[]) => void;
    onDelete?: (schemaPaths: string[]) => void; // Optional now
    onRowDoubleClick?: (record: SchemaInfo) => void; // New
    selectionType?: 'checkbox' | 'radio'; // New
}
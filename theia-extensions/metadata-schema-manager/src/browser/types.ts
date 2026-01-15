import type { Key } from 'antd/es/table/interface';

export interface SchemaInfo {
    name: string;
    version: string;
    source: 'local' | 'remote';
    reference: string;
    path: string;
}

export interface SchemaTableProps {
    schemas: SchemaInfo[];
    isLoading: boolean;
    selectionType?: 'checkbox' | 'radio';
    onSelectionChange: (selectedRowKeys: Key[]) => void;
    onDelete?: (schemaPaths: string[]) => void;
}
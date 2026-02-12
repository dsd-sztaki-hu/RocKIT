import type { Key } from 'antd/es/table/interface';

export interface SchemaInfo {
    name: string;
    version: string;
    source: 'local' | 'remote';
    reference: string; // This is the @id
    path: string;
    conformsTo?: string; 
    downloadUrl?: string;
}

export interface SchemaTableProps {
    schemas: SchemaInfo[];
    isLoading: boolean;
    selectionType?: 'checkbox' | 'radio';
    onSelectionChange: (selectedRowKeys: Key[]) => void;
    onDelete?: (schemaPaths: string[]) => void;
}

export interface RemoteSchemaProviderConfig {
    id: string;
    title: string;
    baseUrl: string;
    type: 'CEDAR'; // Currently only CEDAR is supported
    apiKey?: string;
}
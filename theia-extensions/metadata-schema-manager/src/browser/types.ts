// src/browser/types.ts

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
    // 'row' = click row to select (Selector), 'checkbox' = checkboxes (Main Widget)
    selectionType?: 'checkbox' | 'radio' | 'row'; 
    // Controlled state for selection
    selectedKeys?: Key[]; 
    onSelectionChange: (selectedRowKeys: Key[]) => void;
    onDelete?: (schemaPaths: string[]) => void;
}

export interface RemoteSchemaProviderConfig {
    id: string;
    title: string;
    baseUrl: string;
    domainBase: string;
    type: 'CEDAR';
    apiKey?: string;
}
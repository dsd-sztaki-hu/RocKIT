// src/browser/types.ts

import type { Key } from 'antd/es/table/interface';

export interface SchemaFiles {
    sourcePath: string;
    convertedPath: string;
}

export interface SchemaInfo {
    id: string;
    templateUuid?: string;
    name: string;
    version: string;
    source: 'local' | 'remote';
    reference: string; // This is the @id
    type: string;
    files: SchemaFiles;
    conformsTo?: string; 
    downloadUrl?: string;
    createdAt: string | null;
    updatedAt: string | null;
}

export interface SchemaIndex {
    profiles: SchemaInfo[];
    conformsToIndex: Record<string, string[]>;
}

export interface SchemaTableProps {
    schemas: SchemaInfo[];
    isLoading: boolean;
    selectionType?: 'checkbox' | 'radio' | 'row'; 
    selectedKeys?: Key[]; 
    onSelectionChange: (selectedRowKeys: Key[]) => void;
    onDelete?: (schemaIds: string[]) => void;
}

export interface RemoteSchemaProviderConfig {
    id: string;
    title: string;
    baseUrl: string;
    domainBase: string;
    type: 'CEDAR';
    apiKey?: string;
}
// src/browser/types.ts

import type { Key } from 'antd/es/table/interface';

export interface SchemaFiles {
    sourcePath: string;
    convertedPath: string;
}

export interface SchemaAux {
    templateUuid?: string;
    reference: string;
}

export interface SchemaInfo {
    id: string; // Truly unique generated ID
    name: string;
    version: string;
    source: 'local' | 'remote';
    type: string;
    files: SchemaFiles;
    aux: SchemaAux;
    conformsTo?: string; 
    downloadUrl?: string;
    createdAt: string | null;
    updatedAt: string | null;
    downloadedAt: string;
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
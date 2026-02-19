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
    baseUrl: string; // What the user entered (e.g. https://cedar.schema.researchdata.hu)
    domainBase: string; // The functional base (e.g. https://schema.researchdata.hu)
    type: 'CEDAR';
    apiKey?: string;
}
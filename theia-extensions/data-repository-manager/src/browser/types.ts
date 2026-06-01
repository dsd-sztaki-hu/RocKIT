import type { Key } from 'react';

export interface DataRepositoryConfig {
    id: string;
    title: string;
    type: 'ARP Dataverse' | string;
    baseUrl: string;
    apiKey?: string;
}

export interface DataRepositoryTableProps {
    repositories: DataRepositoryConfig[];
    isLoading: boolean;
    selectedKeys?: Key[];
    onSelectionChange?: (keys: Key[]) => void;
    onDelete?: (repo: DataRepositoryConfig) => void;
    onEdit?: (repo: DataRepositoryConfig) => void;
}

export interface DataRepositoryToolbarProps {
    onImport: () => void;
    onExport: () => void;
    onConfigure: () => void;
    selectedCount?: number;
    onDeleteSelected?: () => void;
}

export interface DataverseCollection {
    id: string;
    alias: string;
    name: string;
    description?: string;
    parentAlias?: string;
    isWritable?: boolean;
}

export interface DataverseUserRole {
    id: string;
    name: string;
    alias: string;
}

export interface DataverseCollectionBrowserState {
    selectedCollection?: DataverseCollection;
    repository: DataRepositoryConfig;
}

export interface DataverseCollectionSelection {
    collection: DataverseCollection;
    metadataLanguage: 'en' | 'hu';
}

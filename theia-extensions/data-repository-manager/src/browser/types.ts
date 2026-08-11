import type { Key } from 'react';

export interface DataRepositoryConfig {
    id: string;
    title: string;
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
}

export interface DataRepositorySelection {
    repository: DataRepositoryConfig;
    capabilities: DataRepositoryCapabilities;
    exportTarget?: DataRepositoryExportTarget;
    action?: 'export' | 'sync';
}

export type DataRepositoryKind = 'arp-dataverse' | 'dataverse' | 'zenodo' | 'unknown';

export interface DataRepositoryCapabilities {
    kind: DataRepositoryKind;
    supportsArpRoCrateZipUpload: boolean;
    supportsNativeDataverseApi: boolean;
    supportsZenodoApi: boolean;
}

export interface DataRepositoryExportTarget {
    pid: string;
    target: string;
    repository: string;
    mappingFile: string;
    crosswalkFile?: string;
    lastSuccessfulActionAt?: string;
    syncType: 'create' | 'update' | 'sync';
    datasetName?: string;
    remoteState?: 'draft' | 'published';
}

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
    onDelete?: (id: string) => void;
    onEdit?: (repo: DataRepositoryConfig) => void;
}

export interface DataRepositoryToolbarProps {
    onImport: () => void;
    onExport: () => void;
    onConfigure: () => void;
    selectedCount?: number;
    onDeleteSelected?: () => void;
}
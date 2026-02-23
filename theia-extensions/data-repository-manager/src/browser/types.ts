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
    onDelete?: (id: string) => void;
}

export interface DataRepositoryToolbarProps {
    onImport: () => void;
    onExport: () => void;
    onConfigure: () => void;
}
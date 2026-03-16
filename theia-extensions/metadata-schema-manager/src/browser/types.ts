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
  
  // Transient state for UI feedback
  status?: 'downloading' | 'processing' | 'ok' | 'failed';
  statusMessage?: string;
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
  allowDeleteValidSchemas?: boolean; // Controls whether 'ok' schemas show the delete bin
  disableInvalidRows?: boolean;      // Controls whether transient/failed schemas can be selected
  onSelectionChange: (selectedRowKeys: Key[]) => void;
  onDelete?: (schemaIds: string[]) => void;
  onRetry?: (schemaId: string) => void;
}

export interface RemoteSchemaProviderConfig {
  id: string;
  title: string;
  baseUrl: string;
  domainBase: string;
  type: 'CEDAR';
  apiKey?: string;
}
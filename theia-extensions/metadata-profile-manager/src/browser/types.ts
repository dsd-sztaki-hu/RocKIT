// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

// src/browser/types.ts

import type { Key } from 'antd/es/table/interface';

export interface ProfileFiles {
  sourcePath: string;
  convertedPath: string;
  convertedPaths?: Partial<Record<'en' | 'hu', string>>;
}

export interface ProfileAux {
  templateUuid?: string;
  reference: string;
  conversionLanguage?: 'en' | 'hu';
}

export interface ProfileInfo {
  id: string; // Truly unique generated ID
  name: string;
  version: string;
  source: 'local' | 'remote';
  type: string;
  files: ProfileFiles;
  aux: ProfileAux;
  conformsTo?: string; 
  downloadUrl?: string;
  createdAt: string | null;
  updatedAt: string | null;
  downloadedAt: string;
  
  // Transient state for UI feedback
  status?: 'downloading' | 'processing' | 'ok' | 'failed';
  statusMessage?: string;
}

export type ProfileHealthIssueStatus = 'missing' | 'failed';

export interface ProfileHealthIssue {
  conformsTo: string;
  status: ProfileHealthIssueStatus;
  profileName?: string;
  message?: string;
}

export interface ProfileHealthStatus {
  requiredCount: number;
  okCount: number;
  issues: ProfileHealthIssue[];
}

export interface ProfileIndex {
  profiles: ProfileInfo[];
  conformsToIndex: Record<string, string[]>;
}

export interface ProfileTableProps {
  profiles: ProfileInfo[];
  isLoading: boolean;
  selectionType?: 'checkbox' | 'radio' | 'row'; 
  selectedKeys?: Key[]; 
  allowDeleteValidSchemas?: boolean; // Controls whether 'ok' schemas show the delete bin
  disableInvalidRows?: boolean;      // Controls whether transient/failed schemas can be selected
  onSelectionChange: (selectedRowKeys: Key[]) => void;
  onRowDoubleClick?: (profile: ProfileInfo) => void;
  onDelete?: (profileIds: string[]) => void;
  onRetry?: (profileId: string) => void;
}

export interface RemoteProfileProviderConfig {
  id: string;
  title: string;
  baseUrl: string;
  domainBase: string;
  type: 'CEDAR';
  resourceBaseUrl?: string;
  registryFolderId?: string;
  accessMode?: 'apiKey' | 'dataverseProxy';
  dataverseProxyBaseUrl?: string;
  apiKey?: string;
}

export const DEFAULT_ARP_PRODUCTION_PROVIDER: Readonly<RemoteProfileProviderConfig> = {
  id: 'arp-prod',
  title: 'ARP Production',
  baseUrl: 'https://cedar.schema.researchdata.hu/',
  domainBase: 'schema.researchdata.hu',
  type: 'CEDAR',
  resourceBaseUrl: 'https://resource.schema.researchdata.hu',
  registryFolderId: 'https://repo.schema.researchdata.hu/folders/49ba90b3-86ee-45b8-a623-d4a7a7df926c',
  accessMode: 'dataverseProxy',
  dataverseProxyBaseUrl: 'https://repo.researchdata.hu'
};

export function createDefaultArpProductionProvider(): RemoteProfileProviderConfig {
  return { ...DEFAULT_ARP_PRODUCTION_PROVIDER };
}

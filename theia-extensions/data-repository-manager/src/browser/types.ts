// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { Key } from 'react'

export interface DataRepositoryConfig {
  id: string
  title: string
  baseUrl: string
  apiKey?: string
  /**
   * Repository provider registered by an installed extension.
   *
   * Existing connections omit this value and continue through RocKIT's
   * built-in URL capability detection until they are migrated.
   */
  providerId?: string
  /** Identifier of the crosswalk selected from RocKIT's application registry. */
  crosswalkId?: string
}

export interface DataRepositoryTableProps {
  repositories: DataRepositoryConfig[]
  isLoading: boolean
  selectedKeys?: Key[]
  onSelectionChange?: (keys: Key[]) => void
  onDelete?: (repo: DataRepositoryConfig) => void
  onEdit?: (repo: DataRepositoryConfig) => void
}

export interface DataRepositoryToolbarProps {
  onImport: () => void
  onExport: () => void
  onConfigure: () => void
  selectedCount?: number
  onDeleteSelected?: () => void
}

export interface DataverseCollection {
  id: string
  alias: string
  name: string
  description?: string
  parentAlias?: string
  isWritable?: boolean
}

export interface DataverseUserRole {
  id: string
  name: string
  alias: string
}

export interface DataverseCollectionBrowserState {
  selectedCollection?: DataverseCollection
  repository: DataRepositoryConfig
}

export interface DataverseCollectionSelection {
  collection: DataverseCollection
}

export interface DataRepositorySelection {
  repository?: DataRepositoryConfig
  exportTarget?: DataRepositoryExportTarget
  action?: 'export' | 'sync' | 'import' | 'link'
  syncMode?: RepositorySyncMode
}

export type RepositorySyncMode = 'complete' | 'remote-additions' | 'local-additions'

export type DataRepositoryKind = 'arp-dataverse' | 'dataverse' | 'unknown'

export interface DataRepositoryExportTarget {
  pid: string
  target: string
  repository: string
  mappingFile: string
  crosswalkFile?: string
  lastSuccessfulActionAt?: string
  syncType: 'create' | 'update' | 'sync'
  datasetName?: string
  remoteState?: 'draft' | 'published'
  status?: 'success' | 'failed' | 'cancelled'
  errorMessage?: string
}

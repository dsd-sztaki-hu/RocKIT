// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

//  EIRCEIA - editor id to RO-Crate entity id associations
import type { RoCrateApprovalFile } from './ro-crate-approval'

export type EIRCEIA = Record<string, string>
export type ValidationError = {
  path: string;
  entityId: string;
  entityType: string;
  fieldName: string;
  fieldLabel: string;
  error: string;
  error_hu: string;
  errorCode: string;
}

export type SchemaSelectorContext = {
  widgetId: string
  entityId: string
}

export type ProfileListItem = {
  id: string
  content: Record<string, any> | undefined
  flag: string
}

// Define the default application state. This defines the shape of the state and initial values.
export const defaultAppState = {
  roCrate: undefined as Record<string, any> | undefined,
  roCrateApproval: undefined as RoCrateApprovalFile | undefined,
  ignoreList: undefined as string[] | undefined,
  profile: undefined as Record<string, any> | undefined,
  selectedEntityId: undefined as string | undefined,
  EIRCEIA: undefined as EIRCEIA | undefined,
  isROCrateInvalid: false,
  dirty: false,
  theme: 'light' as 'light' | 'dark',
  notifications: [] as string[],
  settings: {
    autoSave: true,
    fontSize: 14,
  },
  openSchemaSelectorWindow: false,
  schemaSelectorContext: undefined as SchemaSelectorContext | undefined,
  completeProfile: undefined as Record<string, any> | undefined,
  profileList: undefined as ProfileListItem[] | undefined,
  validationErrors: undefined as ValidationError[] | undefined,
  fileExplorerFiltersVisible: false,
  entitiesOverviewFiltersVisible: true,
  nativeAgentActivityExpanded: false,
}

export type AppState = typeof defaultAppState

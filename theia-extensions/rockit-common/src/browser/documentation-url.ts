// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { OpenerService, open } from '@theia/core/lib/browser'
import { ApplicationServer } from '@theia/core/lib/common/application-protocol'
import URI from '@theia/core/lib/common/uri'

export const ROCKIT_DOCUMENTATION_PAGES = {
  QUICK_START_OPEN_AND_EDIT:
    'getting-started/quick-start-open-and-edit-an-existing-ro-crate',
  WORKSPACE_AND_FILE_HANDLING: 'interface/workspace-and-file-handling',
  RO_CRATE_STRUCTURE_PANEL: 'interface/ro-crate-structure-panel',
  ENTITIES_PANEL: 'interface/entities-panel',
  RO_CRATE_EDITOR: 'editing/ro-crate-editor',
  METADATA_SCHEMA_MANAGER: 'schemas/metadata-schema-manager',
  DATA_REPOSITORY_MANAGER: 'repositories/data-repository-manager',
  REPOSITORY_EXPORT_IMPORT:
    'preview-export/repository-export-import#export%C3%A1l%C3%A1s-repozit%C3%B3riumba',
  VALIDATION: 'editing/validation',
  PREVIEW: 'editing/preview',
} as const

export function documentationVersion(version: string): string {
  const trimmed = version.trim().replace(/^v\s*/i, '')
  const match = /^(\d+)\.(\d+)/.exec(trimmed)
  return match ? `${match[1]}.${match[2]}` : 'latest'
}

export function buildDocumentationUrl(version: string, pagePath = ''): string {
  const segment = encodeURIComponent(documentationVersion(version))
  const baseUrl = `https://repo.researchdata.hu/rockit/${segment}/`
  const normalizedPath = pagePath.trim().replace(/^\/+/, '')
  return normalizedPath ? `${baseUrl}${normalizedPath}` : baseUrl
}

export async function openRockitDocumentationPage(
  applicationServer: ApplicationServer,
  openerService: OpenerService,
  pagePath: string,
): Promise<void> {
  const appInfo = await applicationServer.getApplicationInfo()
  const url = buildDocumentationUrl(appInfo?.version ?? 'latest', pagePath)
  await open(openerService, new URI(url), { openExternalApp: true })
}

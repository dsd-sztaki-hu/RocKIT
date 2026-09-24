// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { DEFAULT_WORKFLOW_DOC, WORKFLOW_DOCS_BUNDLE } from './workflow-docs-bundle'
import type { AgentSessionContext } from './agent-session-context'

export type AgentWorkflowDocPayload = {
  name: string
  content: string
  availableDocs: string[]
  sessionContext?: AgentSessionContext
}

export function listAgentWorkflowDocNames(): string[] {
  return Object.keys(WORKFLOW_DOCS_BUNDLE)
}

export function readAgentWorkflowDoc(
  params: Record<string, unknown>,
  sessionContext?: AgentSessionContext,
): AgentWorkflowDocPayload {
  const availableDocs = listAgentWorkflowDocNames()
  const rawName = params.name
  const name =
    typeof rawName === 'string' && rawName.trim() !== ''
      ? rawName.trim()
      : DEFAULT_WORKFLOW_DOC
  const content = WORKFLOW_DOCS_BUNDLE[name]
  if (content === undefined) {
    throw new Error(
      `Unknown workflow doc: ${name}. Available docs: ${availableDocs.join(', ')}`,
    )
  }
  const sessionNote =
    name === DEFAULT_WORKFLOW_DOC && sessionContext?.launchContext === 'inside_aroma'
      ? '\n\n## Current Session Context\n\nThis agent session was launched from inside AROMA. AROMA is already open for this RO-Crate workflow. Do not suggest opening AROMA after edits, and do not call `open_aroma_for_local_file` unless the user explicitly asks.\n'
      : ''
  return {
    name,
    content: `${content}${sessionNote}`,
    availableDocs,
    sessionContext,
  }
}

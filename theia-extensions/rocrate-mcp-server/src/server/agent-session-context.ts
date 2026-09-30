// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

export type AgentLaunchContext = 'inside_rockit' | 'inside_aroma' | 'external'

export type AgentSessionContext = {
  launchContext: AgentLaunchContext
  editorAlreadyOpen: boolean
  /** @deprecated Use editorAlreadyOpen. Kept for older MCP clients. */
  aromaAlreadyOpen?: boolean
}

const contexts = new Map<string, AgentSessionContext>()

function parseLaunchContext(value: unknown): AgentLaunchContext {
  if (value === 'inside_rockit' || value === 'inside_aroma' || value === 'external') {
    return value
  }
  throw new Error('launchContext must be "inside_rockit", "inside_aroma", or "external".')
}

export function setAgentSessionContext(
  sessionKey: string | undefined,
  params: Record<string, unknown>,
): AgentSessionContext {
  if (!sessionKey) {
    throw new Error('set_agent_session_context requires an active MCP session.')
  }
  const launchContext = parseLaunchContext(params.launchContext)
  const editorAlreadyOpen =
    typeof params.editorAlreadyOpen === 'boolean'
      ? params.editorAlreadyOpen
      : typeof params.aromaAlreadyOpen === 'boolean'
        ? params.aromaAlreadyOpen
        : launchContext !== 'external'
  const context = {
    launchContext,
    editorAlreadyOpen,
    ...(launchContext === 'inside_aroma' || typeof params.aromaAlreadyOpen === 'boolean'
      ? { aromaAlreadyOpen: editorAlreadyOpen }
      : {}),
  }
  contexts.set(sessionKey, context)
  return context
}

export function getAgentSessionContext(
  sessionKey: string | undefined,
): AgentSessionContext | undefined {
  return sessionKey ? contexts.get(sessionKey) : undefined
}

export function clearAgentSessionContext(sessionKey: string): void {
  contexts.delete(sessionKey)
}

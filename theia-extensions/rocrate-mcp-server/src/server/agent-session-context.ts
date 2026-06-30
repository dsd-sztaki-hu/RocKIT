export type AgentLaunchContext = 'inside_aroma' | 'external'

export type AgentSessionContext = {
  launchContext: AgentLaunchContext
  aromaAlreadyOpen: boolean
}

const contexts = new Map<string, AgentSessionContext>()

function parseLaunchContext(value: unknown): AgentLaunchContext {
  if (value === 'inside_aroma' || value === 'external') {
    return value
  }
  throw new Error('launchContext must be "inside_aroma" or "external".')
}

export function setAgentSessionContext(
  sessionKey: string | undefined,
  params: Record<string, unknown>,
): AgentSessionContext {
  if (!sessionKey) {
    throw new Error('set_agent_session_context requires an active MCP session.')
  }
  const launchContext = parseLaunchContext(params.launchContext)
  const aromaAlreadyOpen =
    typeof params.aromaAlreadyOpen === 'boolean'
      ? params.aromaAlreadyOpen
      : launchContext === 'inside_aroma'
  const context = {
    launchContext,
    aromaAlreadyOpen,
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

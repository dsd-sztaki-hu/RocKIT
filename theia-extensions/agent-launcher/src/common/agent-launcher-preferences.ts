import {
  createPreferenceProxy,
  PreferenceContribution,
  PreferenceProxy,
  PreferenceSchema,
  PreferenceService,
} from '@theia/core'
import { interfaces } from '@theia/core/shared/inversify'

export const AROMA_AGENT_INSTRUCTIONS_COPY_TO_WORKSPACE =
  'aroma.agentInstructions.copyToWorkspace'

export type AgentLauncherConfiguration = {
  [AROMA_AGENT_INSTRUCTIONS_COPY_TO_WORKSPACE]: boolean
}

export type AgentLauncherPreferences = PreferenceProxy<AgentLauncherConfiguration>

export const AgentLauncherConfigSchema: PreferenceSchema = {
  properties: {
    [AROMA_AGENT_INSTRUCTIONS_COPY_TO_WORKSPACE]: {
      type: 'boolean',
      default: false,
      description:
        'Controls whether AROMA writes AGENTS.md/CLAUDE.md and .aroma workflow docs into RO-Crate workspaces when launching external agents. Disabled uses the pure MCP workflow-doc tool instead.',
    },
  },
}

export const AgentLauncherPreferenceContribution = Symbol(
  'AgentLauncherPreferenceContribution',
)
export const AgentLauncherPreferences = Symbol('AgentLauncherPreferences')

export function createAgentLauncherPreferences(
  preferences: PreferenceService,
  schema: PreferenceSchema = AgentLauncherConfigSchema,
): AgentLauncherPreferences {
  return createPreferenceProxy(preferences, schema)
}

export function bindAgentLauncherPreferences(bind: interfaces.Bind): void {
  bind(AgentLauncherPreferences).toDynamicValue((ctx) => {
    const preferences = ctx.container.get<PreferenceService>(PreferenceService)
    const contribution = ctx.container.get<PreferenceContribution>(
      AgentLauncherPreferenceContribution,
    )
    return createAgentLauncherPreferences(preferences, contribution.schema)
  })
  bind(AgentLauncherPreferenceContribution).toConstantValue({
    schema: AgentLauncherConfigSchema,
  })
  bind(PreferenceContribution).toService(AgentLauncherPreferenceContribution)
}

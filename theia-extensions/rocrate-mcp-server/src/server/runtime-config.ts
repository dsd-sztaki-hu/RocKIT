/**
 * Runtime overrides for environment-backed MCP configuration.
 *
 * Environment variables remain the default source. Values supplied through
 * the dashboard are kept in memory and take precedence until they are
 * cleared or the MCP process restarts.
 */

export const RUNTIME_ENV_KEYS = [
  'TAVILY_API_KEY',
  'DATAVERSE_BASE_URL',
  'DATAVERSE_API_KEY',
] as const

export type RuntimeEnvKey = (typeof RUNTIME_ENV_KEYS)[number]

const runtimeOverrides = new Map<RuntimeEnvKey, string>()

function normalizeRuntimeValue(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Returns the effective value for an environment-backed configuration key.
 */
export function getRuntimeEnvValue(key: RuntimeEnvKey): string | undefined {
  return runtimeOverrides.get(key) ?? normalizeRuntimeValue(process.env[key])
}

/**
 * Returns the dashboard override, if one is active.
 */
export function getRuntimeEnvOverride(key: RuntimeEnvKey): string | undefined {
  return runtimeOverrides.get(key)
}

/**
 * Sets or clears a dashboard override. Empty values are treated as a clear,
 * which makes the original environment value available again.
 */
export function setRuntimeEnvOverride(
  key: RuntimeEnvKey,
  value: string | null | undefined,
): void {
  const normalized = normalizeRuntimeValue(value ?? undefined)
  if (normalized === undefined) {
    runtimeOverrides.delete(key)
    return
  }

  runtimeOverrides.set(key, normalized)
}

/**
 * Clears all dashboard overrides. Intended for tests and process-level reset
 * paths; normal callers should clear individual settings through the API.
 */
export function clearRuntimeEnvOverrides(): void {
  runtimeOverrides.clear()
}

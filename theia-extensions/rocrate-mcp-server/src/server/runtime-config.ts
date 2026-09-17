// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

/**
 * Runtime overrides for environment-backed MCP configuration.
 *
 * Environment variables remain the default source. Values supplied through
 * the dashboard are persisted under the shared RocKIT storage root and take
 * precedence until they are cleared.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { resolveProfileRootPath } from 'metadata-profile-core'

export const RUNTIME_ENV_KEYS = [
  'TAVILY_API_KEY',
  'DATAVERSE_BASE_URL',
  'DATAVERSE_API_KEY',
  'ROCRATE_DATAVERSE_KEEP_UPLOAD_ZIPS',
] as const

export type RuntimeEnvKey = (typeof RUNTIME_ENV_KEYS)[number]

export const RUNTIME_CONFIG_FILE_NAME = 'rocrate-mcp-settings.json'

type PersistedRuntimeConfig = {
  version: 1
  updatedAt: string
  overrides: Partial<Record<RuntimeEnvKey, string>>
}

export type RuntimeEnvOverrideUpdate = {
  key: RuntimeEnvKey
  value: string | null | undefined
}

const runtimeOverrides = new Map<RuntimeEnvKey, string>()
let persistedOverridesLoaded = false
let persistedOverridesPath: string | undefined

function normalizeRuntimeValue(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function getPersistedOverridesPath(): string {
  if (!persistedOverridesPath) {
    persistedOverridesPath = path.join(
      resolveProfileRootPath(),
      RUNTIME_CONFIG_FILE_NAME,
    )
  }
  return persistedOverridesPath
}

function logPersistenceWarning(message: string): void {
  process.stderr.write(`RO-Crate MCP runtime settings: ${message}\n`)
}

function loadPersistedOverrides(): void {
  if (persistedOverridesLoaded) {
    return
  }

  const filePath = getPersistedOverridesPath()
  persistedOverridesLoaded = true

  if (!fs.existsSync(filePath)) {
    return
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logPersistenceWarning(`could not read ${filePath}: ${message}`)
    return
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    (parsed as { version?: unknown }).version !== 1 ||
    !('overrides' in parsed) ||
    !parsed.overrides ||
    typeof parsed.overrides !== 'object' ||
    Array.isArray(parsed.overrides)
  ) {
    logPersistenceWarning(`ignoring invalid settings file: ${filePath}`)
    return
  }

  const overrides = parsed.overrides as Record<string, unknown>
  for (const key of RUNTIME_ENV_KEYS) {
    const rawValue = overrides[key]
    const normalized = normalizeRuntimeValue(
      typeof rawValue === 'string' ? rawValue : undefined,
    )
    if (normalized !== undefined) {
      runtimeOverrides.set(key, normalized)
    }
  }
}

function persistRuntimeOverrides(): void {
  const filePath = getPersistedOverridesPath()
  const directory = path.dirname(filePath)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })

  const overrides: Partial<Record<RuntimeEnvKey, string>> = {}
  for (const key of RUNTIME_ENV_KEYS) {
    const value = runtimeOverrides.get(key)
    if (value !== undefined) {
      overrides[key] = value
    }
  }

  const payload: PersistedRuntimeConfig = {
    version: 1,
    updatedAt: new Date().toISOString(),
    overrides,
  }
  const temporaryPath = `${filePath}.${process.pid}.tmp`

  try {
    fs.writeFileSync(
      temporaryPath,
      `${JSON.stringify(payload, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    )
    try {
      fs.chmodSync(temporaryPath, 0o600)
    } catch {
      // File modes are not fully supported on every platform.
    }

    try {
      fs.renameSync(temporaryPath, filePath)
    } catch (error) {
      // Windows does not replace an existing destination on rename.
      if (process.platform !== 'win32' || !fs.existsSync(filePath)) {
        throw error
      }
      fs.unlinkSync(filePath)
      fs.renameSync(temporaryPath, filePath)
    }

    try {
      fs.chmodSync(filePath, 0o600)
    } catch {
      // File modes are not fully supported on every platform.
    }
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath)
    }
  }
}

function ensurePersistedOverridesLoaded(): void {
  loadPersistedOverrides()
}

/**
 * Returns the effective value for an environment-backed configuration key.
 */
export function getRuntimeEnvValue(key: RuntimeEnvKey): string | undefined {
  ensurePersistedOverridesLoaded()
  return runtimeOverrides.get(key) ?? normalizeRuntimeValue(process.env[key])
}

/**
 * Returns the dashboard override, if one is active.
 */
export function getRuntimeEnvOverride(key: RuntimeEnvKey): string | undefined {
  ensurePersistedOverridesLoaded()
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
  setRuntimeEnvOverrides([{ key, value }])
}

/**
 * Sets or clears several dashboard overrides and persists them together.
 */
export function setRuntimeEnvOverrides(
  updates: readonly RuntimeEnvOverrideUpdate[],
): void {
  ensurePersistedOverridesLoaded()
  if (updates.length === 0) {
    return
  }

  const previous = new Map(runtimeOverrides)
  for (const { key, value } of updates) {
    const normalized = normalizeRuntimeValue(value ?? undefined)
    if (normalized === undefined) {
      runtimeOverrides.delete(key)
    } else {
      runtimeOverrides.set(key, normalized)
    }
  }

  try {
    persistRuntimeOverrides()
  } catch (error) {
    runtimeOverrides.clear()
    for (const [key, value] of previous) {
      runtimeOverrides.set(key, value)
    }
    throw error
  }
}

/**
 * Clears in-memory overrides without changing the persisted settings file.
 * Intended for tests and process-level reset paths; normal callers should
 * clear individual settings through the API.
 */
export function clearRuntimeEnvOverrides(): void {
  runtimeOverrides.clear()
  persistedOverridesPath = getPersistedOverridesPath()
  persistedOverridesLoaded = true
}

/**
 * Returns the file used to persist dashboard runtime overrides.
 */
export function getRuntimeConfigFilePath(): string {
  return getPersistedOverridesPath()
}

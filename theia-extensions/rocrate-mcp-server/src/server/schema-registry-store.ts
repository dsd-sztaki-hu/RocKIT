import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { AccessMode } from './types'

/**
 * Shared schema registry entry shape used by MCP tools and dashboard APIs.
 */
export type SchemaRegistryEntry = {
  id: string
  displayName: string
  matchesUrls: string[]
  schemaUrl: string
  activeOnSpec: string[]
}

type PersistedSchemaRegistry = {
  version: 1
  updatedAt: string
  schemas: SchemaRegistryEntry[]
}

/**
 * Runtime info about the resolved registry storage location.
 */
export type SchemaRegistryStorageInfo = {
  mode: AccessMode
  directory: string
  filePath: string
}

/**
 * Read operation result with storage metadata.
 */
export type SchemaRegistryListResult = {
  storage: SchemaRegistryStorageInfo
  schemas: SchemaRegistryEntry[]
}

/**
 * Parameters accepted by register/update operations.
 */
export type RegisterSchemaInput = {
  id: string
  displayName: string
  matchesUrls: string[]
  schemaUrl: string
  activeOnSpec?: string[]
}

/**
 * Parameters accepted by partial updates.
 */
export type UpdateSchemaInput = {
  id: string
  displayName?: string
  matchesUrls?: string[]
  schemaUrl?: string
  activeOnSpec?: string[]
}

/**
 * Local defaults for spec version activation when omitted.
 */
const DEFAULT_ACTIVE_SPECS = ['v1.1.3', 'v1.2.0']

/**
 * Validates/normalizes a list of non-empty string values.
 */
function normalizeStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be a string array.`)
  }
  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item !== '')

  if (normalized.length === 0) {
    throw new Error(`${fieldName} must contain at least one non-empty value.`)
  }

  return Array.from(new Set(normalized))
}

/**
 * Validates and normalizes one schema registry entry payload.
 */
function normalizeEntry(input: RegisterSchemaInput): SchemaRegistryEntry {
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  const displayName =
    typeof input.displayName === 'string' ? input.displayName.trim() : ''
  const schemaUrl = typeof input.schemaUrl === 'string' ? input.schemaUrl.trim() : ''

  if (id === '') {
    throw new Error('schema id is required.')
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new Error('schema id may only contain letters, numbers, dot, underscore, or hyphen.')
  }
  if (displayName === '') {
    throw new Error('displayName is required.')
  }
  if (schemaUrl === '') {
    throw new Error('schemaUrl is required.')
  }

  const matchesUrls = normalizeStringArray(input.matchesUrls, 'matchesUrls')
  const activeOnSpec = input.activeOnSpec
    ? normalizeStringArray(input.activeOnSpec, 'activeOnSpec')
    : [...DEFAULT_ACTIVE_SPECS]

  return {
    id,
    displayName,
    matchesUrls,
    schemaUrl,
    activeOnSpec,
  }
}

/**
 * Builds the mode-specific filesystem location for schema persistence.
 */
function resolveStorage(mode: AccessMode): SchemaRegistryStorageInfo {
  const rockitRoot =
    process.env.ROCKIT_ROOT_PATH?.trim() ||
    process.env.ROCKIT_ROOT_PATH?.trim() ||
    path.join(os.homedir(), '.rockit')

  if (mode === 'local') {
    const localDir = path.join(rockitRoot, 'schema-registry')
    return {
      mode,
      directory: localDir,
      filePath: path.join(localDir, 'registry.json'),
    }
  }

  const remoteDir =
    process.env.ROCRATE_REMOTE_SCHEMA_REGISTRY_DIR?.trim() ||
    path.join(rockitRoot, 'schema-registry-remote')

  return {
    mode,
    directory: remoteDir,
    filePath: path.join(remoteDir, 'registry.json'),
  }
}

/**
 * Persists schema registry data in JSON files for local/remote modes.
 */
export function createSchemaRegistryStore(deps: {
  defaultSchemas: () => SchemaRegistryEntry[]
}) {
  /**
   * Reads persisted registry data (or falls back to defaults).
   */
  function read(mode: AccessMode): SchemaRegistryListResult {
    const storage = resolveStorage(mode)
    if (!fs.existsSync(storage.filePath)) {
      return {
        storage,
        schemas: deps.defaultSchemas(),
      }
    }

    const raw = fs.readFileSync(storage.filePath, 'utf8')
    let parsed: PersistedSchemaRegistry
    try {
      parsed = JSON.parse(raw) as PersistedSchemaRegistry
    } catch {
      throw new Error(`Invalid schema registry JSON: ${storage.filePath}`)
    }

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.schemas)) {
      throw new Error(`Invalid schema registry format: ${storage.filePath}`)
    }

    const schemas = parsed.schemas.map((entry) => normalizeEntry(entry as RegisterSchemaInput))
    return { storage, schemas }
  }

  /**
   * Writes one complete registry payload to disk atomically.
   */
  function write(mode: AccessMode, schemas: SchemaRegistryEntry[]): SchemaRegistryListResult {
    const storage = resolveStorage(mode)
    fs.mkdirSync(storage.directory, { recursive: true })

    const payload: PersistedSchemaRegistry = {
      version: 1,
      updatedAt: new Date().toISOString(),
      schemas,
    }

    const tmpPath = `${storage.filePath}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8')
    fs.renameSync(tmpPath, storage.filePath)

    return {
      storage,
      schemas,
    }
  }

  /**
   * Lists schema entries for one mode.
   */
  function list(mode: AccessMode): SchemaRegistryListResult {
    return read(mode)
  }

  /**
   * Registers or replaces one schema entry by id.
   */
  function register(mode: AccessMode, input: RegisterSchemaInput): SchemaRegistryListResult {
    const entry = normalizeEntry(input)
    const current = read(mode)
    const next = [...current.schemas]
    const idx = next.findIndex((item) => item.id === entry.id)
    if (idx === -1) {
      next.push(entry)
    } else {
      next[idx] = entry
    }
    return write(mode, next)
  }

  /**
   * Partially updates one existing schema entry.
   */
  function update(mode: AccessMode, input: UpdateSchemaInput): SchemaRegistryListResult {
    const id = typeof input.id === 'string' ? input.id.trim() : ''
    if (id === '') {
      throw new Error('schema id is required.')
    }

    const current = read(mode)
    const idx = current.schemas.findIndex((entry) => entry.id === id)
    if (idx < 0) {
      throw new Error(`Schema not found: ${id}`)
    }

    const existing = current.schemas[idx]
    const merged: RegisterSchemaInput = {
      id,
      displayName:
        typeof input.displayName === 'string' ? input.displayName : existing.displayName,
      matchesUrls: Array.isArray(input.matchesUrls) ? input.matchesUrls : existing.matchesUrls,
      schemaUrl: typeof input.schemaUrl === 'string' ? input.schemaUrl : existing.schemaUrl,
      activeOnSpec: Array.isArray(input.activeOnSpec)
        ? input.activeOnSpec
        : existing.activeOnSpec,
    }

    const updated = normalizeEntry(merged)
    const next = [...current.schemas]
    next[idx] = updated
    return write(mode, next)
  }

  /**
   * Removes one schema entry by id.
   */
  function remove(mode: AccessMode, idValue: string): SchemaRegistryListResult {
    const id = typeof idValue === 'string' ? idValue.trim() : ''
    if (id === '') {
      throw new Error('schema id is required.')
    }

    const current = read(mode)
    const next = current.schemas.filter((entry) => entry.id !== id)
    if (next.length === current.schemas.length) {
      throw new Error(`Schema not found: ${id}`)
    }
    return write(mode, next)
  }

  return {
    list,
    register,
    update,
    remove,
    resolveStorage,
  }
}

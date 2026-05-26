#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import {
  applyChangeSet,
  normalizeCrate,
  readCrateFromFile,
  resolveCratePath,
  validateCrate,
  writeCrateAtomic,
} from './core'
import type { RoCrate, RoCrateEntity } from './core/types'
import { CHANGE_SET_ALLOWED_KEYS, tools } from './server/tool-definitions'
import { createToolDispatcher } from './server/tool-dispatcher'
import { createProfileContextStore } from './server/profile-context'
import { createSummaryHelpers } from './server/summary'
import { startServerWithTransports } from './server/transports'
import { createDataverseHandlers } from './server/dataverse'
import { createContextReconciliationHelpers } from './server/context-reconciliation'
import { createProfileValidationHelpers } from './server/profile-validation'
import { createProfileResolutionHelpers } from './server/profile-resolution'
import { createCrateOpsHelpers } from './server/crate-ops'
import { createWebHandlers } from './server/web'
import { createOntologyHelpers } from './server/ontology'
import {
  createSchemaRegistryStore,
  type SchemaRegistryEntry,
} from './server/schema-registry-store'
import type {
  AccessMode,
  ProfileResolutionInputs,
} from './server/types'

// Dashboard telemetry imports (optional, disabled by default)
import { getGlobalCollector } from './dashboard/collector'
import { startDashboardIfNeeded } from './dashboard/http-server'

/**
 * rocrate-mcp-server architecture (single-file entrypoint)
 *
 * This file is intentionally self-contained. It wires together:
 * 1. MCP transport handling via @modelcontextprotocol/sdk (stdio or socket proxy/daemon)
 * 2. Tool parameter parsing and response shaping
 * 3. RO-Crate read/write/change operations via ./core
 * 4. Profile-aware validation and @context reconciliation
 * 5. External service integrations (Tavily and Dataverse)
 * 6. Optional in-process telemetry dashboard
 *
 * High-level flow:
 * MCP transport -> SDK request handlers -> handleToolCall ->
 * run* tool implementation -> structured MCP tool result
 */


const ROCRATE_CONFORMS_TO_URL = 'https://w3id.org/ro/crate/1.1'
const DEFAULT_SCHEMA_INDEX_FILENAME = 'metadata-schema-index.json'
const DEFAULT_PROFILE_CONTEXT_TTL_SEC = 3600
const DEFAULT_SUMMARY_ISSUE_LIMIT = 10
const DEFAULT_SUMMARY_ENTITY_ID_LIMIT = 10
const DEFAULT_DATAVERSE_BASE_URL = 'http://localhost:8080'
const DEFAULT_DATAVERSE_OWNER_ID = 'root'
const DEFAULT_DATAVERSE_VALIDATE_PATH = '/api/arp/validateRoCrate'
const BASE_ALLOWED_PROPERTIES = new Set<string>([
  '@id',
  '@type',
  'name',
  'conformsTo',
  'hasPart',
  'about',
  'encodingFormat',
  'contentSize',
  'identifier',
  'description',
  'url',
])
const DEFAULT_CONTEXT_KNOWN_TERMS = new Set<string>([
  'id',
  'type',
  'name',
  'title',
  'description',
  'url',
  'identifier',
  'author',
  'creator',
  'contributor',
  'publisher',
  'datePublished',
  'dateModified',
  'encodingFormat',
  'contentSize',
  'contentUrl',
  'license',
  'isPartOf',
  'hasPart',
  'about',
  'conformsTo',
  'subject',
  'keywords',
  'citation',
  'sameAs',
  'image',
  'thumbnail',
  'temporalCoverage',
  'spatialCoverage',
  'version',
])
const EXTERNAL_CONTEXT_COVERAGE_URLS = new Set<string>([
  'https://w3id.org/ro/crate/1.1/context',
])
const profileContext = createProfileContextStore({
  defaultTtlSec: DEFAULT_PROFILE_CONTEXT_TTL_SEC,
  uniqueStrings,
  createId: () => randomUUID(),
})

// Dashboard telemetry collector (singleton, lazy-initialized)
// Enabled only when ROCRATE_DASHBOARD_ENABLED=true
/**
 * Handles get telemetry collector.
 */
function getTelemetryCollector() {
  try {
    return getGlobalCollector()
  } catch {
    return null
  }
}

const { parseWebSearchParams, runWebSearch, parseDownloadUrlParams, runDownloadUrl } =
  createWebHandlers({
    getTelemetryCollector,
  })

/**
 * Safely coerces unknown values to object records.
 */
function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

/**
 * Wraps payloads into MCP text content result shape.
 */
function textResult(payload: unknown): {
  content: Array<{ type: 'text'; text: string }>
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  }
}

/**
 * Resolves crate path, accepting either metadata file path or dataset directory.
 */
function pickMetadataDescriptor(crate: RoCrate): RoCrateEntity | undefined {
  const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
  return graph.find((entity) => {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
      return false
    }
    const entityId = entity['@id']
    return (
      entityId === 'ro-crate-metadata.json' ||
      entityId === 'file://./ro-crate-metadata.json'
    )
  })
}

/**
 * Normalizes entity @type to a plain string array.
 */
function entityTypes(entity: RoCrateEntity): string[] {
  const raw = entity['@type']
  if (typeof raw === 'string') {
    return [raw]
  }
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string')
  }
  return []
}

/**
 * Extracts profile URLs from any valid conformsTo representation.
 */
function extractConformsToUrls(value: unknown): string[] {
  if (!value) {
    return []
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? [] : [trimmed]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractConformsToUrls(item))
  }
  if (typeof value === 'object') {
    const id = (value as Record<string, unknown>)['@id']
    return extractConformsToUrls(id)
  }
  return []
}

/**
 * De-duplicates strings while preserving insertion order.
 */
function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value)
      ordered.push(value)
    }
  }
  return ordered
}

/**
 * Collects all declared profile URLs from Dataset/File entities.
 */
function collectProfileUrls(crate: RoCrate): string[] {
  const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
  const urls: string[] = []
  for (const entity of graph) {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
      continue
    }
    const types = entityTypes(entity)
    if (!types.includes('Dataset') && !types.includes('File')) {
      continue
    }
    urls.push(...extractConformsToUrls(entity.conformsTo))
  }
  return uniqueStrings(urls.filter((url) => url !== ROCRATE_CONFORMS_TO_URL))
}

/**
 * Builds reverse index: profile URL -> entity IDs declaring that profile.
 */
function collectProfileTargetsByUrl(crate: RoCrate): Record<string, string[]> {
  const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
  const targets = new Map<string, string[]>()
  for (const entity of graph) {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
      continue
    }
    const entityId = typeof entity['@id'] === 'string' ? entity['@id'] : undefined
    if (!entityId) {
      continue
    }
    const types = entityTypes(entity)
    if (!types.includes('Dataset') && !types.includes('File')) {
      continue
    }
    const profileUrls = extractConformsToUrls(entity.conformsTo).filter(
      (url) => url !== ROCRATE_CONFORMS_TO_URL,
    )
    for (const profileUrl of profileUrls) {
      const current = targets.get(profileUrl) ?? []
      current.push(entityId)
      targets.set(profileUrl, current)
    }
  }
  return Object.fromEntries(
    Array.from(targets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([profileUrl, entityIds]) => [profileUrl, uniqueStrings(entityIds)]),
  )
}

const {
  ensureCratePath,
  parseAccessMode,
  parseResponseMode,
  asRoCrate,
  loadCrateFromParams,
  normalizeChangeSet,
  readProfileConformsToUpdateOps,
  updateProfileConformsTo,
  detectProfileChangeTargets,
  collectMissingUpdateEntityIds,
} = createCrateOpsHelpers({
  changeSetAllowedKeys: CHANGE_SET_ALLOWED_KEYS,
  resolveCratePath,
  readCrateFromFile,
  normalizeCrate,
  uniqueStrings,
  entityTypes,
  extractConformsToUrls,
})

const {
  parseProfileResolutionInputs,
  parseProfileRequiredMode,
  parseContextMode,
  resolveProfileUrls,
  prepareRemoteProfilePayload,
  createProfileContext,
  getProfileContextInfo,
  deleteProfileContext,
} = createProfileResolutionHelpers({
  rocrateConformsToUrl: ROCRATE_CONFORMS_TO_URL,
  defaultSchemaIndexFilename: DEFAULT_SCHEMA_INDEX_FILENAME,
  uniqueStrings,
  profileContext,
  loadCrateFromParams,
  collectProfileUrls,
})

const {
  summarizeProfileResolution,
  summarizeCratePayload,
  summarizeRoCrateContext,
  summarizeApplyChangesPayload,
  summarizeDataverseUploadPayload,
  summarizeDataverseDownloadPayload,
} = createSummaryHelpers({
  defaultSummaryIssueLimit: DEFAULT_SUMMARY_ISSUE_LIMIT,
  defaultSummaryEntityIdLimit: DEFAULT_SUMMARY_ENTITY_ID_LIMIT,
  pickMetadataDescriptor,
  collectProfileUrls,
})

const {
  collectDeclaredContextTerms,
  applyContextModePatch,
  buildContextTermSuggestion,
} = createContextReconciliationHelpers({
  defaultContextKnownTerms: DEFAULT_CONTEXT_KNOWN_TERMS,
})

const {
  buildProfileConstraints,
  validateCrateAgainstProfileConstraints,
  ensureProfileConformanceOrThrow,
} = createProfileValidationHelpers({
  baseAllowedProperties: BASE_ALLOWED_PROPERTIES,
  defaultContextKnownTerms: DEFAULT_CONTEXT_KNOWN_TERMS,
  externalContextCoverageUrls: EXTERNAL_CONTEXT_COVERAGE_URLS,
  rocrateConformsToUrl: ROCRATE_CONFORMS_TO_URL,
  entityTypes,
  extractConformsToUrls,
  collectProfileTargetsByUrl,
  resolveProfileUrls,
  collectDeclaredContextTerms,
  buildContextTermSuggestion,
})

const {
  parseDataverseUploadParams,
  parseDataverseDownloadParams,
  parsePendingDataverseCrateAdoptionParams,
  runDataverseUpload,
  runDataverseDownload,
  adoptPendingDataverseRoCrate,
} = createDataverseHandlers({
  defaultBaseUrl: DEFAULT_DATAVERSE_BASE_URL,
  defaultOwnerId: DEFAULT_DATAVERSE_OWNER_ID,
  defaultValidatePath: DEFAULT_DATAVERSE_VALIDATE_PATH,
  rocrateConformsToUrl: ROCRATE_CONFORMS_TO_URL,
  externalContextCoverageUrls: EXTERNAL_CONTEXT_COVERAGE_URLS,
  loadCrateFromParams,
  parseAccessMode,
  ensureCratePath,
  parseResponseMode,
  parseProfileResolutionInputs,
  writeCrateAtomic,
  ensureProfileConformanceOrThrow,
  buildContextTermSuggestion,
  uniqueStrings,
  getTelemetryCollector,
})

const { runOntologyTool } = createOntologyHelpers()

/**
 * Loads default schema registry entries from the shared ontology package.
 */
function loadDefaultRegistrySchemas(): SchemaRegistryEntry[] {
  const modulePath = path.resolve(
    __dirname,
    '../../../dev-packages/rocrate-context-core/lib/index.js',
  )
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const loaded = require(modulePath) as {
    DEFAULT_REGISTERED_SCHEMAS?: SchemaRegistryEntry[]
  }
  const defaults = loaded.DEFAULT_REGISTERED_SCHEMAS
  if (!Array.isArray(defaults)) {
    throw new Error(
      `Failed to load DEFAULT_REGISTERED_SCHEMAS from ${modulePath}. Build rocrate-context-core first.`,
    )
  }
  return defaults
}

const schemaRegistryStore = createSchemaRegistryStore({
  defaultSchemas: loadDefaultRegistrySchemas,
})

/**
 * Reads access mode for schema-registry operations.
 */
function parseSchemaRegistryMode(params: Record<string, unknown>): AccessMode {
  return parseAccessMode(params)
}

/**
 * Lists persisted schema registry entries.
 */
function listSchemaRegistry(params: Record<string, unknown>): Record<string, unknown> {
  const mode = parseSchemaRegistryMode(params)
  const listing = schemaRegistryStore.list(mode)
  return {
    mode,
    storage: listing.storage,
    count: listing.schemas.length,
    schemas: listing.schemas,
  }
}

/**
 * Registers one schema entry in persisted registry storage.
 */
function registerSchemaRegistry(params: Record<string, unknown>): Record<string, unknown> {
  const mode = parseSchemaRegistryMode(params)
  const result = schemaRegistryStore.register(mode, {
    id: typeof params.id === 'string' ? params.id : '',
    displayName: typeof params.displayName === 'string' ? params.displayName : '',
    matchesUrls: Array.isArray(params.matchesUrls) ? params.matchesUrls : [],
    schemaUrl: typeof params.schemaUrl === 'string' ? params.schemaUrl : '',
    activeOnSpec: Array.isArray(params.activeOnSpec) ? params.activeOnSpec : undefined,
  })
  return {
    mode,
    storage: result.storage,
    count: result.schemas.length,
    schemas: result.schemas,
  }
}

/**
 * Exposes schema registry entries for ontology query tools.
 */
function getRegisteredSchemasForMode(mode: AccessMode): SchemaRegistryEntry[] {
  return schemaRegistryStore.list(mode).schemas
}

/**
 * Resolves base aroma directory for schema index/profile artifacts.
 */
function buildRoCrateContext(
  crate: RoCrate,
  mode: AccessMode,
  cratePath?: string,
  inputs: ProfileResolutionInputs = {},
): Record<string, unknown> {
  const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
  const descriptor = pickMetadataDescriptor(crate)
  const constraints = buildProfileConstraints(crate, mode, inputs)
  const profileTargetsByUrl = collectProfileTargetsByUrl(crate)
  const validation = validateCrateAgainstProfileConstraints(crate, constraints)
  return {
    mode,
    metadataPath: cratePath,
    graphEntityCount: graph.length,
    hasRootDataset: graph.some((entity) => entity?.['@id'] === './'),
    metadataDescriptorId:
      typeof descriptor?.['@id'] === 'string' ? descriptor['@id'] : null,
    profileResolution: {
      indexPath: constraints.resolution.indexPath,
      aromaRootPath: constraints.resolution.aromaRootPath,
      profileContextId: constraints.resolution.profileContextId,
      profileUrls: constraints.resolution.profileUrls,
      unresolvedUrls: constraints.resolution.unresolvedUrls,
      profiles: constraints.resolution.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        version: profile.version,
        conformsTo: profile.conformsTo,
        convertedPath: profile.convertedPath,
        absoluteConvertedPath: profile.absoluteConvertedPath,
        loaded: profile.loaded,
        loadError: profile.loadError,
      })),
      warnings: constraints.resolution.warnings,
    },
    profileTargetsByUrl,
    profileRules: {
      allowedClasses: Array.from(constraints.allowedClasses).sort(),
      allowedPropertiesByClass: Object.fromEntries(
        Array.from(constraints.allowedPropertiesByClass.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([className, props]) => [className, Array.from(props).sort()]),
      ),
      valueSetsByClass: Object.fromEntries(
        Array.from(constraints.valueSetsByClass.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([className, propertyValueSets]) => [
            className,
            Object.fromEntries(
              Array.from(propertyValueSets.entries())
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([propertyName, values]) => [propertyName, Array.from(values).sort()]),
            ),
          ]),
      ),
    },
    conformance: validation,
    instructions: [
      'Primary target is ro-crate-metadata.json.',
      'When user asks to add/activate/remove profile URLs, use update_profile_conforms_to first.',
      'Treat profile scope as entity-local: profile fields apply only to entities that explicitly declare that profile URL in their own conformsTo.',
      'Do not fan out profile-field edits by class across other Dataset/File entities unless user explicitly asks.',
      'Use profileResolution to determine active profile files from conformsTo values on Dataset/File entities.',
      'Only edit entity types and properties that are allowed by resolved profiles.',
    ],
  }
}

const handleToolCall = createToolDispatcher({
  getTelemetryCollector,
  parseWebSearchParams,
  runWebSearch,
  textResult,
  parseDownloadUrlParams,
  runDownloadUrl,
  parseDataverseUploadParams,
  runDataverseUpload,
  summarizeDataverseUploadPayload,
  parsePendingDataverseCrateAdoptionParams,
  adoptPendingDataverseRoCrate,
  parseDataverseDownloadParams,
  runDataverseDownload,
  summarizeDataverseDownloadPayload,
  loadCrateFromParams,
  parseResponseMode,
  summarizeCratePayload,
  resolveCratePath,
  ensureCratePath,
  parseProfileResolutionInputs,
  parseProfileRequiredMode,
  parseContextMode,
  normalizeChangeSet,
  detectProfileChangeTargets,
  collectMissingUpdateEntityIds,
  applyChangeSet,
  buildProfileConstraints,
  applyContextModePatch,
  ensureProfileConformanceOrThrow,
  writeCrateAtomic,
  summarizeApplyChangesPayload,
  readProfileConformsToUpdateOps,
  updateProfileConformsTo,
  validateCrate,
  validateCrateAgainstProfileConstraints,
  parseAccessMode,
  asRoCrate,
  summarizeProfileResolution,
  buildRoCrateContext,
  summarizeRoCrateContext,
  buildContextTermSuggestion,
  resolveProfileUrls,
  prepareRemoteProfilePayload,
  createProfileContext,
  getProfileContextInfo,
  deleteProfileContext,
  listSchemaRegistry,
  registerSchemaRegistry,
  runOntologyTool,
  getRegisteredSchemasForMode,
})

/**
 * Handles start server.
 */
async function startServer(): Promise<void> {
  await startServerWithTransports({
    tools,
    instructions:
      'Primary artifact is ro-crate-metadata.json. Prefer RO-Crate tools over ad-hoc edits. First step before edits is get_rocrate_context to discover active profile constraints; do not start with web search. Use update_profile_conforms_to to change profile URLs on conformsTo; apply_changes must not edit conformsTo. apply_changes writes by default; set dryRun=true to preview without persisting. Treat profile scope as entity-local (only entities explicitly declaring that profile URL in conformsTo). Do not fan out profile-field edits by class unless user explicitly asks. Detect profile URLs from conformsTo on Dataset/File entities, resolve them via metadata-schema-index, and keep edits limited to profile-allowed entity types/properties. Every entity should have a human-friendly name and new entity IDs must be descriptive and unique. Do not invent factual metadata unless the user explicitly asks for examples. Destructive apply_changes operations require explicit user approval and confirmDestructive=true. write_crate_atomic also supports contextMode auto context reconciliation (default auto_reconcile).',
    asRecord,
    handleToolCall,
    getTelemetryCollector,
    startDashboardIfNeeded: () => {
      const collector = getTelemetryCollector()
      if (!collector) {
        return
      }
      void startDashboardIfNeeded(collector, schemaRegistryStore)
        .then((dashboard) => {
          if (dashboard) {
            process.stderr.write('rocrate-mcp-server: dashboard enabled\n')
          }
        })
        .catch((err) => {
          const errorMsg = err instanceof Error ? err.message : String(err)
          process.stderr.write(`rocrate-mcp-server: dashboard failed to start: ${errorMsg}\n`)
        })
    },
  })
}

void startServer()

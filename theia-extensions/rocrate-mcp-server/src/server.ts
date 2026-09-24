#!/usr/bin/env node

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************


import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  createDefaultRoCrateWorkspace,
  type DefaultRoCrateFileContent,
  type DefaultRoCrateWorkspaceAdapter,
} from 'rockit-common/lib/common/default-ro-crate'
import { DEFAULT_REGISTERED_SCHEMAS } from 'rocrate-context-core'
import { parseInstallAgentId, runInteractiveInstall } from './cli/install'
import {
  applyChangeSet,
  normalizeCrate,
  readCrateFromFile,
  resolveCratePath,
  validateCrate,
  writeCrateAtomic,
} from './core'
import type { RoCrate, RoCrateEntity } from './core/types'
// Dashboard telemetry imports (optional, disabled by default)
import { getGlobalCollector } from './dashboard/collector'
import { startDashboardIfNeeded } from './dashboard/http-server'
import { createContextReconciliationHelpers } from './server/context-reconciliation'
import { createCrateOpsHelpers } from './server/crate-ops'
import { createDataverseHandlers } from './server/dataverse'
import { DEFAULT_DATAVERSE_BASE_URL } from './server/dataverse-defaults'
import { createMetadataProfileHandlers } from './server/metadata-profiles'
import { createOntologyHelpers } from './server/ontology'
import { createProfileContextStore } from './server/profile-context'
import { createProfileResolutionHelpers } from './server/profile-resolution'
import { createProfileValidationHelpers } from './server/profile-validation'
import {
  createSchemaRegistryStore,
  type SchemaRegistryEntry,
} from './server/schema-registry-store'
import { createSummaryHelpers } from './server/summary'
import { CHANGE_SET_ALLOWED_KEYS, tools } from './server/tool-definitions'
import { createToolDispatcher } from './server/tool-dispatcher'
import { startServerWithTransports } from './server/transports'
import type {
  AccessMode,
  McpToolTextResult,
  ProfileResolutionInputs,
} from './server/types'
import {
  formatStartupVersion,
  formatVersionInfo,
  getBuildInfo,
  isVersionRequest,
} from './server/version'
import { createWebHandlers } from './server/web'

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
const DEFAULT_PROFILE_CONTEXT_TTL_SEC = 3600
const DEFAULT_SUMMARY_ISSUE_LIMIT = 10
const DEFAULT_SUMMARY_ENTITY_ID_LIMIT = 10
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
function textResult(payload: unknown, isError = false): McpToolTextResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
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

/**
 * Creates a default RO-Crate for a local directory using the shared bootstrap module.
 */
async function runCreateDefaultRoCrate(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const directoryPath = resolveDefaultRoCrateDirectory(params)
  const cratePath = path.join(directoryPath, 'ro-crate-metadata.json')
  const overwrite = params.overwrite === true
  if (fs.existsSync(cratePath) && !overwrite) {
    throw new Error(
      `ro-crate-metadata.json already exists: ${cratePath}. Re-run with overwrite=true to replace it.`,
    )
  }

  const result = await createDefaultRoCrateWorkspace(
    createNodeDefaultRoCrateAdapter(directoryPath),
    {
      writeIgnoredFile: params.writeIgnoredFile !== false,
    },
  )
  const indent = typeof params.indent === 'number' ? params.indent : 2

  let ignoredFilePath: string | undefined
  if (result.ignoredFile) {
    const ignoredDirectoryPath = path.join(
      directoryPath,
      result.ignoredFile.directoryPath,
    )
    ignoredFilePath = path.join(directoryPath, result.ignoredFile.filePath)
    fs.mkdirSync(ignoredDirectoryPath, { recursive: true })
    fs.writeFileSync(ignoredFilePath, result.ignoredFile.payload, 'utf8')
  }

  writeCrateAtomic(cratePath, result.crate as RoCrate, indent)
  const crate = normalizeCrate(result.crate)
  return {
    ok: true,
    mode: 'local',
    writeApplied: true,
    directoryPath,
    cratePath,
    ignoredFilePath,
    summary: result.summary,
    crateSummary: summarizeCratePayload(crate, 'local', cratePath),
    crate,
  }
}

function resolveDefaultRoCrateDirectory(params: Record<string, unknown>): string {
  const directoryPath =
    typeof params.directoryPath === 'string' && params.directoryPath.trim() !== ''
      ? path.resolve(params.directoryPath)
      : undefined
  if (directoryPath) {
    return assertExistingDirectory(directoryPath)
  }

  if (typeof params.cratePath === 'string' && params.cratePath.trim() !== '') {
    const resolved = path.resolve(params.cratePath)
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return resolved
    }
    if (path.basename(resolved) === 'ro-crate-metadata.json') {
      return assertExistingDirectory(path.dirname(resolved))
    }
    return assertExistingDirectory(resolved)
  }

  return assertExistingDirectory(path.dirname(resolveCratePath()))
}

function assertExistingDirectory(directoryPath: string): string {
  if (!fs.existsSync(directoryPath)) {
    throw new Error(`Directory does not exist: ${directoryPath}`)
  }
  if (!fs.statSync(directoryPath).isDirectory()) {
    throw new Error(`Path is not a directory: ${directoryPath}`)
  }
  return directoryPath
}

function createNodeDefaultRoCrateAdapter(
  rootPath: string,
): DefaultRoCrateWorkspaceAdapter {
  const normalizePath = (value: string): string => value.replace(/\\/g, '/')
  const absolutePathFor = (relativePath: string): string =>
    relativePath ? path.join(rootPath, relativePath) : rootPath

  return {
    rootName: path.basename(rootPath) || './',
    listChildren: async (relativeDirectoryPath: string) => {
      const directoryPath = absolutePathFor(relativeDirectoryPath)
      return fs
        .readdirSync(directoryPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() || entry.isFile())
        .map((entry) => {
          const absoluteChildPath = path.join(directoryPath, entry.name)
          const stat = fs.statSync(absoluteChildPath)
          return {
            name: entry.name,
            relativePath: normalizePath(path.relative(rootPath, absoluteChildPath)),
            kind: entry.isDirectory() ? ('directory' as const) : ('file' as const),
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          }
        })
    },
    readFileContent: async (relativeFilePath: string) =>
      fs.readFileSync(absolutePathFor(relativeFilePath)),
    hashContent: (content: DefaultRoCrateFileContent) =>
      createHash('md5').update(content).digest('hex'),
    readTextFile: async (relativeFilePath: string) => {
      const filePath = absolutePathFor(relativeFilePath)
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return undefined
      }
      return fs.readFileSync(filePath, 'utf8')
    },
  }
}

const { collectDeclaredContextTerms, applyContextModePatch, buildContextTermSuggestion } =
  createContextReconciliationHelpers({
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

const {
  resolveMissingMetadataProfiles,
  listWellKnownSchemas,
  listRemoteSchemaTree,
  importWellKnownSchema,
  listMetadataProfiles,
  importMetadataProfile,
  deleteMetadataProfileTool,
} = createMetadataProfileHandlers({
  collectProfileUrls,
})

/**
 * Loads default schema registry entries from the shared ontology package.
 */
function loadDefaultRegistrySchemas(): SchemaRegistryEntry[] {
  return DEFAULT_REGISTERED_SCHEMAS.map((schema) => ({
    ...schema,
    activeOnSpec: [...schema.activeOnSpec],
  }))
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
function registerSchemaRegistry(
  params: Record<string, unknown>,
): Record<string, unknown> {
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
 * Resolves base RocKIT directory for schema index/profile artifacts.
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
      rockitRootPath: constraints.resolution.rockitRootPath,
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
                .map(([propertyName, values]) => [
                  propertyName,
                  Array.from(values).sort(),
                ]),
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
  runCreateDefaultRoCrate,
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
  resolveMissingMetadataProfiles,
  listWellKnownSchemas,
  listRemoteSchemaTree,
  importWellKnownSchema,
  listMetadataProfiles,
  importMetadataProfile,
  deleteMetadataProfileTool,
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

function getDashboardUrl(): string {
  const host = process.env.ROCRATE_DASHBOARD_HOST || '127.0.0.1'
  const port = process.env.ROCRATE_DASHBOARD_PORT || '9393'
  return `http://${host}:${port}`
}

function getMcpServerInstructions(): string {
  return `RO-CRATE TOOL ROUTING
The canonical way to open a local RO-Crate dataset in AROMA is open_aroma_for_local_file.
For a direct request to open, view, show, inspect, or launch a dataset in AROMA—including the exact request "open dataset in AROMA"—call open_aroma_for_local_file immediately as the first tool. Treat "dataset" as the RO-Crate in the current working directory and pass "ro-crate-metadata.json"; otherwise pass the dataset's ro-crate-metadata.json path.
Before RO-Crate editing/advice, call read_agent_workflow_doc with name "rocrate_workflow.md" and follow it.
Read the referenced step doc before each workflow step.
Primary artifact is ro-crate-metadata.json.
If no ro-crate-metadata.json exists in a local directory, offer create_default_rocrate before other metadata work; never overwrite existing metadata unless explicitly requested with overwrite=true.
Prefer RO-Crate tools over ad-hoc edits.
The RO-Crate MCP dashboard is available at ${getDashboardUrl()}; open it when the user asks to inspect MCP activity or dashboard telemetry.
First edit step is get_rocrate_context to discover active profile constraints; do not start with web search.
Use update_profile_conforms_to to change profile URLs on conformsTo; apply_changes must not edit conformsTo.
apply_changes writes by default; set dryRun=true to preview without persisting.
Treat profile scope as entity-local (only entities explicitly declaring that profile URL in conformsTo).
Do not fan out profile-field edits by class unless user explicitly asks.
Detect profile URLs from conformsTo on Dataset/File entities, resolve them via metadata-schema-index, and keep edits limited to profile-allowed entity types/properties.
Every entity should have a human-friendly name and new entity IDs must be descriptive and unique.
Do not invent factual metadata unless the user explicitly asks for examples.
Destructive apply_changes operations require explicit user approval and confirmDestructive=true.
After successful edits/validation outside AROMA, call open_aroma_for_local_file and include the returned aromaUrl in the final response as a plain URL. If the agent session context says AROMA is already open, do not generate the link unless the user asks.
write_crate_atomic also supports contextMode auto context reconciliation (default auto_reconcile).`
}

/**
 * Handles start server.
 */
async function startServer(): Promise<void> {
  process.stderr.write(`${formatStartupVersion(getBuildInfo())}\n`)
  await startServerWithTransports({
    tools,
    instructions: getMcpServerInstructions(),
    asRecord,
    handleToolCall,
    getTelemetryCollector,
    startDashboardIfNeeded: (onShutdown) => {
      const collector = getTelemetryCollector()
      if (!collector) {
        return
      }
      void startDashboardIfNeeded(collector, schemaRegistryStore, onShutdown)
        .then((dashboard) => {
          if (dashboard) {
            process.stderr.write('rocrate-mcp-server: dashboard enabled\n')
          }
        })
        .catch((err) => {
          const errorMsg = err instanceof Error ? err.message : String(err)
          process.stderr.write(
            `rocrate-mcp-server: dashboard failed to start: ${errorMsg}\n`,
          )
        })
    },
  })
}

function main(): void {
  const args = process.argv.slice(2)
  if (isVersionRequest(args)) {
    process.stdout.write(`${formatVersionInfo(getBuildInfo())}\n`)
    return
  }
  if (
    args.includes('-i') ||
    args.includes('--install') ||
    args.some((arg) => arg.startsWith('-i=') || arg.startsWith('--install='))
  ) {
    void runInteractiveInstall(parseInstallAgentId(args)).then((exitCode) => {
      process.exitCode = exitCode
    })
    return
  }

  void startServer()
}

main()

#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  applyChangeSet,
  computeDelta,
  normalizeCrate,
  readCrateFromFile,
  resolveCratePath,
  validateCrate,
  writeCrateAtomic,
} from './core'
import type { RoCrate, RoCrateChangeSet, RoCrateEntity } from './core/types'

type JsonRpcId = string | number | null

type JsonRpcRequest = {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: unknown
}

type JsonRpcSuccess = {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: unknown
}

type JsonRpcFailure = {
  jsonrpc: '2.0'
  id: JsonRpcId
  error: {
    code: number
    message: string
    data?: unknown
  }
}

type ToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

type TransportMode = 'content-length' | 'jsonl'
type AccessMode = 'local' | 'remote'
type ProfileRequiredMode = 'allow_missing' | 'enforce_required'
type ResponseMode = 'summary' | 'full'
type ContextMode = 'strict' | 'auto_add' | 'auto_reconcile'

type SchemaIndexProfile = {
  id: string
  name?: string
  version?: string
  files?: {
    sourcePath?: string
    convertedPath?: string
  }
  conformsTo?: string
  [key: string]: unknown
}

type SchemaIndexDocument = {
  profiles: SchemaIndexProfile[]
  conformsToIndex: Record<string, string[]>
}

type ResolvedProfile = {
  id: string
  name?: string
  version?: string
  conformsTo?: string
  convertedPath?: string
  absoluteConvertedPath?: string
  loaded: boolean
  loadError?: string
  profile?: Record<string, unknown>
}

type ProfileResolution = {
  mode: AccessMode
  inputProvided: boolean
  profileContextId?: string
  profileUrls: string[]
  unresolvedUrls: string[]
  profiles: ResolvedProfile[]
  indexPath?: string
  aromaRootPath?: string
  warnings: string[]
}

type ProfileConstraints = {
  resolution: ProfileResolution
  allowedClasses: Set<string>
  allowedPropertiesByClass: Map<string, Set<string>>
  requiredPropertiesByClass: Map<string, Set<string>>
}

type ProfileTermIriResolution = {
  termToIri: Record<string, string>
  ambiguousTerms: string[]
}

type ContextAutoPatchReport = {
  mode: ContextMode
  addedTerms: string[]
  reconciledTerms: Array<{ term: string; from: string; to: string }>
  skippedConflicts: Array<{ term: string; from: string; expected: string }>
  ambiguousTerms: string[]
}

type ProfileValidationOptions = {
  requiredMode: ProfileRequiredMode
}

type ProfileResolutionInputs = {
  profileContextId?: string
  schemaIndex?: SchemaIndexDocument
  profileContents?: Record<string, Record<string, unknown>>
}

type ProfileContextRecord = {
  id: string
  createdAt: string
  expiresAt: string
  profileUrls: string[]
  unresolvedUrls: string[]
  warnings: string[]
  schemaIndex: SchemaIndexDocument
  profileContents: Record<string, Record<string, unknown>>
  profileIds: string[]
  contentHash: string
}

const CHANGE_SET_ALLOWED_KEYS = new Set<string>([
  'addEntities',
  'updateEntities',
  'removeEntities',
  'setRootFields',
  'addHasPart',
  'removeHasPart',
  'mergeContext',
])

const CHANGE_SET_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    addEntities: { type: 'array', items: { type: 'object' } },
    updateEntities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          '@id': { type: 'string' },
          merge: { type: 'object' },
          unset: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    removeEntities: { type: 'array', items: { type: 'string' } },
    setRootFields: { type: 'object' },
    addHasPart: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dataset: { type: 'string' },
          child: { type: 'string' },
        },
      },
    },
    removeHasPart: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dataset: { type: 'string' },
          child: { type: 'string' },
        },
      },
    },
    mergeContext: { type: 'object' },
  },
  additionalProperties: false,
  description:
    'Canonical keys: addEntities, updateEntities, removeEntities, setRootFields, addHasPart, removeHasPart, mergeContext. updateEntities supports merge (set fields) and unset (remove fields). Compatibility aliases accepted: entityChanges/upsert, setProperties, upsertEntities.',
}

type WebSearchParams = {
  query: string
  maxResults: number
  includeRawContent: boolean
  searchDepth: 'basic' | 'advanced'
  apiKey?: string
}

type DownloadUrlParams = {
  url: string
  rawHtml: boolean
  timeoutMs: number
  maxChars: number
}

type DataverseUploadParams = {
  mode: AccessMode
  cratePath?: string
  crate: RoCrate
  pid?: string
  baseUrl: string
  ownerId: string
  apiKey?: string
  timeoutMs: number
  responseMode: ResponseMode
  profileResolutionInputs: ProfileResolutionInputs
  indent: number
}

type DataverseDownloadParams = {
  mode: AccessMode
  cratePath?: string
  pid: string
  version?: string
  baseUrl: string
  apiKey?: string
  timeoutMs: number
  responseMode: ResponseMode
  writeToDisk: boolean
  indent: number
}

const PROTOCOL_VERSION = '2025-03-26'
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
const SYSTEM_ENTITY_TYPES = new Set<string>([
  'Dataset',
  'File',
  'CreativeWork',
  'Person',
  'Organization',
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
const profileContextStore = new Map<string, ProfileContextRecord>()

const tools: ToolDefinition[] = [
  {
    name: 'search',
    description:
      'Search the web using Tavily. Requires TAVILY_API_KEY environment variable.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        max_results: { type: 'number' },
        include_raw_content: { type: 'boolean' },
        search_depth: { type: 'string', enum: ['basic', 'advanced'] },
        apiKey: {
          type: 'string',
          description:
            'Optional Tavily API key fallback when TAVILY_API_KEY is not set on the server.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'download_url',
    description:
      'Download one URL. raw_html=true returns page source, otherwise returns extracted readable text.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        raw_html: { type: 'boolean' },
        timeout_ms: { type: 'number' },
        max_chars: { type: 'number' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'upload_rocrate_to_dataverse',
    description:
      'Upload to Dataverse ARP API. New dataset (no pid) uploads ZIP (ro-crate-metadata.json + referenced files, local mode only). Existing dataset (pid) posts JSON metadata update.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        pid: {
          type: 'string',
          description: 'Optional PID for update endpoint (/api/arp/rocrate/{pid}).',
        },
        baseUrl: {
          type: 'string',
          description:
            'Optional Dataverse base URL. Defaults to DATAVERSE_BASE_URL or http://localhost:8080.',
        },
        ownerId: {
          type: 'string',
          description:
            'Optional ownerId for new uploads. Defaults to DATAVERSE_OWNER_ID or root.',
        },
        apiKey: { type: 'string', description: 'Optional X-Dataverse-key override.' },
        timeoutMs: { type: 'number' },
        write: { type: 'boolean', enum: [true] },
        profileContextId: { type: 'string' },
        schemaIndex: { type: 'object' },
        profileContents: { type: 'object' },
        indent: { type: 'number' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      required: ['write'],
      additionalProperties: false,
    },
  },
  {
    name: 'download_rocrate_from_dataverse',
    description:
      'Download crate JSON from Dataverse ARP API by PID. In local mode, requires write=true to persist on disk.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        pid: { type: 'string' },
        version: { type: 'string' },
        baseUrl: {
          type: 'string',
          description:
            'Optional Dataverse base URL. Defaults to DATAVERSE_BASE_URL or http://localhost:8080.',
        },
        apiKey: { type: 'string', description: 'Optional X-Dataverse-key override.' },
        timeoutMs: { type: 'number' },
        write: { type: 'boolean' },
        indent: { type: 'number' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      required: ['pid'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_crate',
    description:
      'Read and return RO-Crate JSON. local mode reads ro-crate-metadata.json from disk; remote mode uses provided crate payload.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: {
          type: 'string',
          description: 'Path to ro-crate-metadata.json in local mode.',
        },
        crate: { type: 'object', description: 'RO-Crate JSON payload in remote mode.' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'compute_delta',
    description:
      'Compute additive entity and hasPart edge delta from filesystem against current crate.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        rootPath: { type: 'string' },
        includeHidden: { type: 'boolean' },
        workspaceEntries: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Remote mode only: relative paths to materialize for delta calculation. Directories should end with "/".',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'apply_changes',
    description:
      'Apply compact change-set to crate. Requires write=true for explicit write intent. cratePath must be the ro-crate-metadata.json location to write to in local mode; in remote mode, cratePath is ignored and crate payload is required.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        changeSet: CHANGE_SET_INPUT_SCHEMA,
        write: { type: 'boolean', enum: [true] },
        indent: { type: 'number' },
        profileContextId: { type: 'string' },
        profileRequiredMode: {
          type: 'string',
          enum: ['allow_missing', 'enforce_required'],
        },
        contextMode: { type: 'string', enum: ['strict', 'auto_add', 'auto_reconcile'] },
        allowOutOfProfileTargets: { type: 'boolean' },
        schemaIndex: { type: 'object' },
        profileContents: { type: 'object' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      required: ['changeSet', 'write'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_profile_conforms_to',
    description:
      'Attach profile URL(s) to an entity conformsTo (default root dataset "./"). Requires write=true.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        entityId: { type: 'string' },
        profileUrl: { type: 'string' },
        profileUrls: { type: 'array', items: { type: 'string' } },
        write: { type: 'boolean', enum: [true] },
        indent: { type: 'number' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      required: ['write'],
      additionalProperties: false,
    },
  },
  {
    name: 'validate_crate',
    description:
      'Validate crate structure and references. local mode loads crate from disk; remote mode validates provided crate payload.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        strict: { type: 'boolean' },
        profileContextId: { type: 'string' },
        profileRequiredMode: {
          type: 'string',
          enum: ['allow_missing', 'enforce_required'],
        },
        schemaIndex: { type: 'object' },
        profileContents: { type: 'object' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'write_crate_atomic',
    description: 'Atomically write crate JSON to disk at cratePath.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        indent: { type: 'number' },
        profileContextId: { type: 'string' },
        profileRequiredMode: {
          type: 'string',
          enum: ['allow_missing', 'enforce_required'],
        },
        schemaIndex: { type: 'object' },
        profileContents: { type: 'object' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      required: ['crate'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_rocrate_context',
    description:
      'Return crate context and profile hints. Detects conformsTo profile URL and emits schema resolution guidance.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        profileContextId: { type: 'string' },
        schemaIndex: { type: 'object' },
        profileContents: { type: 'object' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'suggest_context_terms',
    description:
      'Suggest mergeContext mappings for terms used in @graph but not declared in @context and not known from default RO-Crate context.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        profileContextId: { type: 'string' },
        schemaIndex: { type: 'object' },
        profileContents: { type: 'object' },
        responseMode: { type: 'string', enum: ['summary', 'full'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'resolve_profile_schema',
    description:
      'Resolve profile URL to profile records and converted profile file paths via metadata-schema-index.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        profileUrl: { type: 'string' },
        includeProfileContent: { type: 'boolean' },
        profileContextId: { type: 'string' },
        schemaIndex: { type: 'object' },
        profileContents: { type: 'object' },
      },
      required: ['profileUrl'],
      additionalProperties: false,
    },
  },
  {
    name: 'prepare_remote_profile_payload',
    description:
      'Prepare schemaIndex/profileContents payload from local profile mappings so callers can pass it to remote-mode profile-aware tools.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        profileUrls: {
          type: 'array',
          items: { type: 'string' },
        },
        includeProfileContent: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'create_profile_context',
    description:
      'Create server-side cached profile context and return profileContextId for reuse in remote profile-aware tool calls.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['local', 'remote'] },
        cratePath: { type: 'string' },
        crate: { type: 'object' },
        profileUrls: {
          type: 'array',
          items: { type: 'string' },
        },
        includeProfileContent: { type: 'boolean' },
        schemaIndex: { type: 'object' },
        profileContents: { type: 'object' },
        ttlSec: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_profile_context_info',
    description:
      'Return metadata summary for a cached profileContextId without returning full profile contents.',
    inputSchema: {
      type: 'object',
      properties: {
        profileContextId: { type: 'string' },
      },
      required: ['profileContextId'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_profile_context',
    description: 'Delete a cached profileContextId from server memory.',
    inputSchema: {
      type: 'object',
      properties: {
        profileContextId: { type: 'string' },
      },
      required: ['profileContextId'],
      additionalProperties: false,
    },
  },
]

function findHeaderTerminator(
  buffer: Buffer,
): { index: number; size: number } | undefined {
  for (let i = 0; i <= buffer.length - 4; i += 1) {
    if (
      buffer[i] === 13 &&
      buffer[i + 1] === 10 &&
      buffer[i + 2] === 13 &&
      buffer[i + 3] === 10
    ) {
      return { index: i, size: 4 }
    }
  }
  for (let i = 0; i <= buffer.length - 2; i += 1) {
    if (buffer[i] === 10 && buffer[i + 1] === 10) {
      return { index: i, size: 2 }
    }
  }
  return undefined
}

function writeMessage(
  mode: TransportMode,
  message: JsonRpcSuccess | JsonRpcFailure,
): void {
  const body = JSON.stringify(message)
  if (mode === 'jsonl') {
    process.stdout.write(`${body}\n`)
    return
  }
  const payload = Buffer.from(body, 'utf8')
  const header = Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, 'utf8')
  process.stdout.write(Buffer.concat([header, payload]))
}

function writeResult(mode: TransportMode, id: JsonRpcId, result: unknown): void {
  writeMessage(mode, { jsonrpc: '2.0', id, result })
}

function writeError(
  mode: TransportMode,
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): void {
  writeMessage(mode, {
    jsonrpc: '2.0',
    id,
    error: { code, message, data },
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function textResult(payload: unknown): {
  content: Array<{ type: 'text'; text: string }>
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  }
}

function ensureCratePath(inputPath?: unknown): string {
  if (typeof inputPath === 'string' && inputPath.trim() !== '') {
    const resolved = path.resolve(inputPath)
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      const metadataPath = path.join(resolved, 'ro-crate-metadata.json')
      if (!fs.existsSync(metadataPath)) {
        throw new Error(
          `cratePath points to a directory but ro-crate-metadata.json was not found: ${metadataPath}`,
        )
      }
      return metadataPath
    }
    return resolved
  }
  return resolveCratePath()
}

function parseAccessMode(params: Record<string, unknown>): AccessMode {
  if (params.mode === 'remote') {
    return 'remote'
  }
  if (params.mode === 'local') {
    return 'local'
  }
  return process.env.ROCRATE_MCP_DEFAULT_MODE === 'remote' ? 'remote' : 'local'
}

function parseResponseMode(
  params: Record<string, unknown>,
  defaultMode: ResponseMode = 'summary',
): ResponseMode {
  if (params.responseMode === 'full') {
    return 'full'
  }
  if (params.responseMode === 'summary') {
    return 'summary'
  }
  return defaultMode
}

function summarizeArray(
  values: unknown[],
  limit = DEFAULT_SUMMARY_ISSUE_LIMIT,
): {
  items: unknown[]
  total: number
  truncated: boolean
} {
  const safeLimit = Math.max(1, limit)
  return {
    items: values.slice(0, safeLimit),
    total: values.length,
    truncated: values.length > safeLimit,
  }
}

function summarizeStringArray(
  values: string[],
  limit = DEFAULT_SUMMARY_ENTITY_ID_LIMIT,
): {
  items: string[]
  total: number
  truncated: boolean
} {
  return summarizeArray(values, limit) as {
    items: string[]
    total: number
    truncated: boolean
  }
}

function summarizeProfileResolution(
  resolution: ProfileResolution,
): Record<string, unknown> {
  return {
    mode: resolution.mode,
    inputProvided: resolution.inputProvided,
    profileContextId: resolution.profileContextId,
    profileUrls: resolution.profileUrls,
    unresolvedUrls: resolution.unresolvedUrls,
    warnings: resolution.warnings,
    indexPath: resolution.indexPath,
    aromaRootPath: resolution.aromaRootPath,
    profiles: resolution.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      version: profile.version,
      conformsTo: profile.conformsTo,
      convertedPath: profile.convertedPath,
      loaded: profile.loaded,
      loadError: profile.loadError,
    })),
  }
}

function summarizeEntityTypeCounts(crate: RoCrate): Record<string, number> {
  const counts = new Map<string, number>()
  const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
  for (const entity of graph) {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
      continue
    }
    const rawType = entity['@type']
    const types = Array.isArray(rawType)
      ? rawType.filter((item): item is string => typeof item === 'string')
      : typeof rawType === 'string'
        ? [rawType]
        : ['Unknown']
    for (const type of types) {
      counts.set(type, (counts.get(type) ?? 0) + 1)
    }
  }
  return Object.fromEntries(
    Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])),
  )
}

function summarizeCratePayload(
  crate: RoCrate,
  mode: AccessMode,
  cratePath?: string,
): Record<string, unknown> {
  const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
  const descriptor = pickMetadataDescriptor(crate)
  const rootDataset =
    graph.find(
      (entity) =>
        !!entity &&
        typeof entity === 'object' &&
        !Array.isArray(entity) &&
        entity['@id'] === './',
    ) ?? null
  const rootDatasetSummary =
    rootDataset && typeof rootDataset === 'object' && !Array.isArray(rootDataset)
      ? {
          '@id': rootDataset['@id'],
          '@type': rootDataset['@type'],
          name: rootDataset.name ?? null,
          propertyKeys: Object.keys(rootDataset).sort(),
        }
      : null

  return {
    mode,
    metadataPath: cratePath,
    graphEntityCount: graph.length,
    hasRootDataset: rootDataset !== null,
    metadataDescriptorId:
      descriptor && typeof descriptor['@id'] === 'string' ? descriptor['@id'] : null,
    profileUrls: collectProfileUrls(crate),
    entityTypeCounts: summarizeEntityTypeCounts(crate),
    rootDataset: rootDatasetSummary,
  }
}

function summarizeChangeSet(changeSet: RoCrateChangeSet): Record<string, unknown> {
  const addEntities = Array.isArray(changeSet.addEntities) ? changeSet.addEntities : []
  const updateEntities = Array.isArray(changeSet.updateEntities)
    ? changeSet.updateEntities
    : []
  const removeEntities = Array.isArray(changeSet.removeEntities)
    ? changeSet.removeEntities
    : []
  const addHasPart = Array.isArray(changeSet.addHasPart) ? changeSet.addHasPart : []
  const removeHasPart = Array.isArray(changeSet.removeHasPart)
    ? changeSet.removeHasPart
    : []
  const setRootFields =
    changeSet.setRootFields &&
    typeof changeSet.setRootFields === 'object' &&
    !Array.isArray(changeSet.setRootFields)
      ? Object.keys(changeSet.setRootFields)
      : []
  const mergeContext =
    changeSet.mergeContext &&
    typeof changeSet.mergeContext === 'object' &&
    !Array.isArray(changeSet.mergeContext)
      ? Object.keys(changeSet.mergeContext)
      : []

  const addedIds = addEntities
    .map((entity) =>
      entity && typeof entity === 'object' && !Array.isArray(entity)
        ? entity['@id']
        : undefined,
    )
    .filter((id): id is string => typeof id === 'string')
  const updatedIds = updateEntities
    .map((entity) =>
      entity && typeof entity === 'object' && !Array.isArray(entity)
        ? entity['@id']
        : undefined,
    )
    .filter((id): id is string => typeof id === 'string')
  const removedIds = removeEntities.filter((id): id is string => typeof id === 'string')

  return {
    counts: {
      addEntities: addEntities.length,
      updateEntities: updateEntities.length,
      removeEntities: removeEntities.length,
      addHasPart: addHasPart.length,
      removeHasPart: removeHasPart.length,
      setRootFields: setRootFields.length,
      mergeContext: mergeContext.length,
    },
    changedEntityIds: {
      added: summarizeStringArray(addedIds),
      updated: summarizeStringArray(updatedIds),
      removed: summarizeStringArray(removedIds),
    },
    changedRootFields: setRootFields,
    mergeContextKeys: mergeContext,
  }
}

function summarizeValidationPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const errors = Array.isArray(payload.errors) ? payload.errors : []
  const warnings = Array.isArray(payload.warnings) ? payload.warnings : []
  const profile =
    payload.profile &&
    typeof payload.profile === 'object' &&
    !Array.isArray(payload.profile)
      ? (payload.profile as Record<string, unknown>)
      : {}
  const profileErrors = Array.isArray(profile.errors) ? profile.errors : []
  const profileWarnings = Array.isArray(profile.warnings) ? profile.warnings : []
  const resolution =
    profile.resolution &&
    typeof profile.resolution === 'object' &&
    !Array.isArray(profile.resolution)
      ? (profile.resolution as ProfileResolution)
      : undefined

  const errorSummary = summarizeArray(errors)
  const warningSummary = summarizeArray(warnings)
  const profileErrorSummary = summarizeArray(profileErrors)
  const profileWarningSummary = summarizeArray(profileWarnings)

  return {
    valid: payload.valid === true,
    summary: payload.summary,
    errors: errorSummary.items,
    warnings: warningSummary.items,
    errorsTotal: errorSummary.total,
    warningsTotal: warningSummary.total,
    errorsTruncated: errorSummary.truncated,
    warningsTruncated: warningSummary.truncated,
    profile: {
      valid: profile.valid === true,
      errors: profileErrorSummary.items,
      warnings: profileWarningSummary.items,
      errorsTotal: profileErrorSummary.total,
      warningsTotal: profileWarningSummary.total,
      errorsTruncated: profileErrorSummary.truncated,
      warningsTruncated: profileWarningSummary.truncated,
      requiredMode: profile.requiredMode,
      resolution: resolution ? summarizeProfileResolution(resolution) : undefined,
    },
  }
}

function asRoCrate(value: unknown): RoCrate {
  return normalizeCrate(value as RoCrate)
}

function loadCrateFromParams(params: Record<string, unknown>): {
  mode: AccessMode
  crate: RoCrate
  cratePath?: string
} {
  const mode = parseAccessMode(params)
  if (mode === 'remote') {
    const crateParam = params.crate
    if (!crateParam || typeof crateParam !== 'object' || Array.isArray(crateParam)) {
      throw new Error('remote mode requires crate object.')
    }
    return { mode, crate: asRoCrate(crateParam) }
  }
  const cratePath = ensureCratePath(params.cratePath)
  const crate = readCrateFromFile(cratePath)
  return { mode, crate, cratePath }
}

function normalizeUpdateEntityAliasEntry(
  entry: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const id = typeof entry['@id'] === 'string' ? entry['@id'] : undefined
  if (!id) {
    return undefined
  }
  const unset = Array.isArray(entry.unset)
    ? entry.unset.filter((item): item is string => typeof item === 'string')
    : undefined
  const upsert = entry.upsert
  if (upsert && typeof upsert === 'object' && !Array.isArray(upsert)) {
    return unset && unset.length > 0
      ? { '@id': id, merge: upsert as Record<string, unknown>, unset }
      : { '@id': id, merge: upsert as Record<string, unknown> }
  }
  const merge = entry.merge
  if (merge && typeof merge === 'object' && !Array.isArray(merge)) {
    return unset && unset.length > 0
      ? { '@id': id, merge: merge as Record<string, unknown>, unset }
      : { '@id': id, merge: merge as Record<string, unknown> }
  }
  const fallbackMerge = Object.fromEntries(
    Object.entries(entry).filter(
      ([key]) => key !== '@id' && key !== 'upsert' && key !== 'merge' && key !== 'unset',
    ),
  )
  if (Object.keys(fallbackMerge).length > 0) {
    return unset && unset.length > 0
      ? { '@id': id, merge: fallbackMerge, unset }
      : { '@id': id, merge: fallbackMerge }
  }
  return unset && unset.length > 0 ? { '@id': id, unset } : { '@id': id }
}

function normalizeChangeSet(input: unknown): RoCrateChangeSet {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('apply_changes requires changeSet object.')
  }
  const raw = asRecord(input)
  const normalized: Record<string, unknown> = { ...raw }

  if (Array.isArray(raw.entityChanges) && !Array.isArray(raw.updateEntities)) {
    normalized.updateEntities = raw.entityChanges
      .filter(
        (entry): entry is Record<string, unknown> =>
          !!entry && typeof entry === 'object' && !Array.isArray(entry),
      )
      .map((entry) => normalizeUpdateEntityAliasEntry(entry))
      .filter((entry): entry is Record<string, unknown> => !!entry)
  }
  if (Array.isArray(raw.setProperties) && !Array.isArray(raw.updateEntities)) {
    normalized.updateEntities = raw.setProperties
      .filter(
        (entry): entry is Record<string, unknown> =>
          !!entry && typeof entry === 'object' && !Array.isArray(entry),
      )
      .map((entry) => normalizeUpdateEntityAliasEntry(entry))
      .filter((entry): entry is Record<string, unknown> => !!entry)
  }
  if (Array.isArray(raw.upsertEntities) && !Array.isArray(raw.addEntities)) {
    normalized.addEntities = raw.upsertEntities.filter(
      (entry): entry is Record<string, unknown> =>
        !!entry && typeof entry === 'object' && !Array.isArray(entry),
    )
  }
  if (
    raw.rootFields &&
    typeof raw.rootFields === 'object' &&
    !Array.isArray(raw.rootFields) &&
    !normalized.setRootFields
  ) {
    normalized.setRootFields = raw.rootFields
  }

  delete normalized.entityChanges
  delete normalized.setProperties
  delete normalized.upsertEntities
  delete normalized.rootFields

  const unknownKeys = Object.keys(normalized).filter(
    (key) => !CHANGE_SET_ALLOWED_KEYS.has(key),
  )
  if (unknownKeys.length > 0) {
    throw new Error(
      `apply_changes changeSet has unsupported keys: ${unknownKeys.join(
        ', ',
      )}. Supported keys: ${Array.from(CHANGE_SET_ALLOWED_KEYS).join(', ')}`,
    )
  }

  return normalized as RoCrateChangeSet
}

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

function readProfileUrlsToAttach(params: Record<string, unknown>): string[] {
  const urls: string[] = []
  if (typeof params.profileUrl === 'string') {
    const trimmed = params.profileUrl.trim()
    if (trimmed !== '') {
      urls.push(trimmed)
    }
  }
  if (Array.isArray(params.profileUrls)) {
    for (const item of params.profileUrls) {
      if (typeof item !== 'string') {
        continue
      }
      const trimmed = item.trim()
      if (trimmed === '') {
        continue
      }
      urls.push(trimmed)
    }
  }
  return uniqueStrings(urls)
}

function addProfileConformsTo(
  crate: RoCrate,
  entityId: string,
  profileUrls: string[],
): { previousUrls: string[]; addedUrls: string[]; finalUrls: string[] } {
  const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
  const target = graph.find(
    (entity) =>
      !!entity &&
      typeof entity === 'object' &&
      !Array.isArray(entity) &&
      entity['@id'] === entityId,
  )
  if (!target) {
    throw new Error(`Entity not found for conformsTo update: ${entityId}`)
  }

  const previousUrls = extractConformsToUrls(target.conformsTo)
  const finalUrls = uniqueStrings([...previousUrls, ...profileUrls])
  const previousSet = new Set(previousUrls)
  const addedUrls = finalUrls.filter((url) => !previousSet.has(url))
  target.conformsTo = finalUrls.map((url) => ({ '@id': url }))

  return { previousUrls, addedUrls, finalUrls }
}

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

function resolveAromaRootPath(): string {
  const configuredRoot = process.env.AROMA_ROOT_PATH
  if (configuredRoot && configuredRoot.trim() !== '') {
    return path.resolve(configuredRoot)
  }
  return path.join(os.homedir(), '.aroma')
}

function resolveSchemaIndexPath(): { rootPath: string; indexPath: string } {
  const rootPath = resolveAromaRootPath()
  const configuredIndex = process.env.AROMA_METADATA_SCHEMA_INDEX_FILE
  if (!configuredIndex || configuredIndex.trim() === '') {
    return { rootPath, indexPath: path.join(rootPath, DEFAULT_SCHEMA_INDEX_FILENAME) }
  }
  if (path.isAbsolute(configuredIndex)) {
    return { rootPath: path.dirname(configuredIndex), indexPath: configuredIndex }
  }
  return { rootPath, indexPath: path.join(rootPath, configuredIndex) }
}

function asSchemaIndex(value: unknown): SchemaIndexDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { profiles: [], conformsToIndex: {} }
  }
  const obj = value as Record<string, unknown>
  const profiles = Array.isArray(obj.profiles)
    ? obj.profiles.filter(
        (item): item is SchemaIndexProfile =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : []
  const conformsToIndex: Record<string, string[]> = {}
  const rawIndex = obj.conformsToIndex
  if (rawIndex && typeof rawIndex === 'object' && !Array.isArray(rawIndex)) {
    for (const [key, valueOfKey] of Object.entries(rawIndex)) {
      if (Array.isArray(valueOfKey)) {
        conformsToIndex[key] = valueOfKey.filter(
          (item): item is string => typeof item === 'string' && item.trim() !== '',
        )
      }
    }
  }
  return {
    profiles,
    conformsToIndex,
  }
}

function parseProfileContentsMap(
  value: unknown,
): Record<string, Record<string, unknown>> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const map: Record<string, Record<string, unknown>> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue
    }
    map[key] = entry as Record<string, unknown>
  }
  return Object.keys(map).length > 0 ? map : undefined
}

function parseProfileContextId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function parseTtlSec(value: unknown): number {
  const defaultTtl = DEFAULT_PROFILE_CONTEXT_TTL_SEC
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultTtl
  }
  return Math.max(60, Math.min(86400, Math.floor(value)))
}

function pruneExpiredProfileContexts(now = Date.now()): void {
  for (const [id, record] of profileContextStore.entries()) {
    if (new Date(record.expiresAt).getTime() <= now) {
      profileContextStore.delete(id)
    }
  }
}

function summarizeProfileContext(record: ProfileContextRecord): Record<string, unknown> {
  return {
    profileContextId: record.id,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    profileUrls: record.profileUrls,
    unresolvedUrls: record.unresolvedUrls,
    warnings: record.warnings,
    profileIds: record.profileIds,
    profileCount: record.profileIds.length,
    profileContentEntryCount: Object.keys(record.profileContents).length,
    contentHash: record.contentHash,
  }
}

function getProfileContextOrThrow(profileContextId: string): ProfileContextRecord {
  pruneExpiredProfileContexts()
  const record = profileContextStore.get(profileContextId)
  if (!record) {
    throw new Error(`Unknown or expired profileContextId: ${profileContextId}`)
  }
  return record
}

function storeProfileContext(
  payload: {
    profileUrls: string[]
    unresolvedUrls: string[]
    warnings: string[]
    schemaIndex: SchemaIndexDocument
    profileContents: Record<string, Record<string, unknown>>
  },
  ttlSec: number,
): ProfileContextRecord {
  pruneExpiredProfileContexts()
  const now = new Date()
  const contentHash = createHash('sha256')
    .update(
      JSON.stringify({
        schemaIndex: payload.schemaIndex,
        profileContents: payload.profileContents,
      }),
      'utf8',
    )
    .digest('hex')
  const profileIds = uniqueStrings(
    payload.schemaIndex.profiles
      .map((profile) => profile.id)
      .filter((id): id is string => typeof id === 'string' && id.trim() !== ''),
  )

  for (const existing of profileContextStore.values()) {
    if (existing.contentHash === contentHash) {
      existing.expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString()
      return existing
    }
  }

  const record: ProfileContextRecord = {
    id: randomUUID(),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSec * 1000).toISOString(),
    profileUrls: payload.profileUrls,
    unresolvedUrls: payload.unresolvedUrls,
    warnings: payload.warnings,
    schemaIndex: payload.schemaIndex,
    profileContents: payload.profileContents,
    profileIds,
    contentHash,
  }
  profileContextStore.set(record.id, record)
  return record
}

function parseProfileResolutionInputs(
  params: Record<string, unknown>,
): ProfileResolutionInputs {
  const inputs: ProfileResolutionInputs = {}
  const profileContextId = parseProfileContextId(params.profileContextId)
  if (profileContextId) {
    const context = getProfileContextOrThrow(profileContextId)
    inputs.profileContextId = profileContextId
    inputs.schemaIndex = context.schemaIndex
    inputs.profileContents = context.profileContents
  }
  if (
    params.schemaIndex &&
    typeof params.schemaIndex === 'object' &&
    !Array.isArray(params.schemaIndex)
  ) {
    inputs.schemaIndex = asSchemaIndex(params.schemaIndex)
  }
  const profileContents = parseProfileContentsMap(params.profileContents)
  if (profileContents) {
    inputs.profileContents = profileContents
  }
  return inputs
}

function parseProfileRequiredMode(
  params: Record<string, unknown>,
  defaultMode: ProfileRequiredMode,
): ProfileRequiredMode {
  return params.profileRequiredMode === 'enforce_required'
    ? 'enforce_required'
    : defaultMode
}

function parseContextMode(
  params: Record<string, unknown>,
  defaultMode: ContextMode = 'auto_reconcile',
): ContextMode {
  if (params.contextMode === 'strict') {
    return 'strict'
  }
  if (params.contextMode === 'auto_add') {
    return 'auto_add'
  }
  if (params.contextMode === 'auto_reconcile') {
    return 'auto_reconcile'
  }
  return defaultMode
}

function loadSchemaIndexFromDisk(): {
  index: SchemaIndexDocument
  indexPath: string
  rootPath: string
  warning?: string
} {
  const { rootPath, indexPath } = resolveSchemaIndexPath()
  if (!fs.existsSync(indexPath)) {
    return {
      index: { profiles: [], conformsToIndex: {} },
      indexPath,
      rootPath,
      warning: `Schema index file not found: ${indexPath}`,
    }
  }
  try {
    const payload = fs.readFileSync(indexPath, 'utf8')
    const parsed = JSON.parse(payload) as unknown
    return {
      index: asSchemaIndex(parsed),
      indexPath,
      rootPath,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      index: { profiles: [], conformsToIndex: {} },
      indexPath,
      rootPath,
      warning: `Failed to parse schema index: ${message}`,
    }
  }
}

function loadConvertedProfile(
  profile: SchemaIndexProfile,
  rootPath: string,
  includeProfileContent: boolean,
): ResolvedProfile {
  const convertedPathRaw = profile.files?.convertedPath
  const convertedPath =
    typeof convertedPathRaw === 'string' ? convertedPathRaw : undefined
  const absoluteConvertedPath =
    convertedPath && path.isAbsolute(convertedPath)
      ? convertedPath
      : convertedPath
        ? path.join(rootPath, convertedPath)
        : undefined
  const resolved: ResolvedProfile = {
    id: profile.id,
    name: profile.name,
    version: profile.version,
    conformsTo: profile.conformsTo,
    convertedPath,
    absoluteConvertedPath,
    loaded: false,
  }
  if (!absoluteConvertedPath) {
    resolved.loadError = 'Missing files.convertedPath in schema index profile.'
    return resolved
  }
  if (!fs.existsSync(absoluteConvertedPath)) {
    resolved.loadError = `Converted profile file not found: ${absoluteConvertedPath}`
    return resolved
  }
  try {
    const rawPayload = fs.readFileSync(absoluteConvertedPath, 'utf8')
    const parsed = JSON.parse(rawPayload) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      resolved.loadError = `Converted profile is not an object: ${absoluteConvertedPath}`
      return resolved
    }
    resolved.loaded = true
    if (includeProfileContent) {
      resolved.profile = parsed as Record<string, unknown>
    }
    return resolved
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    resolved.loadError = `Failed to load converted profile ${absoluteConvertedPath}: ${message}`
    return resolved
  }
}

function resolveProfileUrls(
  profileUrls: string[],
  mode: AccessMode,
  includeProfileContent: boolean,
  inputs: ProfileResolutionInputs = {},
): ProfileResolution {
  const hasInlineInputs = Boolean(inputs.schemaIndex || inputs.profileContents)
  if (mode !== 'local' && !hasInlineInputs) {
    return {
      mode,
      inputProvided: false,
      profileContextId: inputs.profileContextId,
      profileUrls,
      unresolvedUrls: profileUrls,
      profiles: [],
      warnings:
        profileUrls.length > 0
          ? [
              'Remote mode profile resolution requires caller-supplied schema index/profile content.',
            ]
          : [],
    }
  }

  function fromInline(keys: string[]): Record<string, unknown> | undefined {
    const map = inputs.profileContents
    if (!map) {
      return undefined
    }
    for (const key of keys) {
      if (!key) {
        continue
      }
      const value = map[key]
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value
      }
    }
    return undefined
  }

  if (mode !== 'local' && hasInlineInputs) {
    const index = inputs.schemaIndex ?? { profiles: [], conformsToIndex: {} }
    const profilesById = new Map<string, SchemaIndexProfile>()
    for (const profile of index.profiles) {
      if (typeof profile.id === 'string' && profile.id.trim() !== '') {
        profilesById.set(profile.id, profile)
      }
    }
    const resolvedProfiles: ResolvedProfile[] = []
    const unresolvedUrls: string[] = []
    const warnings: string[] = []
    for (const profileUrl of profileUrls) {
      const idsFromIndex = index.conformsToIndex[profileUrl] ?? []
      const ids = idsFromIndex.length > 0 ? idsFromIndex : [profileUrl]
      let foundAny = false
      for (const id of ids) {
        if (resolvedProfiles.some((profile) => profile.id === id)) {
          foundAny = true
          continue
        }
        const profileRecord = profilesById.get(id)
        if (id !== profileUrl && !profileRecord) {
          warnings.push(
            `Profile id referenced by schemaIndex but not found in profiles: ${id}`,
          )
        }
        const convertedPath = profileRecord?.files?.convertedPath
        const inlineProfile = fromInline([id, profileUrl, convertedPath ?? ''])
        if (inlineProfile) {
          const resolved: ResolvedProfile = {
            id,
            name: profileRecord?.name,
            version: profileRecord?.version,
            conformsTo: profileRecord?.conformsTo ?? profileUrl,
            convertedPath,
            absoluteConvertedPath: convertedPath,
            loaded: true,
          }
          if (includeProfileContent) {
            resolved.profile = inlineProfile
          }
          resolvedProfiles.push(resolved)
          foundAny = true
          continue
        }
        if (id === profileUrl && idsFromIndex.length === 0) {
          continue
        }
        resolvedProfiles.push({
          id,
          name: profileRecord?.name,
          version: profileRecord?.version,
          conformsTo: profileRecord?.conformsTo ?? profileUrl,
          convertedPath,
          absoluteConvertedPath: convertedPath,
          loaded: false,
          loadError:
            'Remote mode requires profileContents entry keyed by profile id, profile URL, or convertedPath.',
        })
        foundAny = true
      }
      if (!foundAny) {
        unresolvedUrls.push(profileUrl)
      }
    }
    return {
      mode,
      inputProvided: true,
      profileContextId: inputs.profileContextId,
      profileUrls,
      unresolvedUrls,
      profiles: resolvedProfiles,
      warnings,
    }
  }

  const loadedIndex = loadSchemaIndexFromDisk()
  const profilesById = new Map<string, SchemaIndexProfile>()
  for (const profile of loadedIndex.index.profiles) {
    if (typeof profile.id === 'string' && profile.id.trim() !== '') {
      profilesById.set(profile.id, profile)
    }
  }
  const resolvedProfiles: ResolvedProfile[] = []
  const unresolvedUrls: string[] = []
  const warnings: string[] = []
  if (loadedIndex.warning) {
    warnings.push(loadedIndex.warning)
  }

  for (const profileUrl of profileUrls) {
    const profileIds = loadedIndex.index.conformsToIndex[profileUrl]
    if (!profileIds || profileIds.length === 0) {
      unresolvedUrls.push(profileUrl)
      continue
    }
    for (const profileId of profileIds) {
      const profile = profilesById.get(profileId)
      if (!profile) {
        warnings.push(
          `Profile id referenced by conformsToIndex but not found in profiles: ${profileId}`,
        )
        continue
      }
      if (resolvedProfiles.some((item) => item.id === profileId)) {
        continue
      }
      resolvedProfiles.push(
        loadConvertedProfile(profile, loadedIndex.rootPath, includeProfileContent),
      )
    }
  }

  return {
    mode,
    inputProvided: false,
    profileContextId: inputs.profileContextId,
    profileUrls,
    unresolvedUrls,
    profiles: resolvedProfiles,
    indexPath: loadedIndex.indexPath,
    aromaRootPath: loadedIndex.rootPath,
    warnings,
  }
}

function extractAllowedPropertiesFromClass(profileClass: unknown): Set<string> {
  const allowed = new Set<string>()
  if (!profileClass || typeof profileClass !== 'object' || Array.isArray(profileClass)) {
    return allowed
  }
  const inputs = (profileClass as Record<string, unknown>).inputs
  if (!Array.isArray(inputs)) {
    return allowed
  }
  for (const input of inputs) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      continue
    }
    const name = (input as Record<string, unknown>).name
    if (typeof name === 'string' && name.trim() !== '') {
      allowed.add(name)
    }
  }
  return allowed
}

function extractRequiredPropertiesFromClass(profileClass: unknown): Set<string> {
  const required = new Set<string>()
  if (!profileClass || typeof profileClass !== 'object' || Array.isArray(profileClass)) {
    return required
  }
  const inputs = (profileClass as Record<string, unknown>).inputs
  if (!Array.isArray(inputs)) {
    return required
  }
  for (const input of inputs) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      continue
    }
    const requiredFlag = (input as Record<string, unknown>).required === true
    const name = (input as Record<string, unknown>).name
    if (requiredFlag && typeof name === 'string' && name.trim() !== '') {
      required.add(name)
    }
  }
  return required
}

function buildProfileConstraints(
  crate: RoCrate,
  mode: AccessMode,
  inputs: ProfileResolutionInputs = {},
): ProfileConstraints {
  const profileUrls = collectProfileUrls(crate)
  const resolution = resolveProfileUrls(profileUrls, mode, true, inputs)
  const allowedClasses = new Set<string>()
  const allowedPropertiesByClass = new Map<string, Set<string>>()
  const requiredPropertiesByClass = new Map<string, Set<string>>()

  for (const profile of resolution.profiles) {
    if (!profile.profile) {
      continue
    }
    const classesValue = profile.profile.classes
    const classes =
      classesValue && typeof classesValue === 'object' && !Array.isArray(classesValue)
        ? (classesValue as Record<string, unknown>)
        : {}
    const enabledClassesValue = profile.profile.enabledClasses
    const enabledClasses = Array.isArray(enabledClassesValue)
      ? enabledClassesValue.filter(
          (item): item is string => typeof item === 'string' && item.trim() !== '',
        )
      : []

    for (const className of enabledClasses) {
      allowedClasses.add(className)
    }

    for (const [className, classDef] of Object.entries(classes)) {
      allowedClasses.add(className)
      const currentAllowed = allowedPropertiesByClass.get(className) ?? new Set<string>()
      const extractedAllowed = extractAllowedPropertiesFromClass(classDef)
      for (const propertyName of extractedAllowed) {
        currentAllowed.add(propertyName)
      }
      allowedPropertiesByClass.set(className, currentAllowed)

      const currentRequired =
        requiredPropertiesByClass.get(className) ?? new Set<string>()
      const extractedRequired = extractRequiredPropertiesFromClass(classDef)
      for (const propertyName of extractedRequired) {
        currentRequired.add(propertyName)
      }
      requiredPropertiesByClass.set(className, currentRequired)
    }
  }

  return {
    resolution,
    allowedClasses,
    allowedPropertiesByClass,
    requiredPropertiesByClass,
  }
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false
  }
  if (typeof value === 'string') {
    return value.trim() !== ''
  }
  if (Array.isArray(value)) {
    return value.length > 0
  }
  return true
}

function getBestNameCandidate(entity: RoCrateEntity): string | undefined {
  const preferredFields = [
    'authorName',
    'datasetContactName',
    'contributorName',
    'producerName',
    'distributorName',
    'publicationCitation',
    'title',
  ]
  for (const key of preferredFields) {
    const value = entity[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim()
    }
  }
  return undefined
}

function validateCrateAgainstProfileConstraints(
  crate: RoCrate,
  constraints: ProfileConstraints,
  options: { requiredMode: ProfileRequiredMode } = { requiredMode: 'allow_missing' },
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings = [...constraints.resolution.warnings]
  const profileUrls = constraints.resolution.profileUrls
  if (profileUrls.length === 0) {
    return { valid: true, errors, warnings }
  }
  if (constraints.resolution.unresolvedUrls.length > 0) {
    const message = `No schema profile mapping found for conformsTo URL(s): ${constraints.resolution.unresolvedUrls.join(', ')}`
    if (
      constraints.resolution.mode === 'remote' &&
      !constraints.resolution.inputProvided
    ) {
      warnings.push(message)
    } else {
      errors.push(message)
    }
  }
  const failedProfiles = constraints.resolution.profiles.filter(
    (profile) => !profile.loaded,
  )
  if (failedProfiles.length > 0) {
    const message = `Failed to load converted profile(s): ${failedProfiles
      .map((profile) => profile.loadError ?? profile.id)
      .join('; ')}`
    if (
      constraints.resolution.mode === 'remote' &&
      !constraints.resolution.inputProvided
    ) {
      warnings.push(message)
    } else {
      errors.push(message)
    }
  }
  if (errors.length > 0) {
    return { valid: false, errors, warnings }
  }

  const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
  for (const entity of graph) {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
      continue
    }
    const entityProfileUrls = extractConformsToUrls(entity.conformsTo).filter(
      (url) => url !== ROCRATE_CONFORMS_TO_URL,
    )
    if (entityProfileUrls.length === 0) {
      continue
    }
    const entityId = typeof entity['@id'] === 'string' ? entity['@id'] : '<unknown>'
    const types = entityTypes(entity)
    for (const entityType of types) {
      if (SYSTEM_ENTITY_TYPES.has(entityType)) {
        continue
      }
      if (!constraints.allowedClasses.has(entityType)) {
        errors.push(`Entity ${entityId} has disallowed type: ${entityType}`)
      }
    }

    const allowedProperties = new Set<string>(BASE_ALLOWED_PROPERTIES)
    for (const entityType of types) {
      const classAllowedProps = constraints.allowedPropertiesByClass.get(entityType)
      if (!classAllowedProps) {
        continue
      }
      for (const prop of classAllowedProps) {
        allowedProperties.add(prop)
      }
    }
    for (const key of Object.keys(entity)) {
      if (allowedProperties.has(key)) {
        continue
      }
      errors.push(`Entity ${entityId} contains disallowed property: ${key}`)
    }

    const nameValue = entity.name
    const hasName = hasMeaningfulValue(nameValue)
    if (!hasName) {
      const message = `Entity ${entityId} is missing human-friendly name`
      if (options.requiredMode === 'enforce_required') {
        errors.push(message)
      } else {
        warnings.push(message)
      }
    } else if (typeof nameValue === 'string') {
      const candidate = getBestNameCandidate(entity)
      if (nameValue.trim() === entityId && candidate && candidate !== entityId) {
        const message = `Entity ${entityId} uses @id as name while descriptive field is available`
        if (options.requiredMode === 'enforce_required') {
          errors.push(message)
        } else {
          warnings.push(message)
        }
      }
    }

    if (options.requiredMode === 'enforce_required') {
      const requiredProperties = new Set<string>()
      for (const entityType of types) {
        const classRequiredProps = constraints.requiredPropertiesByClass.get(entityType)
        if (!classRequiredProps) {
          continue
        }
        for (const prop of classRequiredProps) {
          requiredProperties.add(prop)
        }
      }
      for (const requiredProperty of requiredProperties) {
        if (!hasMeaningfulValue(entity[requiredProperty])) {
          errors.push(
            `Entity ${entityId} is missing required property: ${requiredProperty}`,
          )
        }
      }
    }
  }

  const contextSuggestion = buildContextTermSuggestion(crate, constraints)
  for (const term of contextSuggestion.missingTerms) {
    errors.push(`Missing @context mapping for used term: ${term}`)
  }
  for (const term of contextSuggestion.unknownTerms) {
    warnings.push(
      `No profile IRI found for context term: ${term}. Consider adding explicit mapping in @context.`,
    )
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

function collectProfilePropertyNames(constraints: ProfileConstraints): Set<string> {
  const names = new Set<string>()
  for (const properties of constraints.allowedPropertiesByClass.values()) {
    for (const propertyName of properties) {
      names.add(propertyName)
    }
  }
  return names
}

function collectDeclaredContextTerms(crate: RoCrate): Set<string> {
  const declared = new Set<string>()
  const context = crate['@context']
  const collect = (item: unknown): void => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return
    }
    for (const key of Object.keys(item as Record<string, unknown>)) {
      declared.add(key)
    }
  }
  if (Array.isArray(context)) {
    for (const item of context) {
      collect(item)
    }
    return declared
  }
  collect(context)
  return declared
}

function collectUsedGraphTerms(crate: RoCrate): Set<string> {
  const used = new Set<string>()
  const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
  for (const entity of graph) {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
      continue
    }
    for (const key of Object.keys(entity)) {
      if (!key.startsWith('@')) {
        used.add(key)
      }
    }
  }
  return used
}

function collectProfileTermIriResolution(
  constraints: ProfileConstraints,
): ProfileTermIriResolution {
  const iriCandidates = new Map<string, Set<string>>()
  for (const profile of constraints.resolution.profiles) {
    const content = profile.profile
    if (!content) {
      continue
    }
    const classesValue = content.classes
    if (
      !classesValue ||
      typeof classesValue !== 'object' ||
      Array.isArray(classesValue)
    ) {
      continue
    }
    for (const classValue of Object.values(classesValue as Record<string, unknown>)) {
      if (!classValue || typeof classValue !== 'object' || Array.isArray(classValue)) {
        continue
      }
      const inputs = (classValue as Record<string, unknown>).inputs
      if (!Array.isArray(inputs)) {
        continue
      }
      for (const input of inputs) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          continue
        }
        const name = (input as Record<string, unknown>).name
        const iri = (input as Record<string, unknown>).id
        if (
          typeof name === 'string' &&
          name.trim() !== '' &&
          typeof iri === 'string' &&
          iri.trim() !== ''
        ) {
          const trimmedName = name.trim()
          const trimmedIri = iri.trim()
          const existing = iriCandidates.get(trimmedName)
          if (existing) {
            existing.add(trimmedIri)
          } else {
            iriCandidates.set(trimmedName, new Set<string>([trimmedIri]))
          }
        }
      }
    }
  }
  const termToIri: Record<string, string> = {}
  const ambiguousTerms: string[] = []
  for (const [term, iris] of Array.from(iriCandidates.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const values = Array.from(iris.values()).sort((a, b) => a.localeCompare(b))
    if (values.length === 1) {
      termToIri[term] = values[0]
      continue
    }
    ambiguousTerms.push(term)
  }
  return {
    termToIri,
    ambiguousTerms,
  }
}

function collectDeclaredContextMappings(crate: RoCrate): Record<string, string> {
  const mappings: Record<string, string> = {}
  const context = crate['@context']
  const collect = (item: unknown): void => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return
    }
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim() !== '') {
        mappings[key] = value.trim()
      }
    }
  }
  if (Array.isArray(context)) {
    for (const item of context) {
      collect(item)
    }
    return mappings
  }
  collect(context)
  return mappings
}

function applyContextUpdate(
  crate: RoCrate,
  contextUpdate: Record<string, string>,
): RoCrate {
  if (Object.keys(contextUpdate).length === 0) {
    return crate
  }
  return applyChangeSet(crate, { mergeContext: contextUpdate })
}

function applyContextModePatch(
  crate: RoCrate,
  constraints: ProfileConstraints,
  contextMode: ContextMode,
): { crate: RoCrate; report: ContextAutoPatchReport } {
  const report: ContextAutoPatchReport = {
    mode: contextMode,
    addedTerms: [],
    reconciledTerms: [],
    skippedConflicts: [],
    ambiguousTerms: [],
  }
  if (contextMode === 'strict') {
    return { crate, report }
  }

  const suggestion = buildContextTermSuggestion(crate, constraints)
  const usedTerms = new Set<string>(suggestion.usedTerms)
  const declaredMappings = collectDeclaredContextMappings(crate)
  const termResolution = collectProfileTermIriResolution(constraints)
  report.ambiguousTerms = termResolution.ambiguousTerms

  const contextUpdate: Record<string, string> = {}
  for (const [term, iri] of Object.entries(suggestion.mergeContext)) {
    contextUpdate[term] = iri
    report.addedTerms.push(term)
  }

  if (contextMode === 'auto_reconcile') {
    for (const term of usedTerms) {
      const expectedIri = termResolution.termToIri[term]
      const currentIri = declaredMappings[term]
      if (!expectedIri || !currentIri || expectedIri === currentIri) {
        continue
      }
      contextUpdate[term] = expectedIri
      report.reconciledTerms.push({ term, from: currentIri, to: expectedIri })
    }
  } else if (contextMode === 'auto_add') {
    for (const term of usedTerms) {
      const expectedIri = termResolution.termToIri[term]
      const currentIri = declaredMappings[term]
      if (!expectedIri || !currentIri || expectedIri === currentIri) {
        continue
      }
      report.skippedConflicts.push({ term, from: currentIri, expected: expectedIri })
    }
  }

  if (Object.keys(contextUpdate).length === 0) {
    return { crate, report }
  }
  return { crate: applyContextUpdate(crate, contextUpdate), report }
}

function buildContextTermSuggestion(
  crate: RoCrate,
  constraints?: ProfileConstraints,
): {
  mergeContext: Record<string, string>
  missingTerms: string[]
  unknownTerms: string[]
  usedTerms: string[]
  declaredTerms: string[]
} {
  const usedTerms = collectUsedGraphTerms(crate)
  const declaredTerms = collectDeclaredContextTerms(crate)
  const termResolution = constraints
    ? collectProfileTermIriResolution(constraints)
    : { termToIri: {}, ambiguousTerms: [] }
  const profileTermIriMap = termResolution.termToIri
  const ambiguousTerms = new Set<string>(termResolution.ambiguousTerms)
  const mergeContext: Record<string, string> = {}
  const missingTerms: string[] = []
  const unknownTerms: string[] = []
  for (const term of Array.from(usedTerms).sort((a, b) => a.localeCompare(b))) {
    if (declaredTerms.has(term)) {
      continue
    }
    if (DEFAULT_CONTEXT_KNOWN_TERMS.has(term)) {
      continue
    }
    missingTerms.push(term)
    if (ambiguousTerms.has(term)) {
      unknownTerms.push(term)
      continue
    }
    const profileIri = profileTermIriMap[term]
    if (profileIri) {
      mergeContext[term] = profileIri
    } else {
      unknownTerms.push(term)
    }
  }

  return {
    mergeContext,
    missingTerms,
    unknownTerms,
    usedTerms: Array.from(usedTerms).sort((a, b) => a.localeCompare(b)),
    declaredTerms: Array.from(declaredTerms).sort((a, b) => a.localeCompare(b)),
  }
}

function validateProfileTargetScopeForChangeSet(
  crate: RoCrate,
  changeSet: RoCrateChangeSet,
  constraints: ProfileConstraints,
): Array<{ entityId: string; properties: string[] }> {
  const violations: Array<{ entityId: string; properties: string[] }> = []
  if (constraints.resolution.profileUrls.length === 0) {
    return violations
  }

  const profilePropertyNames = collectProfilePropertyNames(constraints)
  if (profilePropertyNames.size === 0) {
    return violations
  }

  const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
  const updates = Array.isArray(changeSet.updateEntities) ? changeSet.updateEntities : []
  for (const update of updates) {
    if (!update || typeof update !== 'object' || Array.isArray(update)) {
      continue
    }
    const entityId = typeof update['@id'] === 'string' ? update['@id'] : ''
    if (entityId === '') {
      continue
    }
    const merge =
      update.merge && typeof update.merge === 'object' && !Array.isArray(update.merge)
        ? (update.merge as Record<string, unknown>)
        : undefined
    const unset = Array.isArray(update.unset)
      ? update.unset.filter((item): item is string => typeof item === 'string')
      : []
    if (!merge && unset.length === 0) {
      continue
    }
    const changedProfileProperties = [
      ...(merge ? Object.keys(merge) : []),
      ...unset,
    ].filter((key) => profilePropertyNames.has(key))
    if (changedProfileProperties.length === 0) {
      continue
    }

    const entity = graph.find(
      (item) =>
        !!item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        item['@id'] === entityId,
    )
    if (!entity) {
      continue
    }
    const types = entityTypes(entity)
    if (!types.includes('Dataset') && !types.includes('File')) {
      continue
    }

    const entityProfileUrls = extractConformsToUrls(entity.conformsTo).filter(
      (url) => url !== ROCRATE_CONFORMS_TO_URL,
    )
    const declaresActiveProfile = entityProfileUrls.some((profileUrl) =>
      constraints.resolution.profileUrls.includes(profileUrl),
    )
    if (!declaresActiveProfile) {
      violations.push({
        entityId,
        properties: changedProfileProperties,
      })
    }
  }
  return violations
}

function ensureProfileConformanceOrThrow(
  crate: RoCrate,
  mode: AccessMode,
  inputs: ProfileResolutionInputs = {},
  options: ProfileValidationOptions = {
    requiredMode: 'allow_missing',
  },
): ProfileConstraints {
  const constraints = buildProfileConstraints(crate, mode, inputs)
  if (mode !== 'local' && !constraints.resolution.inputProvided) {
    return constraints
  }
  const validation = validateCrateAgainstProfileConstraints(crate, constraints, {
    requiredMode: options.requiredMode,
  })
  if (validation.valid) {
    return constraints
  }

  if (!validation.valid) {
    throw new Error(`Profile conformance failed: ${validation.errors.join(' | ')}`)
  }
  return constraints
}

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
    },
    conformance: validation,
    instructions: [
      'Primary target is ro-crate-metadata.json.',
      'When user asks to add/activate a profile, use add_profile_conforms_to first.',
      'Treat profile scope as entity-local: profile fields apply only to entities that explicitly declare that profile URL in their own conformsTo.',
      'Do not fan out profile-field edits by class across other Dataset/File entities unless user explicitly asks.',
      'Use profileResolution to determine active profile files from conformsTo values on Dataset/File entities.',
      'Only edit entity types and properties that are allowed by resolved profiles.',
    ],
  }
}

function summarizeRoCrateContext(
  context: Record<string, unknown>,
): Record<string, unknown> {
  const profileResolution =
    context.profileResolution &&
    typeof context.profileResolution === 'object' &&
    !Array.isArray(context.profileResolution)
      ? (context.profileResolution as ProfileResolution)
      : undefined
  const conformance =
    context.conformance &&
    typeof context.conformance === 'object' &&
    !Array.isArray(context.conformance)
      ? (context.conformance as Record<string, unknown>)
      : {}
  const conformanceErrors = Array.isArray(conformance.errors) ? conformance.errors : []
  const conformanceWarnings = Array.isArray(conformance.warnings)
    ? conformance.warnings
    : []
  const errorSummary = summarizeArray(conformanceErrors)
  const warningSummary = summarizeArray(conformanceWarnings)
  const profileRules =
    context.profileRules &&
    typeof context.profileRules === 'object' &&
    !Array.isArray(context.profileRules)
      ? (context.profileRules as Record<string, unknown>)
      : {}
  const profileTargetsByUrlRaw =
    context.profileTargetsByUrl &&
    typeof context.profileTargetsByUrl === 'object' &&
    !Array.isArray(context.profileTargetsByUrl)
      ? (context.profileTargetsByUrl as Record<string, unknown>)
      : {}
  const profileTargetsByUrl = Object.fromEntries(
    Object.entries(profileTargetsByUrlRaw).map(([profileUrl, ids]) => {
      const entityIds = Array.isArray(ids)
        ? ids.filter((item): item is string => typeof item === 'string')
        : []
      const summary = summarizeStringArray(entityIds)
      return [
        profileUrl,
        {
          entityIds: summary.items,
          entityCount: summary.total,
          entityIdsTruncated: summary.truncated,
        },
      ]
    }),
  )
  const allowedClasses = Array.isArray(profileRules.allowedClasses)
    ? profileRules.allowedClasses.filter(
        (item): item is string => typeof item === 'string',
      )
    : []

  return {
    mode: context.mode,
    metadataPath: context.metadataPath,
    graphEntityCount: context.graphEntityCount,
    hasRootDataset: context.hasRootDataset,
    metadataDescriptorId: context.metadataDescriptorId,
    profileResolution: profileResolution
      ? summarizeProfileResolution(profileResolution)
      : undefined,
    profileRules: {
      allowedClassCount: allowedClasses.length,
      allowedClasses: summarizeStringArray(allowedClasses).items,
    },
    profileTargetsByUrl,
    conformance: {
      valid: conformance.valid === true,
      errors: errorSummary.items,
      warnings: warningSummary.items,
      errorsTotal: errorSummary.total,
      warningsTotal: warningSummary.total,
      errorsTruncated: errorSummary.truncated,
      warningsTruncated: warningSummary.truncated,
    },
    instructions: context.instructions,
  }
}

function summarizeApplyChangesPayload(
  payload: Record<string, unknown>,
  crate: RoCrate,
  changeSet: RoCrateChangeSet,
  constraints: ProfileConstraints,
): Record<string, unknown> {
  const contextPatchReport =
    payload.contextPatchReport &&
    typeof payload.contextPatchReport === 'object' &&
    !Array.isArray(payload.contextPatchReport)
      ? (payload.contextPatchReport as ContextAutoPatchReport)
      : undefined
  return {
    mode: payload.mode,
    writeApplied: payload.writeApplied,
    cratePath: payload.cratePath,
    profileRequiredMode: payload.profileRequiredMode,
    contextMode: payload.contextMode,
    profileResolution: summarizeProfileResolution(constraints.resolution),
    graphEntityCount: Array.isArray(crate['@graph']) ? crate['@graph'].length : 0,
    changes: summarizeChangeSet(changeSet),
    contextPatch: contextPatchReport
      ? {
          addedTerms: contextPatchReport.addedTerms,
          reconciledTerms: contextPatchReport.reconciledTerms,
          skippedConflicts: contextPatchReport.skippedConflicts,
          ambiguousTerms: contextPatchReport.ambiguousTerms,
        }
      : undefined,
    note: payload.note,
  }
}

function readProfileUrlsFromParams(params: Record<string, unknown>): string[] {
  if (!Array.isArray(params.profileUrls)) {
    return []
  }
  return uniqueStrings(
    params.profileUrls
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item !== '' && item !== ROCRATE_CONFORMS_TO_URL),
  )
}

function collectRemoteProfilePayload(params: Record<string, unknown>): {
  mode: 'local'
  metadataPath?: string
  profileUrls: string[]
  unresolvedUrls: string[]
  warnings: string[]
  schemaIndex: SchemaIndexDocument
  profileContents: Record<string, Record<string, unknown>>
} {
  const includeProfileContent = params.includeProfileContent !== false
  let profileUrls = readProfileUrlsFromParams(params)
  let metadataPath: string | undefined

  if (profileUrls.length === 0) {
    const loaded = loadCrateFromParams({ ...params, mode: 'local' })
    profileUrls = collectProfileUrls(loaded.crate)
    metadataPath = loaded.cratePath
  }

  const resolution = resolveProfileUrls(profileUrls, 'local', includeProfileContent)
  const schemaProfiles = resolution.profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    version: profile.version,
    files: {
      convertedPath: profile.convertedPath,
    },
    conformsTo: profile.conformsTo,
  }))
  const conformsToIndex: Record<string, string[]> = {}
  for (const profileUrl of profileUrls) {
    const ids = resolution.profiles
      .filter((profile) => profile.conformsTo === profileUrl)
      .map((profile) => profile.id)
    if (ids.length > 0) {
      conformsToIndex[profileUrl] = uniqueStrings(ids)
    }
  }

  const profileContents: Record<string, Record<string, unknown>> = {}
  if (includeProfileContent) {
    for (const profile of resolution.profiles) {
      if (!profile.loaded || !profile.profile) {
        continue
      }
      profileContents[profile.id] = profile.profile
      if (profile.conformsTo) {
        profileContents[profile.conformsTo] = profile.profile
      }
      if (profile.convertedPath) {
        profileContents[profile.convertedPath] = profile.profile
      }
    }
  }

  return {
    mode: 'local',
    metadataPath,
    profileUrls,
    unresolvedUrls: resolution.unresolvedUrls,
    warnings: resolution.warnings,
    schemaIndex: {
      profiles: schemaProfiles,
      conformsToIndex,
    },
    profileContents,
  }
}

function prepareRemoteProfilePayload(
  params: Record<string, unknown>,
): Record<string, unknown> {
  return collectRemoteProfilePayload(params)
}

function createProfileContext(params: Record<string, unknown>): Record<string, unknown> {
  const ttlSec = parseTtlSec(params.ttlSec)
  const profileContents = parseProfileContentsMap(params.profileContents)
  const hasInlineSchema =
    params.schemaIndex &&
    typeof params.schemaIndex === 'object' &&
    !Array.isArray(params.schemaIndex)
  const schemaIndex = hasInlineSchema ? asSchemaIndex(params.schemaIndex) : undefined

  const payload =
    schemaIndex || profileContents
      ? {
          mode: 'local' as const,
          metadataPath: undefined,
          profileUrls: readProfileUrlsFromParams(params),
          unresolvedUrls: [] as string[],
          warnings: [] as string[],
          schemaIndex: schemaIndex ?? { profiles: [], conformsToIndex: {} },
          profileContents: profileContents ?? {},
        }
      : collectRemoteProfilePayload(params)

  const record = storeProfileContext(
    {
      profileUrls: payload.profileUrls,
      unresolvedUrls: payload.unresolvedUrls,
      warnings: payload.warnings,
      schemaIndex: payload.schemaIndex,
      profileContents: payload.profileContents,
    },
    ttlSec,
  )

  return {
    profileContext: summarizeProfileContext(record),
    source: {
      mode: payload.mode,
      metadataPath: payload.metadataPath,
      profileUrls: payload.profileUrls,
      unresolvedUrls: payload.unresolvedUrls,
      warnings: payload.warnings,
    },
  }
}

function getProfileContextInfo(params: Record<string, unknown>): Record<string, unknown> {
  const profileContextId = parseProfileContextId(params.profileContextId)
  if (!profileContextId) {
    throw new Error('get_profile_context_info requires profileContextId.')
  }
  const record = getProfileContextOrThrow(profileContextId)
  return summarizeProfileContext(record)
}

function deleteProfileContext(params: Record<string, unknown>): Record<string, unknown> {
  const profileContextId = parseProfileContextId(params.profileContextId)
  if (!profileContextId) {
    throw new Error('delete_profile_context requires profileContextId.')
  }
  pruneExpiredProfileContexts()
  const removed = profileContextStore.delete(profileContextId)
  return {
    profileContextId,
    deleted: removed,
  }
}

function sanitizeWorkspaceEntry(entry: string): string {
  let normalized = entry.trim().replace(/\\/g, '/')
  while (normalized.startsWith('/')) {
    normalized = normalized.slice(1)
  }
  normalized = normalized.replace(/\/{2,}/g, '/')
  if (normalized === '' || normalized === '.' || normalized === './') {
    throw new Error('workspaceEntries must contain non-empty relative paths.')
  }
  const candidate = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
  const parts = candidate.split('/')
  if (parts.includes('..')) {
    throw new Error(`workspaceEntries cannot include parent traversal: ${entry}`)
  }
  return normalized
}

function computeRemoteDeltaWithWorkspaceEntries(
  crate: RoCrate,
  workspaceEntries: string[],
  includeHidden: boolean,
): unknown {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rocrate-mcp-delta-'))
  try {
    for (const rawEntry of workspaceEntries) {
      const normalized = sanitizeWorkspaceEntry(rawEntry)
      const isDirectory = normalized.endsWith('/')
      const targetPath = path.join(
        tempRoot,
        isDirectory ? normalized.slice(0, -1) : normalized,
      )
      if (isDirectory) {
        fs.mkdirSync(targetPath, { recursive: true })
      } else {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })
        if (!fs.existsSync(targetPath)) {
          fs.writeFileSync(targetPath, '')
        }
      }
    }
    return computeDelta(crate, tempRoot, { includeHidden })
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
}

function htmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
  const withLineHints = withoutScripts
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|td|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  const decoded = decodeHtmlEntities(withLineHints)
  return decoded
    .split(/\r?\n/g)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line.length > 0)
    .join('\n')
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, timeoutMs)
  try {
    return await fetch(url, {
      ...init,
      redirect: 'follow',
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  return fetchWithTimeout(url, timeoutMs, {
    method: 'GET',
    headers: {
      'user-agent': 'rocrate-mcp-server/0.0.0',
    },
  })
}

function parseWebSearchParams(params: Record<string, unknown>): WebSearchParams {
  const query = typeof params.query === 'string' ? params.query.trim() : ''
  if (query === '') {
    throw new Error('search requires non-empty query.')
  }
  const maxResults =
    typeof params.max_results === 'number' && Number.isFinite(params.max_results)
      ? Math.max(1, Math.min(20, Math.floor(params.max_results)))
      : 5
  const includeRawContent = params.include_raw_content === true
  const searchDepth = params.search_depth === 'advanced' ? 'advanced' : 'basic'
  const apiKey =
    typeof params.apiKey === 'string' && params.apiKey.trim() !== ''
      ? params.apiKey.trim()
      : undefined
  return {
    query,
    maxResults,
    includeRawContent,
    searchDepth,
    apiKey,
  }
}

async function runWebSearch(params: WebSearchParams): Promise<unknown> {
  const apiKey =
    (typeof process.env.TAVILY_API_KEY === 'string' &&
    process.env.TAVILY_API_KEY.trim() !== ''
      ? process.env.TAVILY_API_KEY.trim()
      : undefined) ?? params.apiKey
  if (!apiKey) {
    throw new Error(
      'search requires Tavily API key: set TAVILY_API_KEY on server or pass apiKey parameter.',
    )
  }
  const endpoint = process.env.TAVILY_API_URL || 'https://api.tavily.com/search'
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'rocrate-mcp-server/0.0.0',
    },
    body: JSON.stringify({
      api_key: apiKey,
      query: params.query,
      max_results: params.maxResults,
      include_raw_content: params.includeRawContent,
      search_depth: params.searchDepth,
    }),
  })
  const payloadText = await response.text()
  if (!response.ok) {
    throw new Error(
      `Tavily request failed (${response.status}): ${payloadText.slice(0, 300)}`,
    )
  }
  try {
    return JSON.parse(payloadText) as unknown
  } catch {
    throw new Error('Tavily response was not valid JSON.')
  }
}

function parseDownloadUrlParams(params: Record<string, unknown>): DownloadUrlParams {
  const url = typeof params.url === 'string' ? params.url.trim() : ''
  if (url === '') {
    throw new Error('download_url requires non-empty url.')
  }
  const rawHtml = params.raw_html === true
  const timeoutMs =
    typeof params.timeout_ms === 'number' && Number.isFinite(params.timeout_ms)
      ? Math.max(1000, Math.min(120000, Math.floor(params.timeout_ms)))
      : 10000
  const maxChars =
    typeof params.max_chars === 'number' && Number.isFinite(params.max_chars)
      ? Math.max(1000, Math.min(2_000_000, Math.floor(params.max_chars)))
      : 200000
  return {
    url,
    rawHtml,
    timeoutMs,
    maxChars,
  }
}

function readOptionalStringParam(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function resolveDataverseBaseUrl(value: unknown): string {
  const raw =
    readOptionalStringParam(value) ??
    readOptionalStringParam(process.env.DATAVERSE_BASE_URL) ??
    DEFAULT_DATAVERSE_BASE_URL
  return raw.replace(/\/+$/, '')
}

function resolveDataverseOwnerId(value: unknown): string {
  return (
    readOptionalStringParam(value) ??
    readOptionalStringParam(process.env.DATAVERSE_OWNER_ID) ??
    DEFAULT_DATAVERSE_OWNER_ID
  )
}

function resolveDataverseApiKey(value: unknown): string | undefined {
  return (
    readOptionalStringParam(value) ??
    readOptionalStringParam(process.env.DATAVERSE_API_KEY)
  )
}

function parseTimeoutMs(value: unknown, fallbackMs: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1000, Math.min(300000, Math.floor(value)))
  }
  return fallbackMs
}

function extractDataverseCrate(payload: unknown): RoCrate | undefined {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>
    if (Array.isArray(record['@graph'])) {
      try {
        return asRoCrate(record)
      } catch {
        // ignore
      }
    }
    const data = record.data
    if (
      data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      Array.isArray((data as Record<string, unknown>)['@graph'])
    ) {
      try {
        const nested = asRoCrate(data)
        return nested
      } catch {
        // ignore
      }
    }
  }
  return undefined
}

function extractArpPid(crate: RoCrate): string | undefined {
  const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
  const root = graph.find(
    (entity) =>
      !!entity &&
      typeof entity === 'object' &&
      !Array.isArray(entity) &&
      entity['@id'] === './',
  )
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    return undefined
  }
  const pid = root['@arpPid']
  return typeof pid === 'string' && pid.trim() !== '' ? pid.trim() : undefined
}

function buildDataverseDatasetUrl(baseUrl: string, pid?: string): string | undefined {
  if (!pid) {
    return undefined
  }
  return `${baseUrl}/dataset.xhtml?persistentId=${encodeURIComponent(pid)}#metadataMapTab`
}

function isSafeRelativePath(value: string): boolean {
  if (value === '') {
    return false
  }
  if (path.isAbsolute(value)) {
    return false
  }
  if (value.includes('\0')) {
    return false
  }
  const normalized = value.replace(/\\/g, '/')
  if (
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized === '..'
  ) {
    return false
  }
  return true
}

function extractCrateFilePaths(crate: RoCrate): string[] {
  const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
  const files = new Set<string>()
  for (const entity of graph) {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
      continue
    }
    const types = entityTypes(entity)
    if (!types.includes('File')) {
      continue
    }
    const id = typeof entity['@id'] === 'string' ? entity['@id'] : ''
    if (id === '') {
      continue
    }
    let rel = ''
    if (id.startsWith('file://./')) {
      rel = id.slice('file://./'.length)
    } else if (id.startsWith('./')) {
      rel = id.slice(2)
    } else {
      continue
    }
    if (isSafeRelativePath(rel)) {
      files.add(rel.replace(/\\/g, '/'))
    }
  }
  return Array.from(files).sort((a, b) => a.localeCompare(b))
}

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
}

const CRC32_TABLE = createCrc32Table()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    const index = (crc ^ buffer[i]) & 0xff
    crc = (CRC32_TABLE[index] ^ (crc >>> 8)) >>> 0
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date = new Date()): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear())
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const seconds = Math.floor(date.getSeconds() / 2)
  const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f)
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f)
  return { date: dosDate, time: dosTime }
}

function createStoredZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  const dt = dosDateTime()

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8')
    const data = entry.data
    const crc = crc32(data)
    const size = data.length >>> 0

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt16LE(dt.time, 10)
    localHeader.writeUInt16LE(dt.date, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(size, 18)
    localHeader.writeUInt32LE(size, 22)
    localHeader.writeUInt16LE(nameBuffer.length, 26)
    localHeader.writeUInt16LE(0, 28)

    localParts.push(localHeader, nameBuffer, data)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(0, 10)
    centralHeader.writeUInt16LE(dt.time, 12)
    centralHeader.writeUInt16LE(dt.date, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(size, 20)
    centralHeader.writeUInt32LE(size, 24)
    centralHeader.writeUInt16LE(nameBuffer.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset >>> 0, 42)
    centralParts.push(centralHeader, nameBuffer)

    offset += localHeader.length + nameBuffer.length + data.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const centralOffset = offset
  const centralSize = centralDirectory.length

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSize >>> 0, 12)
  eocd.writeUInt32LE(centralOffset >>> 0, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDirectory, eocd])
}

function buildDataverseUploadZip(
  crate: RoCrate,
  cratePath: string,
  indent: number,
): Buffer {
  const crateRoot = path.dirname(cratePath)
  const entries: Array<{ name: string; data: Buffer }> = []
  const metadataPayload = `${JSON.stringify(crate, null, indent)}\n`
  entries.push({
    name: 'ro-crate-metadata.json',
    data: Buffer.from(metadataPayload, 'utf8'),
  })

  for (const relativePath of extractCrateFilePaths(crate)) {
    if (relativePath === 'ro-crate-metadata.json') {
      continue
    }
    const fsPath = path.resolve(crateRoot, relativePath)
    const expectedPrefix = `${crateRoot}${path.sep}`
    if (fsPath !== crateRoot && !fsPath.startsWith(expectedPrefix)) {
      throw new Error(`Refusing to include path outside crate root: ${relativePath}`)
    }
    if (!fs.existsSync(fsPath)) {
      throw new Error(`Referenced file not found for ZIP upload: ${relativePath}`)
    }
    const stat = fs.statSync(fsPath)
    if (!stat.isFile()) {
      continue
    }
    entries.push({
      name: relativePath.replace(/\\/g, '/'),
      data: fs.readFileSync(fsPath),
    })
  }
  return createStoredZip(entries)
}

function parseDataverseUploadParams(
  params: Record<string, unknown>,
): DataverseUploadParams {
  if (params.write !== true) {
    throw new Error(
      'upload_rocrate_to_dataverse requires write=true. Use explicit write intent for upload operations.',
    )
  }
  const loaded = loadCrateFromParams(params)
  return {
    mode: loaded.mode,
    cratePath: loaded.cratePath,
    crate: loaded.crate,
    pid: readOptionalStringParam(params.pid),
    baseUrl: resolveDataverseBaseUrl(params.baseUrl),
    ownerId: resolveDataverseOwnerId(params.ownerId),
    apiKey: resolveDataverseApiKey(params.apiKey),
    timeoutMs: parseTimeoutMs(params.timeoutMs, 30000),
    responseMode: parseResponseMode(
      params,
      loaded.mode === 'remote' ? 'full' : 'summary',
    ),
    profileResolutionInputs: parseProfileResolutionInputs(params),
    indent:
      typeof params.indent === 'number' && Number.isFinite(params.indent)
        ? Math.max(0, Math.min(8, Math.floor(params.indent)))
        : 2,
  }
}

function parseDataverseDownloadParams(
  params: Record<string, unknown>,
): DataverseDownloadParams {
  const mode = parseAccessMode(params)
  const pid = readOptionalStringParam(params.pid)
  if (!pid) {
    throw new Error('download_rocrate_from_dataverse requires non-empty pid.')
  }
  const writeToDisk = mode === 'local' ? params.write === true : false
  if (mode === 'local' && !writeToDisk) {
    throw new Error(
      'download_rocrate_from_dataverse in local mode requires write=true to persist downloaded crate.',
    )
  }
  return {
    mode,
    cratePath: mode === 'local' ? ensureCratePath(params.cratePath) : undefined,
    pid,
    version: readOptionalStringParam(params.version),
    baseUrl: resolveDataverseBaseUrl(params.baseUrl),
    apiKey: resolveDataverseApiKey(params.apiKey),
    timeoutMs: parseTimeoutMs(params.timeoutMs, 30000),
    responseMode: parseResponseMode(params, mode === 'remote' ? 'full' : 'summary'),
    writeToDisk,
    indent:
      typeof params.indent === 'number' && Number.isFinite(params.indent)
        ? Math.max(0, Math.min(8, Math.floor(params.indent)))
        : 2,
  }
}

function tryParseJsonObjectFromString(
  value: string,
): Record<string, unknown> | undefined {
  const trimmed = value.trim()
  if (trimmed === '') {
    return undefined
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // fall through
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const slice = trimmed.slice(start, end + 1)
    try {
      const parsed = JSON.parse(slice) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // ignore
    }
  }
  return undefined
}

function extractDataverseValidationMessages(payload: unknown): string[] {
  const messages: string[] = []
  const collectIssues = (report: Record<string, unknown>): void => {
    const errors = Array.isArray(report.errors) ? report.errors : []
    for (const entry of errors) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue
      }
      const errorEntity =
        typeof (entry as Record<string, unknown>).errorEntity === 'string'
          ? ((entry as Record<string, unknown>).errorEntity as string)
          : 'RO-Crate'
      const nested = Array.isArray((entry as Record<string, unknown>).errors)
        ? ((entry as Record<string, unknown>).errors as unknown[])
        : []
      if (nested.length === 0) {
        continue
      }
      for (const nestedIssue of nested) {
        if (
          !nestedIssue ||
          typeof nestedIssue !== 'object' ||
          Array.isArray(nestedIssue)
        ) {
          continue
        }
        const errorField =
          typeof (nestedIssue as Record<string, unknown>).errorField === 'string'
            ? ((nestedIssue as Record<string, unknown>).errorField as string)
            : ''
        const errorMessage =
          typeof (nestedIssue as Record<string, unknown>).errorMessage === 'string'
            ? ((nestedIssue as Record<string, unknown>).errorMessage as string)
            : ''
        const errorSuggestion =
          typeof (nestedIssue as Record<string, unknown>).errorSuggestion === 'string'
            ? ((nestedIssue as Record<string, unknown>).errorSuggestion as string)
            : ''
        const prefix = `${errorEntity}${errorField ? `.${errorField}` : ''}`
        const body = [errorMessage, errorSuggestion]
          .filter((part) => part !== '')
          .join(' ')
        messages.push(`${prefix}: ${body}`.trim())
      }
    }
  }

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>
    const details = record.details
    if (details && typeof details === 'object' && !Array.isArray(details)) {
      collectIssues(details as Record<string, unknown>)
    } else if (typeof details === 'string') {
      const parsedDetails = tryParseJsonObjectFromString(details)
      if (parsedDetails) {
        collectIssues(parsedDetails)
      }
    }

    const message = record.message
    if (typeof message === 'string') {
      const parsedMessage = tryParseJsonObjectFromString(message)
      if (parsedMessage) {
        collectIssues(parsedMessage)
      }
    } else if (message && typeof message === 'object' && !Array.isArray(message)) {
      collectIssues(message as Record<string, unknown>)
    }
  }

  return uniqueStrings(messages.filter((item) => item.trim() !== ''))
}

async function validateRoCrateViaDataverse(
  crate: RoCrate,
  baseUrl: string,
  apiKey: string | undefined,
  timeoutMs: number,
): Promise<{
  ok: boolean
  status: number
  requestUrl: string
  messages: string[]
  payload: unknown
}> {
  const endpointUrl = new URL(DEFAULT_DATAVERSE_VALIDATE_PATH, `${baseUrl}/`)
  endpointUrl.searchParams.set('strict', 'true')
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    'user-agent': 'rocrate-mcp-server/0.0.0',
  }
  if (apiKey) {
    headers['x-dataverse-key'] = apiKey
  }
  const response = await fetchWithTimeout(endpointUrl.toString(), timeoutMs, {
    method: 'POST',
    headers,
    body: JSON.stringify(crate),
  })
  const payloadText = await response.text()
  let payload: unknown = payloadText
  try {
    payload = JSON.parse(payloadText) as unknown
  } catch {
    // keep text payload
  }
  const messages = extractDataverseValidationMessages(payload)
  return {
    ok: response.ok && messages.length === 0,
    status: response.status,
    requestUrl: response.url || endpointUrl.toString(),
    messages,
    payload,
  }
}

async function runDataverseUpload(
  params: DataverseUploadParams,
): Promise<Record<string, unknown>> {
  const creatingDataset = !params.pid
  const crateArpPid = extractArpPid(params.crate)
  if (creatingDataset && crateArpPid) {
    throw new Error(
      `Create upload blocked: crate already contains @arpPid (${crateArpPid}). Use update flow with pid, or remove @arpPid before creating a new dataset.`,
    )
  }
  if (!creatingDataset && params.pid && crateArpPid && crateArpPid !== params.pid) {
    throw new Error(
      `Update upload blocked: pid mismatch between request pid (${params.pid}) and crate @arpPid (${crateArpPid}).`,
    )
  }

  const coreReport = validateCrate(params.crate, { strict: true })
  if (!coreReport.valid || (coreReport.summary?.errors ?? 0) > 0) {
    throw new Error(
      `Upload blocked by strict core validation (${coreReport.summary.errors} errors, ${coreReport.summary.warnings} warnings).`,
    )
  }
  const constraints = ensureProfileConformanceOrThrow(
    params.crate,
    params.mode,
    params.profileResolutionInputs,
    {
      requiredMode: 'enforce_required',
    },
  )
  const contextSuggestion = buildContextTermSuggestion(params.crate, constraints)
  if (contextSuggestion.missingTerms.length > 0) {
    throw new Error(
      `Upload blocked by @context coverage. Missing mappings for used term(s): ${contextSuggestion.missingTerms.join(', ')}. Use suggest_context_terms and mergeContext before upload.`,
    )
  }
  const dataversePreflight = await validateRoCrateViaDataverse(
    params.crate,
    params.baseUrl,
    params.apiKey,
    params.timeoutMs,
  )
  if (!dataversePreflight.ok) {
    const issuesPreview = dataversePreflight.messages.slice(0, 10).join(' | ')
    throw new Error(
      `Upload blocked by Dataverse preflight validation (${dataversePreflight.status}) at ${dataversePreflight.requestUrl}${issuesPreview ? `: ${issuesPreview}` : ''}`,
    )
  }
  let endpoint: 'create' | 'update'
  let endpointUrl: URL
  let response: Response
  if (creatingDataset) {
    if (params.mode !== 'local' || !params.cratePath) {
      throw new Error(
        'Creating a new Dataverse dataset requires local mode so files can be zipped with ro-crate-metadata.json.',
      )
    }
    endpoint = 'create'
    endpointUrl = new URL('/api/arp/uploadRoCrateZip', `${params.baseUrl}/`)
    endpointUrl.searchParams.set('ownerId', params.ownerId)
    const zipBuffer = buildDataverseUploadZip(
      params.crate,
      params.cratePath,
      params.indent,
    )
    const form = new FormData()
    form.append('file', new Blob([zipBuffer], { type: 'application/zip' }), 'rocrate.zip')
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': 'rocrate-mcp-server/0.0.0',
    }
    if (params.apiKey) {
      headers['x-dataverse-key'] = params.apiKey
    }
    response = await fetchWithTimeout(endpointUrl.toString(), params.timeoutMs, {
      method: 'POST',
      headers,
      body: form,
    })
  } else {
    endpoint = 'update'
    endpointUrl = new URL(`/api/arp/rocrate/${params.pid}`, `${params.baseUrl}/`)
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'rocrate-mcp-server/0.0.0',
    }
    if (params.apiKey) {
      headers['x-dataverse-key'] = params.apiKey
    }
    response = await fetchWithTimeout(endpointUrl.toString(), params.timeoutMs, {
      method: 'POST',
      headers,
      body: JSON.stringify(params.crate),
    })
  }
  const payloadText = await response.text()
  let payload: unknown = payloadText
  try {
    payload = JSON.parse(payloadText) as unknown
  } catch {
    // keep text payload
  }
  if (!response.ok) {
    const preview = typeof payload === 'string' ? payload : payloadText
    throw new Error(
      `Dataverse upload failed (${response.status}): ${String(preview).slice(0, 300)}`,
    )
  }

  const ingestedCrate = extractDataverseCrate(payload)
  let payloadPid: string | undefined
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const payloadRecord = payload as Record<string, unknown>
    payloadPid = readOptionalStringParam(payloadRecord.pid)
    if (
      !payloadPid &&
      payloadRecord.data &&
      typeof payloadRecord.data === 'object' &&
      !Array.isArray(payloadRecord.data)
    ) {
      payloadPid = readOptionalStringParam(
        (payloadRecord.data as Record<string, unknown>).pid,
      )
    }
  }
  const resolvedPid =
    (ingestedCrate ? extractArpPid(ingestedCrate) : undefined) ?? payloadPid
  const dataverseUrl = buildDataverseDatasetUrl(params.baseUrl, resolvedPid)
  let writeApplied = false
  if (params.mode === 'local' && ingestedCrate && params.cratePath) {
    writeCrateAtomic(params.cratePath, ingestedCrate, params.indent)
    writeApplied = true
  }

  return {
    mode: params.mode,
    writeApplied,
    cratePath: params.cratePath,
    status: response.status,
    endpoint,
    requestUrl: response.url || endpointUrl.toString(),
    pid: resolvedPid ?? params.pid,
    dataverseUrl,
    ingestedCrate,
    response: payload,
    note:
      params.mode === 'remote'
        ? 'Remote mode does not persist files. Use returned ingestedCrate payload.'
        : undefined,
  }
}

async function runDataverseDownload(
  params: DataverseDownloadParams,
): Promise<Record<string, unknown>> {
  const endpointUrl = new URL(`/api/arp/rocrate/${params.pid}`, `${params.baseUrl}/`)
  if (params.version) {
    endpointUrl.searchParams.set('version', params.version)
  }
  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': 'rocrate-mcp-server/0.0.0',
  }
  if (params.apiKey) {
    headers['x-dataverse-key'] = params.apiKey
  }
  const response = await fetchWithTimeout(endpointUrl.toString(), params.timeoutMs, {
    method: 'GET',
    headers,
  })
  const payloadText = await response.text()
  let payload: unknown = payloadText
  try {
    payload = JSON.parse(payloadText) as unknown
  } catch {
    // keep text payload
  }
  if (!response.ok) {
    const preview = typeof payload === 'string' ? payload : payloadText
    throw new Error(
      `Dataverse download failed (${response.status}): ${String(preview).slice(0, 300)}`,
    )
  }
  const crate = extractDataverseCrate(payload)
  if (!crate) {
    throw new Error(
      'Dataverse download response did not contain a valid RO-Crate payload.',
    )
  }
  let writeApplied = false
  if (params.mode === 'local' && params.cratePath && params.writeToDisk) {
    writeCrateAtomic(params.cratePath, crate, params.indent)
    writeApplied = true
  }

  return {
    mode: params.mode,
    writeApplied,
    cratePath: params.cratePath,
    status: response.status,
    requestUrl: response.url || endpointUrl.toString(),
    pid: params.pid,
    version: params.version,
    crate,
    response: payload,
    note:
      params.mode === 'remote'
        ? 'Remote mode does not persist files. Use returned crate payload.'
        : undefined,
  }
}

function summarizeDataverseUploadPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const ingestedCrate =
    payload.ingestedCrate &&
    typeof payload.ingestedCrate === 'object' &&
    !Array.isArray(payload.ingestedCrate)
      ? (payload.ingestedCrate as RoCrate)
      : undefined
  return {
    mode: payload.mode,
    writeApplied: payload.writeApplied,
    cratePath: payload.cratePath,
    status: payload.status,
    endpoint: payload.endpoint,
    requestUrl: payload.requestUrl,
    pid: payload.pid,
    dataverseUrl: payload.dataverseUrl,
    ingestedCrateSummary: ingestedCrate
      ? summarizeCratePayload(
          ingestedCrate,
          (payload.mode === 'remote' ? 'remote' : 'local') as AccessMode,
          typeof payload.cratePath === 'string' ? payload.cratePath : undefined,
        )
      : null,
    note: payload.note,
  }
}

function summarizeDataverseDownloadPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const crate =
    payload.crate && typeof payload.crate === 'object' && !Array.isArray(payload.crate)
      ? (payload.crate as RoCrate)
      : undefined
  return {
    mode: payload.mode,
    writeApplied: payload.writeApplied,
    cratePath: payload.cratePath,
    status: payload.status,
    requestUrl: payload.requestUrl,
    pid: payload.pid,
    version: payload.version,
    crateSummary: crate
      ? summarizeCratePayload(
          crate,
          (payload.mode === 'remote' ? 'remote' : 'local') as AccessMode,
          typeof payload.cratePath === 'string' ? payload.cratePath : undefined,
        )
      : null,
    note: payload.note,
  }
}

async function runDownloadUrl(params: DownloadUrlParams): Promise<unknown> {
  const response = await fetchTextWithTimeout(params.url, params.timeoutMs)
  if (!response.ok) {
    throw new Error(`Failed to fetch page (${response.status} ${response.statusText})`)
  }
  const responseUrl = response.url || params.url
  const contentType = response.headers.get('content-type') || ''
  const fullText = await response.text()
  const truncated = fullText.length > params.maxChars
  const text = truncated ? fullText.slice(0, params.maxChars) : fullText
  const content = params.rawHtml ? text : htmlToText(text)
  return {
    url: responseUrl,
    status: response.status,
    contentType,
    rawHtml: params.rawHtml,
    truncated,
    content,
  }
}

async function handleToolCall(
  toolName: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (toolName === 'search') {
    const searchParams = parseWebSearchParams(params)
    const result = await runWebSearch(searchParams)
    return textResult(result)
  }

  if (toolName === 'download_url') {
    const downloadParams = parseDownloadUrlParams(params)
    const result = await runDownloadUrl(downloadParams)
    return textResult(result)
  }

  if (toolName === 'upload_rocrate_to_dataverse') {
    const uploadParams = parseDataverseUploadParams(params)
    const payload = await runDataverseUpload(uploadParams)
    if (uploadParams.responseMode === 'full') {
      return textResult(payload)
    }
    return textResult(summarizeDataverseUploadPayload(payload))
  }

  if (toolName === 'download_rocrate_from_dataverse') {
    const downloadParams = parseDataverseDownloadParams(params)
    const payload = await runDataverseDownload(downloadParams)
    if (downloadParams.responseMode === 'full') {
      return textResult(payload)
    }
    return textResult(summarizeDataverseDownloadPayload(payload))
  }

  if (toolName === 'read_crate') {
    const loaded = loadCrateFromParams(params)
    const responseMode = parseResponseMode(
      params,
      loaded.mode === 'remote' ? 'full' : 'summary',
    )
    if (responseMode === 'full') {
      return textResult(loaded.crate)
    }
    return textResult(summarizeCratePayload(loaded.crate, loaded.mode, loaded.cratePath))
  }

  if (toolName === 'compute_delta') {
    const loaded = loadCrateFromParams(params)
    const includeHidden = params.includeHidden === true
    let delta: unknown
    if (loaded.mode === 'local') {
      const rootPath =
        typeof params.rootPath === 'string' && params.rootPath.trim() !== ''
          ? path.resolve(params.rootPath)
          : path.dirname(loaded.cratePath ?? resolveCratePath())
      delta = computeDelta(loaded.crate, rootPath, { includeHidden })
    } else {
      const workspaceEntries = Array.isArray(params.workspaceEntries)
        ? params.workspaceEntries.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : []
      if (workspaceEntries.length === 0) {
        throw new Error(
          'remote compute_delta requires workspaceEntries array of relative paths.',
        )
      }
      delta = computeRemoteDeltaWithWorkspaceEntries(
        loaded.crate,
        workspaceEntries,
        includeHidden,
      )
    }
    return textResult(delta)
  }

  if (toolName === 'apply_changes') {
    if (params.write !== true) {
      throw new Error(
        'apply_changes requires write=true. Use explicit write intent for all apply_changes calls.',
      )
    }
    const loaded = loadCrateFromParams(params)
    const resolutionInputs = parseProfileResolutionInputs(params)
    const profileRequiredMode = parseProfileRequiredMode(params, 'allow_missing')
    const contextMode = parseContextMode(params, 'auto_reconcile')
    const normalizedChangeSet = normalizeChangeSet(params.changeSet)
    const changed = applyChangeSet(loaded.crate, normalizedChangeSet)
    const responseMode = parseResponseMode(
      params,
      loaded.mode === 'remote' ? 'full' : 'summary',
    )
    const preConstraints = buildProfileConstraints(changed, loaded.mode, resolutionInputs)
    const contextPatched = applyContextModePatch(changed, preConstraints, contextMode)
    const updated = contextPatched.crate
    const constraints = ensureProfileConformanceOrThrow(
      updated,
      loaded.mode,
      resolutionInputs,
      {
        requiredMode: profileRequiredMode,
      },
    )
    const allowOutOfProfileTargets = params.allowOutOfProfileTargets === true
    const outOfScopeViolations = validateProfileTargetScopeForChangeSet(
      updated,
      normalizedChangeSet,
      constraints,
    )
    if (!allowOutOfProfileTargets && outOfScopeViolations.length > 0) {
      const message = outOfScopeViolations
        .map((violation) => `${violation.entityId} [${violation.properties.join(', ')}]`)
        .join(' | ')
      throw new Error(
        `Profile-scoped update includes entities without matching conformsTo: ${message}. Ask user confirmation before broad updates, then retry with allowOutOfProfileTargets=true.`,
      )
    }
    if (loaded.mode === 'local') {
      const indent = typeof params.indent === 'number' ? params.indent : 2
      writeCrateAtomic(loaded.cratePath ?? resolveCratePath(), updated, indent)
      const payload = {
        crate: updated,
        mode: loaded.mode,
        writeApplied: true,
        cratePath: loaded.cratePath ?? resolveCratePath(),
        profileRequiredMode,
        contextMode,
        contextPatchReport: contextPatched.report,
        profileResolution: constraints.resolution,
      }
      if (responseMode === 'full') {
        return textResult(payload)
      }
      return textResult(
        summarizeApplyChangesPayload(payload, updated, normalizedChangeSet, constraints),
      )
    }
    if (loaded.mode === 'remote') {
      const payload = {
        crate: updated,
        writeApplied: false,
        mode: 'remote',
        profileRequiredMode,
        contextMode,
        contextPatchReport: contextPatched.report,
        profileResolution: constraints.resolution,
        note: 'Remote mode does not persist files. Use returned crate payload.',
      }
      if (responseMode === 'full') {
        return textResult(payload)
      }
      return textResult(
        summarizeApplyChangesPayload(payload, updated, normalizedChangeSet, constraints),
      )
    }
    throw new Error(`Unsupported mode for apply_changes: ${loaded.mode}`)
  }

  if (toolName === 'add_profile_conforms_to') {
    if (params.write !== true) {
      throw new Error(
        'add_profile_conforms_to requires write=true. Use explicit write intent for all write operations.',
      )
    }
    const loaded = loadCrateFromParams(params)
    const entityId =
      typeof params.entityId === 'string' && params.entityId.trim() !== ''
        ? params.entityId.trim()
        : './'
    const profileUrls = readProfileUrlsToAttach(params)
    if (profileUrls.length === 0) {
      throw new Error('add_profile_conforms_to requires profileUrl or profileUrls.')
    }

    const { previousUrls, addedUrls, finalUrls } = addProfileConformsTo(
      loaded.crate,
      entityId,
      profileUrls,
    )
    const responseMode = parseResponseMode(
      params,
      loaded.mode === 'remote' ? 'full' : 'summary',
    )

    if (loaded.mode === 'local') {
      const cratePath = loaded.cratePath ?? resolveCratePath()
      const indent = typeof params.indent === 'number' ? params.indent : 2
      writeCrateAtomic(cratePath, loaded.crate, indent)
      const payload = {
        mode: 'local',
        writeApplied: true,
        cratePath,
        entityId,
        requestedProfileUrls: profileUrls,
        previousProfileUrls: previousUrls,
        addedProfileUrls: addedUrls,
        finalProfileUrls: finalUrls,
        crate: loaded.crate,
      }
      if (responseMode === 'full') {
        return textResult(payload)
      }
      return textResult({
        mode: payload.mode,
        writeApplied: payload.writeApplied,
        cratePath: payload.cratePath,
        entityId: payload.entityId,
        requestedProfileUrls: payload.requestedProfileUrls,
        previousProfileUrls: payload.previousProfileUrls,
        addedProfileUrls: payload.addedProfileUrls,
        finalProfileUrls: payload.finalProfileUrls,
      })
    }

    if (loaded.mode === 'remote') {
      const payload = {
        mode: 'remote',
        writeApplied: false,
        entityId,
        requestedProfileUrls: profileUrls,
        previousProfileUrls: previousUrls,
        addedProfileUrls: addedUrls,
        finalProfileUrls: finalUrls,
        crate: loaded.crate,
        note: 'Remote mode does not persist files. Use returned crate payload.',
      }
      if (responseMode === 'full') {
        return textResult(payload)
      }
      return textResult({
        mode: payload.mode,
        writeApplied: payload.writeApplied,
        entityId: payload.entityId,
        requestedProfileUrls: payload.requestedProfileUrls,
        previousProfileUrls: payload.previousProfileUrls,
        addedProfileUrls: payload.addedProfileUrls,
        finalProfileUrls: payload.finalProfileUrls,
        note: payload.note,
      })
    }

    throw new Error(`Unsupported mode for add_profile_conforms_to: ${loaded.mode}`)
  }

  if (toolName === 'validate_crate') {
    const loaded = loadCrateFromParams(params)
    const resolutionInputs = parseProfileResolutionInputs(params)
    const strict = params.strict === true
    const profileRequiredMode = parseProfileRequiredMode(
      params,
      strict ? 'enforce_required' : 'allow_missing',
    )
    const report = validateCrate(loaded.crate, { strict })
    const constraints = buildProfileConstraints(
      loaded.crate,
      loaded.mode,
      resolutionInputs,
    )
    const profileValidation = validateCrateAgainstProfileConstraints(
      loaded.crate,
      constraints,
      {
        requiredMode: profileRequiredMode,
      },
    )
    const payload = {
      ...report,
      profile: {
        valid: profileValidation.valid,
        errors: profileValidation.errors,
        warnings: profileValidation.warnings,
        requiredMode: profileRequiredMode,
        resolution: constraints.resolution,
      },
    }
    const responseMode = parseResponseMode(params, 'summary')
    if (responseMode === 'full') {
      return textResult(payload)
    }
    return textResult(summarizeValidationPayload(payload))
  }

  if (toolName === 'write_crate_atomic') {
    const mode = parseAccessMode(params)
    const responseMode = parseResponseMode(params, mode === 'remote' ? 'full' : 'summary')
    const resolutionInputs = parseProfileResolutionInputs(params)
    const profileRequiredMode = parseProfileRequiredMode(params, 'allow_missing')
    const crateParam = params.crate
    if (!crateParam || typeof crateParam !== 'object' || Array.isArray(crateParam)) {
      throw new Error('write_crate_atomic requires crate object.')
    }
    const crate = asRoCrate(crateParam)
    const constraints = ensureProfileConformanceOrThrow(
      crate,
      mode,
      resolutionInputs,
      {
        requiredMode: profileRequiredMode,
      },
    )
    if (mode === 'remote') {
      const payload = {
        ok: true,
        mode: 'remote',
        writeApplied: false,
        crate,
        profileRequiredMode,
        profileResolution: constraints.resolution,
        note: 'Remote mode does not persist files. Use returned crate payload.',
      }
      if (responseMode === 'full') {
        return textResult(payload)
      }
      return textResult({
        ok: true,
        mode: payload.mode,
        writeApplied: payload.writeApplied,
        profileRequiredMode: payload.profileRequiredMode,
        profileResolution: summarizeProfileResolution(constraints.resolution),
        crateSummary: summarizeCratePayload(crate, mode),
        note: payload.note,
      })
    }
    const cratePath = ensureCratePath(params.cratePath)
    const indent = typeof params.indent === 'number' ? params.indent : 2
    writeCrateAtomic(cratePath, crate, indent)
    const payload = {
      ok: true,
      mode: 'local',
      writeApplied: true,
      cratePath,
      profileRequiredMode,
      profileResolution: constraints.resolution,
    }
    if (responseMode === 'full') {
      return textResult(payload)
    }
    return textResult({
      ok: payload.ok,
      mode: payload.mode,
      writeApplied: payload.writeApplied,
      cratePath: payload.cratePath,
      profileRequiredMode: payload.profileRequiredMode,
      profileResolution: summarizeProfileResolution(constraints.resolution),
      crateSummary: summarizeCratePayload(crate, mode, cratePath),
    })
  }

  if (toolName === 'get_rocrate_context') {
    const loaded = loadCrateFromParams(params)
    const resolutionInputs = parseProfileResolutionInputs(params)
    const context = buildRoCrateContext(
      loaded.crate,
      loaded.mode,
      loaded.cratePath,
      resolutionInputs,
    )
    const responseMode = parseResponseMode(params, 'summary')
    if (responseMode === 'full') {
      return textResult(context)
    }
    return textResult(summarizeRoCrateContext(context))
  }

  if (toolName === 'suggest_context_terms') {
    const loaded = loadCrateFromParams(params)
    const resolutionInputs = parseProfileResolutionInputs(params)
    const constraints = buildProfileConstraints(
      loaded.crate,
      loaded.mode,
      resolutionInputs,
    )
    const suggestion = buildContextTermSuggestion(loaded.crate, constraints)
    const payload = {
      mode: loaded.mode,
      cratePath: loaded.cratePath,
      profileResolution: summarizeProfileResolution(constraints.resolution),
      mergeContext: suggestion.mergeContext,
      missingTerms: suggestion.missingTerms,
      unknownTerms: suggestion.unknownTerms,
      usedTerms: suggestion.usedTerms,
      declaredTerms: suggestion.declaredTerms,
      note: 'Merge mergeContext into top-level @context alongside the default RO-Crate context URL.',
    }
    const responseMode = parseResponseMode(
      params,
      loaded.mode === 'remote' ? 'full' : 'summary',
    )
    if (responseMode === 'full') {
      return textResult(payload)
    }
    return textResult({
      mode: payload.mode,
      cratePath: payload.cratePath,
      profileResolution: payload.profileResolution,
      mergeContext: payload.mergeContext,
      missingTerms: payload.missingTerms,
      unknownTerms: payload.unknownTerms,
      note: payload.note,
    })
  }

  if (toolName === 'resolve_profile_schema') {
    const profileUrl =
      typeof params.profileUrl === 'string' ? params.profileUrl.trim() : ''
    if (profileUrl === '') {
      throw new Error('resolve_profile_schema requires profileUrl.')
    }
    const mode = parseAccessMode(params)
    const includeProfileContent = params.includeProfileContent === true
    const resolutionInputs = parseProfileResolutionInputs(params)
    return textResult(
      resolveProfileUrls([profileUrl], mode, includeProfileContent, resolutionInputs),
    )
  }

  if (toolName === 'prepare_remote_profile_payload') {
    return textResult(prepareRemoteProfilePayload(params))
  }

  if (toolName === 'create_profile_context') {
    return textResult(createProfileContext(params))
  }

  if (toolName === 'get_profile_context_info') {
    return textResult(getProfileContextInfo(params))
  }

  if (toolName === 'delete_profile_context') {
    return textResult(deleteProfileContext(params))
  }

  throw new Error(`Unknown tool: ${toolName}`)
}

async function handleRequest(
  request: JsonRpcRequest,
  mode: TransportMode,
): Promise<void> {
  const id = request.id ?? null
  try {
    if (request.method === 'initialize') {
      const params = asRecord(request.params)
      const requestedProtocolVersion =
        typeof params.protocolVersion === 'string'
          ? params.protocolVersion
          : PROTOCOL_VERSION
      writeResult(mode, id, {
        protocolVersion: requestedProtocolVersion,
        serverInfo: {
          name: 'rocrate-mcp-server',
          version: '0.0.0',
        },
        instructions:
          'Primary artifact is ro-crate-metadata.json. Prefer RO-Crate tools over ad-hoc edits. Use add_profile_conforms_to to activate profile URLs on conformsTo before profile-field edits. Treat profile scope as entity-local (only entities explicitly declaring that profile URL in conformsTo). Do not fan out profile-field edits by class unless user explicitly asks. Detect profile URLs from conformsTo on Dataset/File entities, resolve them via metadata-schema-index, and keep edits limited to profile-allowed entity types/properties.',
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
      })
      return
    }

    if (request.method === 'notifications/initialized') {
      if (request.id !== undefined) {
        writeResult(mode, id, {})
      }
      return
    }
    if (request.method === 'initialized') {
      if (request.id !== undefined) {
        writeResult(mode, id, {})
      }
      return
    }

    if (request.method === 'ping') {
      writeResult(mode, id, {})
      return
    }

    if (request.method === 'tools/list') {
      writeResult(mode, id, { tools })
      return
    }

    if (request.method === 'tools/call') {
      const params = asRecord(request.params)
      const toolName = params.name
      if (typeof toolName !== 'string' || toolName.trim() === '') {
        writeError(mode, id, -32602, 'tools/call requires a tool name.')
        return
      }
      const args = asRecord(params.arguments)
      const result = await handleToolCall(toolName, args)
      writeResult(mode, id, result)
      return
    }

    writeError(mode, id, -32601, `Method not found: ${request.method}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeError(mode, id, -32000, message)
  }
}

function parseJsonMessage(payload: string): JsonRpcRequest | undefined {
  const trimmed = payload.trim()
  if (trimmed === '') {
    return undefined
  }
  const parsed = JSON.parse(trimmed) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined
  }
  const candidate = parsed as JsonRpcRequest
  if (candidate.jsonrpc !== '2.0' || typeof candidate.method !== 'string') {
    return undefined
  }
  return candidate
}

function startServer(): void {
  let buffer = Buffer.alloc(0)
  process.stdin.resume()
  process.stderr.write('rocrate-mcp-server: started (stdio)\n')

  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])

    while (buffer.length > 0) {
      const headerTerminator = findHeaderTerminator(buffer)
      if (headerTerminator) {
        const headerText = buffer.subarray(0, headerTerminator.index).toString('utf8')
        const contentLengthMatch = headerText.match(/Content-Length:\s*(\d+)/i)
        if (!contentLengthMatch) {
          buffer = buffer.subarray(headerTerminator.index + headerTerminator.size)
          continue
        }
        const contentLength = Number(contentLengthMatch[1])
        const bodyStart = headerTerminator.index + headerTerminator.size
        const totalLength = bodyStart + contentLength
        if (buffer.length < totalLength) {
          break
        }
        const body = buffer.subarray(bodyStart, totalLength).toString('utf8')
        buffer = buffer.subarray(totalLength)
        const request = parseJsonMessage(body)
        if (request) {
          process.stderr.write(`rocrate-mcp-server: request ${request.method}\n`)
          void handleRequest(request, 'content-length')
        }
        continue
      }

      // Fallback: support newline-delimited JSON-RPC (some clients use plain JSON per line).
      // Only attempt this when payload appears to start with a JSON object/array.
      const preview = buffer.toString('utf8', 0, Math.min(buffer.length, 64)).trimStart()
      const looksLikeJsonLine = preview.startsWith('{') || preview.startsWith('[')
      if (!looksLikeJsonLine) {
        // Wait for more data (likely an incomplete header).
        break
      }

      const newlineIndex = buffer.indexOf(0x0a)
      if (newlineIndex < 0) {
        // Wait until we have a complete line.
        break
      }

      const lineBuffer = buffer.subarray(0, newlineIndex)
      buffer = buffer.subarray(newlineIndex + 1)
      const line = lineBuffer.toString('utf8').trim()
      if (line === '') {
        continue
      }
      try {
        const request = parseJsonMessage(line)
        if (request) {
          process.stderr.write(`rocrate-mcp-server: request ${request.method}\n`)
          void handleRequest(request, 'jsonl')
        }
      } catch {
        // Put data back and wait for more bytes if JSON might be incomplete.
        buffer = Buffer.concat([lineBuffer, Buffer.from('\n', 'utf8'), buffer])
        break
      }
    }
  })
}

startServer()

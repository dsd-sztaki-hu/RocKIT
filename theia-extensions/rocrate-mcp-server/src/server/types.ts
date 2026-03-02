import type { RoCrate } from '../core/types'

export type ToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type TransportMode = 'content-length' | 'jsonl'
export type AccessMode = 'local' | 'remote'
export type ProfileRequiredMode = 'allow_missing' | 'enforce_required'
export type ResponseMode = 'summary' | 'full'
export type ContextMode = 'strict' | 'auto_add' | 'auto_reconcile'

export type SchemaIndexProfile = {
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

export type SchemaIndexDocument = {
  profiles: SchemaIndexProfile[]
  conformsToIndex: Record<string, string[]>
}

export type ResolvedProfile = {
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

export type ProfileResolution = {
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

export type ProfileConstraints = {
  resolution: ProfileResolution
  rulesByProfileUrl: Map<string, ProfileRuleSet>
  allowedClasses: Set<string>
  allowedPropertiesByClass: Map<string, Set<string>>
  requiredPropertiesByClass: Map<string, Set<string>>
}

export type ProfileRuleSet = {
  allowedClasses: Set<string>
  allowedPropertiesByClass: Map<string, Set<string>>
  requiredPropertiesByClass: Map<string, Set<string>>
}

export type ProfileTermIriResolution = {
  termToIri: Record<string, string>
  ambiguousTerms: string[]
}

export type ContextAutoPatchReport = {
  mode: ContextMode
  addedTerms: string[]
  reconciledTerms: Array<{ term: string; from: string; to: string }>
  skippedConflicts: Array<{ term: string; from: string; expected: string }>
  ambiguousTerms: string[]
}

export type ProfileValidationOptions = {
  requiredMode: ProfileRequiredMode
}

export type ProfileResolutionInputs = {
  profileContextId?: string
  schemaIndex?: SchemaIndexDocument
  profileContents?: Record<string, Record<string, unknown>>
}

export type ProfileContextRecord = {
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

export type WebSearchParams = {
  query: string
  maxResults: number
  includeRawContent: boolean
  searchDepth: 'basic' | 'advanced'
  apiKey?: string
}

export type DownloadUrlParams = {
  url: string
  rawHtml: boolean
  timeoutMs: number
  maxChars: number
}

export type McpToolTextResult = {
  content: Array<{ type: 'text'; text: string }>
}

export type DataverseUploadParams = {
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

export type DataverseDownloadParams = {
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

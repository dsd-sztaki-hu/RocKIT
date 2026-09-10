import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Readable } from 'node:stream'
import { validateCrate } from '../core'
import type { RoCrate, RoCrateEntity } from '../core/types'
import { getRuntimeEnvValue } from './runtime-config'
import type {
  DataverseDownloadParams,
  DataverseUploadParams,
  ProfileResolutionInputs,
} from './types'
import { getServerUserAgent } from './version'

type DataverseDeps = {
  defaultBaseUrl: string
  defaultOwnerId: string
  defaultValidatePath: string
  rocrateConformsToUrl: string
  externalContextCoverageUrls: Set<string>
  loadCrateFromParams: (params: Record<string, unknown>) => {
    mode: 'local' | 'remote'
    cratePath?: string
    crate: RoCrate
  }
  parseAccessMode: (params: Record<string, unknown>) => 'local' | 'remote'
  ensureCratePath: (inputPath?: unknown) => string
  parseResponseMode: (
    params: Record<string, unknown>,
    defaultMode?: 'summary' | 'full',
  ) => 'summary' | 'full'
  parseProfileResolutionInputs: (
    params: Record<string, unknown>,
  ) => ProfileResolutionInputs
  writeCrateAtomic: (cratePath: string, crate: RoCrate, indent: number) => void
  ensureProfileConformanceOrThrow: (
    crate: RoCrate,
    mode: 'local' | 'remote',
    resolutionInputs: unknown,
    options: { requiredMode: 'allow_missing' | 'enforce_required' },
  ) => unknown
  buildContextTermSuggestion: (
    crate: RoCrate,
    constraints?: unknown,
  ) => { missingTerms: string[] }
  uniqueStrings: (values: string[]) => string[]
  getTelemetryCollector: () => {
    getCurrentToolCallId: () => string | undefined
    addToolCallArtifact?: (
      toolCallId: string,
      artifact: {
        label: string
        path: string
      },
    ) => void
    appendToolCallHttpLog: (
      toolCallId: string,
      log: {
        timestamp: string
        dependency: string
        request: {
          method: string
          url: string
          headers?: Record<string, string>
          body?: string
        }
        response?: {
          status: number
          ok: boolean
          url: string
          headers?: Record<string, string>
          body?: string
        }
        error?: string
      },
    ) => void
    recordDependencyCall: (
      dependency: string,
      success: boolean,
      latencyMs: number,
    ) => void
  } | null
}

type PendingDataverseCrate = {
  id: string
  tempPath: string
  cratePath?: string
  pid?: string
  dataverseUrl?: string
  createdAt: string
  expiresAt: string
  indent: number
}

type DataverseValidationIssue = {
  entity: string
  field?: string
  message: string
  suggestion?: string
}

type DataversePreflightValidationErrorOptions = {
  status: number
  requestUrl: string
  cratePath?: string
  validationIssues: DataverseValidationIssue[]
  validationErrors: string[]
  validationResponse: unknown
}

type DataverseAuthenticationErrorOptions = {
  status: number
  requestUrl: string
  cratePath?: string
  apiKeyProvided: boolean
  dataverseResponse: unknown
  dashboardUrl: string
}

/**
 * Represents a Dataverse validation rejection that should remain available to
 * the agent as a structured MCP tool error instead of becoming a generic
 * JSON-RPC exception.
 */
export class DataversePreflightValidationError extends Error {
  readonly status: number
  readonly requestUrl: string
  readonly cratePath?: string
  readonly validationIssues: DataverseValidationIssue[]
  readonly validationErrors: string[]
  readonly validationResponse: unknown

  constructor(options: DataversePreflightValidationErrorOptions) {
    const issuePreview = options.validationErrors.slice(0, 10).join(' | ')
    super(
      `Upload blocked by Dataverse preflight validation (${options.status}) at ${options.requestUrl}${issuePreview ? `: ${issuePreview}` : ''}`,
    )
    this.name = 'DataversePreflightValidationError'
    this.status = options.status
    this.requestUrl = options.requestUrl
    this.cratePath = options.cratePath
    this.validationIssues = options.validationIssues
    this.validationErrors = options.validationErrors
    this.validationResponse = options.validationResponse
    Object.setPrototypeOf(this, new.target.prototype)
  }

  /**
   * Converts the validation rejection into a model-readable MCP tool result.
   */
  toMcpPayload(): Record<string, unknown> {
    return {
      ok: false,
      errorCode: 'DATAVERSE_PREFLIGHT_VALIDATION',
      stage: 'dataverse_preflight',
      message: this.message,
      status: this.status,
      requestUrl: this.requestUrl,
      cratePath: this.cratePath,
      validationErrors: this.validationErrors,
      validationIssues: this.validationIssues,
      validationResponse: this.validationResponse,
      uploadPerformed: false,
      retryable: true,
      nextAction:
        'Use validationIssues and validationResponse to correct the RO-Crate at cratePath, run validate_crate again, and retry upload_rocrate_to_dataverse. Do not retry unchanged metadata.',
    }
  }
}

/**
 * Represents a Dataverse authentication rejection that should tell the agent
 * exactly how to provide or replace the missing credential.
 */
export class DataverseAuthenticationError extends Error {
  readonly status: number
  readonly requestUrl: string
  readonly cratePath?: string
  readonly apiKeyProvided: boolean
  readonly dataverseResponse: unknown
  readonly dashboardUrl: string
  private preservedZipPath?: string

  constructor(options: DataverseAuthenticationErrorOptions) {
    const credentialMessage = options.apiKeyProvided
      ? 'the configured Dataverse API key was rejected or does not have permission'
      : 'no DATAVERSE_API_KEY was provided'
    super(
      `Dataverse rejected the upload request (${options.status}) at ${options.requestUrl}: ${credentialMessage}.`,
    )
    this.name = 'DataverseAuthenticationError'
    this.status = options.status
    this.requestUrl = options.requestUrl
    this.cratePath = options.cratePath
    this.apiKeyProvided = options.apiKeyProvided
    this.dataverseResponse = options.dataverseResponse
    this.dashboardUrl = options.dashboardUrl
    Object.setPrototypeOf(this, new.target.prototype)
  }

  /**
   * Keeps the generated ZIP available when authentication fails after it was
   * created, so the agent or user can inspect or retry it.
   */
  setPreservedZipPath(zipPath: string): void {
    this.preservedZipPath = zipPath
  }

  /**
   * Converts the authentication rejection into a model-readable MCP result.
   */
  toMcpPayload(): Record<string, unknown> {
    const dashboardLocation =
      'Settings → Dataverse Upload Tool → DATAVERSE_API_KEY'
    const credentialAction = this.apiKeyProvided
      ? 'Replace or correct the current Dataverse API key'
      : 'Provide a Dataverse API key'
    const zipNotice = this.preservedZipPath
      ? ` The generated ZIP was preserved at ${this.preservedZipPath}.`
      : ''
    return {
      ok: false,
      errorCode: this.apiKeyProvided
        ? 'DATAVERSE_AUTHENTICATION_FAILED'
        : 'DATAVERSE_API_KEY_REQUIRED',
      stage: 'dataverse_authentication',
      message: this.message,
      status: this.status,
      requestUrl: this.requestUrl,
      cratePath: this.cratePath,
      apiKeyProvided: this.apiKeyProvided,
      dataverseResponse: this.dataverseResponse,
      dashboardUrl: this.dashboardUrl,
      credential: {
        name: 'DATAVERSE_API_KEY',
        environmentVariable: 'DATAVERSE_API_KEY',
        dashboardUrl: this.dashboardUrl,
        dashboardLocation,
        toolParameter: 'apiKey',
      },
      uploadPerformed: false,
      retryable: true,
      ...(this.preservedZipPath
        ? { zipPath: this.preservedZipPath, zipPreserved: true }
        : { zipPreserved: false }),
      nextAction:
        `${credentialAction} using one of these supported methods: set DATAVERSE_API_KEY in the MCP process environment; enter it in the MCP dashboard at ${this.dashboardUrl} under ${dashboardLocation}; or ask the user to provide it and pass it as the upload_rocrate_to_dataverse apiKey argument. Then retry upload_rocrate_to_dataverse.${zipNotice}`,
    }
  }
}

function isDataverseAuthenticationStatus(status: number): boolean {
  return status === 401 || status === 403
}

function hasDataverseApiKey(apiKey: string | undefined): boolean {
  return typeof apiKey === 'string' && apiKey.trim() !== ''
}

function getDashboardUrlForUser(): string {
  const configuredHost = process.env.ROCRATE_DASHBOARD_HOST?.trim() || '127.0.0.1'
  const host =
    configuredHost === '0.0.0.0' || configuredHost === '::'
      ? '127.0.0.1'
      : configuredHost
  const formattedHost =
    host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  const port = process.env.ROCRATE_DASHBOARD_PORT?.trim() || '9393'
  return `http://${formattedHost}:${port}`
}

/**
 * Builds Dataverse upload/download/validation handlers and parameter parsers.
 */
export function createDataverseHandlers(deps: DataverseDeps) {
  const DATAVERSE_UPLOAD_TMP_PREFIX = 'rocrate-dataverse-upload-'
  const DATAVERSE_PENDING_TMP_PREFIX = 'rocrate-dataverse-updated-'
  const REDACTED_HEADER_VALUE = '[REDACTED]'
  const pendingDataverseCrates = new Map<string, PendingDataverseCrate>()
  const DATAVERSE_FILE_CONTEXT: Record<string, string> = {
    contentSize: 'https://schema.org/contentSize',
    directoryLabel: 'https://dataverse.org/schema/file/directoryLabel',
    encodingFormat: 'https://schema.org/encodingFormat',
    hash: 'https://dataverse.org/schema/file/hash',
  }

  /**
   * Handles extract conformsTo urls.
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
   * Handles collect context urls.
   */
  function collectContextUrls(crate: RoCrate): Set<string> {
    const urls = new Set<string>()
    const context = crate['@context']
    const collect = (value: unknown): void => {
      if (typeof value === 'string' && value.trim() !== '') {
        urls.add(value.trim())
      }
    }
    if (Array.isArray(context)) {
      for (const item of context) {
        collect(item)
      }
      return urls
    }
    collect(context)
    return urls
  }

  /**
   * Handles has external context coverage.
   */
  function hasExternalContextCoverage(crate: RoCrate): boolean {
    const contextUrls = collectContextUrls(crate)
    for (const url of contextUrls) {
      if (deps.externalContextCoverageUrls.has(url)) {
        return true
      }
    }
    return false
  }

  /**
   * Handles collect term usage profile scope.
   */
  function collectTermUsageProfileScope(
    crate: RoCrate,
  ): Map<string, { profiled: boolean; unprofiled: boolean }> {
    const usage = new Map<string, { profiled: boolean; unprofiled: boolean }>()
    const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
    for (const entity of graph) {
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
        continue
      }
      const types = entityTypes(entity)
      const isDatasetOrFile = types.includes('Dataset') || types.includes('File')
      if (!isDatasetOrFile) {
        continue
      }
      const profileUrls = extractConformsToUrls(entity.conformsTo).filter(
        (url) => url !== deps.rocrateConformsToUrl,
      )
      const scope: 'profiled' | 'unprofiled' =
        profileUrls.length > 0 ? 'profiled' : 'unprofiled'
      for (const key of Object.keys(entity)) {
        if (key.startsWith('@')) {
          continue
        }
        const current = usage.get(key) ?? { profiled: false, unprofiled: false }
        if (scope === 'profiled') {
          current.profiled = true
        } else {
          current.unprofiled = true
        }
        usage.set(key, current)
      }
    }
    return usage
  }

  /**
   * Handles read optional string param.
   */
  function readOptionalStringParam(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined
    }
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
  }

  /**
   * Handles resolve dataverse base url.
   */
  function resolveDataverseBaseUrl(value: unknown): string {
    const raw =
      readOptionalStringParam(value) ??
      getRuntimeEnvValue('DATAVERSE_BASE_URL') ??
      deps.defaultBaseUrl
    return raw.replace(/\/+$/, '')
  }

  /**
   * Handles resolve dataverse owner id.
   */
  function resolveDataverseOwnerId(value: unknown): string {
    return (
      readOptionalStringParam(value) ??
      readOptionalStringParam(process.env.DATAVERSE_OWNER_ID) ??
      deps.defaultOwnerId
    )
  }

  /**
   * Handles resolve dataverse api key.
   */
  function resolveDataverseApiKey(value: unknown): string | undefined {
    return (
      readOptionalStringParam(value) ??
      getRuntimeEnvValue('DATAVERSE_API_KEY')
    )
  }

  /**
   * Handles parse timeout ms.
   */
  function parseTimeoutMs(value: unknown, fallbackMs: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(1000, Math.min(300000, Math.floor(value)))
    }
    return fallbackMs
  }

  /**
   * Redacts sensitive headers before dashboard logging.
   */
  function sanitizeHeadersForLog(
    headers: Record<string, string> | undefined,
  ): Record<string, string> | undefined {
    if (!headers) {
      return undefined
    }
    const sanitized: Record<string, string> = {}
    for (const [key, value] of Object.entries(headers)) {
      const normalizedKey = key.toLowerCase()
      sanitized[key] =
        normalizedKey === 'x-dataverse-key' || normalizedKey === 'authorization'
          ? REDACTED_HEADER_VALUE
          : value
    }
    return sanitized
  }

  /**
   * Converts response headers to a loggable record.
   */
  function responseHeadersToRecord(response: Response): Record<string, string> {
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    return headers
  }

  /**
   * Builds a concise HTTP body summary for dashboard logging.
   */
  function buildBodySummary(
    body: unknown,
    contentType: string | undefined,
    fallback: string,
  ): string | undefined {
    if (body === undefined || body === null) {
      return undefined
    }
    if (typeof body === 'string') {
      return body
    }
    const normalizedType = contentType?.toLowerCase() ?? ''
    if (normalizedType.includes('application/json')) {
      return fallback
    }
    return fallback
  }

  /**
   * Executes a Dataverse HTTP request with dashboard logging.
   */
  async function fetchDataverseWithTelemetry(
    url: string,
    timeoutMs: number,
    init: RequestInit,
    options: {
      requestBodyLog?: string
      responseBodyMode?: 'text' | 'skip'
    } = {},
  ): Promise<Response> {
    const collector = deps.getTelemetryCollector()
    const toolCallId = collector?.getCurrentToolCallId()
    const requestHeaders = sanitizeHeadersForLog(
      init.headers && !Array.isArray(init.headers)
        ? (init.headers as Record<string, string>)
        : undefined,
    )
    const startedAt = Date.now()
    try {
      const response = await fetchWithTimeout(url, timeoutMs, init)
      const latencyMs = Date.now() - startedAt
      collector?.recordDependencyCall('dataverse', response.ok, latencyMs)
      let responseBody: string | undefined
      if (options.responseBodyMode !== 'skip') {
        try {
          responseBody = await response.clone().text()
        } catch {
          responseBody = '[unavailable]'
        }
      }
      if (toolCallId) {
        collector?.appendToolCallHttpLog(toolCallId, {
          timestamp: new Date().toISOString(),
          dependency: 'dataverse',
          request: {
            method: init.method ?? 'GET',
            url,
            headers: requestHeaders,
            body: options.requestBodyLog,
          },
          response: {
            status: response.status,
            ok: response.ok,
            url: response.url || url,
            headers: responseHeadersToRecord(response),
            body: responseBody,
          },
        })
      }
      return response
    } catch (error) {
      const latencyMs = Date.now() - startedAt
      collector?.recordDependencyCall('dataverse', false, latencyMs)
      if (toolCallId) {
        collector?.appendToolCallHttpLog(toolCallId, {
          timestamp: new Date().toISOString(),
          dependency: 'dataverse',
          request: {
            method: init.method ?? 'GET',
            url,
            headers: requestHeaders,
            body: options.requestBodyLog,
          },
          error: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    }
  }

  /**
   * Extracts a crate object from Dataverse API response variants.
   *
   * Supports payloads where crate is top-level or nested under `data`.
   */
  function extractDataverseCrate(payload: unknown): RoCrate | undefined {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>
      if (Array.isArray(record['@graph'])) {
        return record as RoCrate
      }
      const data = record.data
      if (
        data &&
        typeof data === 'object' &&
        !Array.isArray(data)
      ) {
        const dataRecord = data as Record<string, unknown>
        if (Array.isArray(dataRecord['@graph'])) {
          return data as RoCrate
        }
        const roCrate = dataRecord.roCrate
        if (
          roCrate &&
          typeof roCrate === 'object' &&
          !Array.isArray(roCrate) &&
          Array.isArray((roCrate as Record<string, unknown>)['@graph'])
        ) {
          return roCrate as RoCrate
        }
      }
    }
    return undefined
  }

  /**
   * Handles extract arp pid.
   */
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

  /**
   * Handles build dataverse dataset url.
   */
  function buildDataverseDatasetUrl(baseUrl: string, pid?: string): string | undefined {
    if (!pid) {
      return undefined
    }
    return `${baseUrl}/dataset.xhtml?persistentId=${encodeURIComponent(pid)}`
  }

  function buildDataverseFileUrl(baseUrl: string, datasetPid: string, filePid?: string): string | undefined {
    if (!filePid) {
      return undefined
    }
    return `${baseUrl}/file.xhtml?persistentId=${encodeURIComponent(filePid)}&datasetPid=${encodeURIComponent(datasetPid)}`
  }

  function extractDataverseFileLinks(
    crate: RoCrate | undefined,
    baseUrl: string,
    datasetPid: string | undefined,
  ): Array<Record<string, unknown>> {
    if (!crate || !datasetPid || !Array.isArray(crate['@graph'])) {
      return []
    }
    return crate['@graph']
      .filter((entity) => {
        if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
          return false
        }
        return entityTypes(entity).includes('File')
      })
      .map((entity) => {
        const pid = readOptionalEntityString(entity, '@arpPid')
        const name = readOptionalEntityString(entity, 'name')
        const directoryLabel = readOptionalEntityString(entity, 'directoryLabel')
        const pathLabel = directoryLabel && name ? path.posix.join(directoryLabel, name) : name
        return {
          id: entity['@id'],
          name,
          directoryLabel,
          path: pathLabel,
          pid,
          url: buildDataverseFileUrl(baseUrl, datasetPid, pid),
        }
      })
  }

  /**
   * Handles entity types.
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
   * Guards ZIP entry paths against absolute paths and parent traversal.
   */
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

  function readOptionalEntityString(
    entity: RoCrateEntity,
    key: string,
  ): string | undefined {
    const value = entity[key]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }

  function localCratePathFromEntityId(id: string): string | undefined {
    if (id === '' || id === './' || id.startsWith('#')) {
      return undefined
    }

    let rel = id
    if (id.startsWith('file://./')) {
      rel = id.slice('file://./'.length)
    } else if (id.startsWith('./')) {
      rel = id.slice(2)
    } else if (id.includes(':')) {
      return undefined
    }

    if (!isSafeRelativePath(rel)) {
      return undefined
    }
    return rel.replace(/\\/g, '/')
  }

  function mimeTypeFromFilename(filename: string): string {
    const lower = filename.toLowerCase()
    if (lower.endsWith('.json')) return 'application/json'
    if (lower.endsWith('.csv')) return 'text/csv'
    if (lower.endsWith('.tsv')) return 'text/tab-separated-values'
    if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain'
    if (lower.endsWith('.png')) return 'image/png'
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
    if (lower.endsWith('.gif')) return 'image/gif'
    if (lower.endsWith('.pdf')) return 'application/pdf'
    if (lower.endsWith('.zip')) return 'application/zip'
    return 'application/octet-stream'
  }

  function md5File(filePath: string): string {
    const hash = createHash('md5')
    const fd = fs.openSync(filePath, 'r')
    const buffer = Buffer.allocUnsafe(64 * 1024)
    try {
      while (true) {
        const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)
        if (bytesRead <= 0) {
          break
        }
        hash.update(buffer.subarray(0, bytesRead))
      }
    } finally {
      fs.closeSync(fd)
    }
    return hash.digest('hex')
  }

  function shouldKeepDataverseUploadZip(): boolean {
    return getRuntimeEnvValue('ROCRATE_DATAVERSE_KEEP_UPLOAD_ZIPS') === 'true'
  }

  function createPendingDataverseCrate(
    crate: RoCrate,
    params: DataverseUploadParams,
    pid?: string,
    dataverseUrl?: string,
  ): PendingDataverseCrate {
    const id = `dv-crate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), DATAVERSE_PENDING_TMP_PREFIX))
    const tempPath = path.join(tempDir, 'ro-crate-metadata.json')
    fs.writeFileSync(tempPath, `${JSON.stringify(crate, null, params.indent)}\n`, 'utf8')
    const createdAtMs = Date.now()
    const pending: PendingDataverseCrate = {
      id,
      tempPath,
      cratePath: params.mode === 'local' ? params.cratePath : undefined,
      pid,
      dataverseUrl,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + 24 * 60 * 60 * 1000).toISOString(),
      indent: params.indent,
    }
    pendingDataverseCrates.set(id, pending)

    const collector = deps.getTelemetryCollector()
    const toolCallId = collector?.getCurrentToolCallId()
    if (collector && toolCallId && collector.addToolCallArtifact) {
      collector.addToolCallArtifact(toolCallId, {
        label: 'Dataverse-updated RO-Crate metadata',
        path: tempPath,
      })
    }
    return pending
  }

  function parsePendingDataverseCrateAdoptionParams(params: Record<string, unknown>): {
    pendingId: string
    write: true
    indent: number
  } {
    const pendingId = typeof params.pendingId === 'string' ? params.pendingId.trim() : ''
    if (!pendingId) {
      throw new Error('adopt_pending_dataverse_rocrate requires pendingId.')
    }
    if (params.write !== true) {
      throw new Error('adopt_pending_dataverse_rocrate requires write=true.')
    }
    return {
      pendingId,
      write: true,
      indent: Number.isFinite(params.indent) ? Number(params.indent) : 2,
    }
  }

  async function adoptPendingDataverseRoCrate(params: {
    pendingId: string
    write: true
    indent: number
  }): Promise<Record<string, unknown>> {
    const pending = pendingDataverseCrates.get(params.pendingId)
    if (!pending) {
      throw new Error(`No pending Dataverse-updated RO-Crate found for ${params.pendingId}.`)
    }
    if (!pending.cratePath) {
      throw new Error(
        'Pending Dataverse-updated RO-Crate has no local cratePath. Use local upload mode or copy pending tempPath manually.',
      )
    }
    if (!fs.existsSync(pending.tempPath)) {
      pendingDataverseCrates.delete(params.pendingId)
      throw new Error(`Pending Dataverse-updated RO-Crate temp file is missing: ${pending.tempPath}`)
    }
    const crate = JSON.parse(fs.readFileSync(pending.tempPath, 'utf8')) as RoCrate
    deps.writeCrateAtomic(pending.cratePath, crate, params.indent ?? pending.indent)
    pendingDataverseCrates.delete(params.pendingId)
    return {
      mode: 'local',
      writeApplied: true,
      cratePath: pending.cratePath,
      pendingId: pending.id,
      tempPath: pending.tempPath,
      pid: pending.pid,
      dataverseUrl: pending.dataverseUrl,
    }
  }

  function addZipFileEntry(
    entries: Map<string, string>,
    rootPath: string,
    relativePath: string,
  ): void {
    const normalized = relativePath.replace(/\\/g, '/')
    if (!isSafeRelativePath(normalized)) {
      throw new Error(`Refusing to include unsafe ZIP path: ${relativePath}`)
    }
    entries.set(normalized, path.resolve(rootPath, normalized))
  }

  function walkDirectoryFiles(
    rootPath: string,
    relativePath: string,
    entries: Map<string, string>,
  ): void {
    const directoryPath = path.resolve(rootPath, relativePath)
    const children = fs.readdirSync(directoryPath, { withFileTypes: true })
    for (const child of children) {
      const childRelativePath = path.posix.join(
        relativePath.replace(/\\/g, '/').replace(/\/+$/, ''),
        child.name,
      )
      const childFsPath = path.resolve(rootPath, childRelativePath)
      if (child.isDirectory()) {
        walkDirectoryFiles(rootPath, childRelativePath, entries)
      } else if (child.isFile()) {
        entries.set(childRelativePath, childFsPath)
      }
    }
  }

  function dataverseFilePathFromEntity(entity: RoCrateEntity): string | undefined {
    if (!entityTypes(entity).includes('File')) {
      return undefined
    }
    const localIdPath = localCratePathFromEntityId(
      typeof entity['@id'] === 'string' ? entity['@id'] : '',
    )
    if (localIdPath) {
      return localIdPath
    }
    const name = readOptionalEntityString(entity, 'name')
    if (!name || name.includes('/') || name.includes('\\')) {
      return undefined
    }
    const directoryLabel = readOptionalEntityString(entity, 'directoryLabel')
    const relativePath = directoryLabel
      ? path.posix.join(directoryLabel.replace(/\\/g, '/'), name)
      : name
    return isSafeRelativePath(relativePath) ? relativePath : undefined
  }

  /**
   * Collects local graph entity paths for ZIP upload.
   *
   * RO-Crate file entities are often bare relative ids (`data/file.csv`),
   * but some crates use `./...` or `file://./...`. All local path ids are
   * considered; directory paths are expanded recursively when packaging.
   */
  function extractCrateFilePaths(crate: RoCrate): string[] {
    const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
    const files = new Set<string>()
    for (const entity of graph) {
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
        continue
      }
      const id = typeof entity['@id'] === 'string' ? entity['@id'] : ''
      const localPath = dataverseFilePathFromEntity(entity) ?? localCratePathFromEntityId(id)
      if (localPath) {
        files.add(localPath)
      }
    }
    return Array.from(files).sort((a, b) => a.localeCompare(b))
  }

  function ensureDataverseFileContext(crate: RoCrate): void {
    const context = crate['@context']
    if (Array.isArray(context)) {
      const existingObject = context.find(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object' && !Array.isArray(item),
      )
      if (existingObject) {
        Object.assign(existingObject, DATAVERSE_FILE_CONTEXT)
      } else {
        context.push({ ...DATAVERSE_FILE_CONTEXT })
      }
      return
    }
    if (context && typeof context === 'object' && !Array.isArray(context)) {
      Object.assign(context as Record<string, unknown>, DATAVERSE_FILE_CONTEXT)
      return
    }
    crate['@context'] = context
      ? [context, { ...DATAVERSE_FILE_CONTEXT }]
      : ['https://w3id.org/ro/crate/1.1/context', { ...DATAVERSE_FILE_CONTEXT }]
  }

  function buildDataverseUploadCrate(crate: RoCrate, cratePath: string): RoCrate {
    const uploadCrate = JSON.parse(JSON.stringify(crate)) as RoCrate
    const crateRoot = path.dirname(cratePath)
    const graph = Array.isArray(uploadCrate['@graph']) ? uploadCrate['@graph'] : []
    let enrichedFileCount = 0
    for (const entity of graph) {
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
        continue
      }
      if (!entityTypes(entity).includes('File')) {
        continue
      }
      const relativePath = dataverseFilePathFromEntity(entity)
      if (!relativePath) {
        continue
      }
      const fsPath = path.resolve(crateRoot, relativePath)
      const expectedPrefix = `${crateRoot}${path.sep}`
      if (fsPath !== crateRoot && !fsPath.startsWith(expectedPrefix)) {
        throw new Error(`Refusing to inspect path outside crate root: ${relativePath}`)
      }
      if (!fs.existsSync(fsPath) || !fs.statSync(fsPath).isFile()) {
        continue
      }
      const parsed = path.posix.parse(relativePath.replace(/\\/g, '/'))
      const stat = fs.statSync(fsPath)
      entity.name = readOptionalEntityString(entity, 'name') ?? parsed.base
      entity.hash = readOptionalEntityString(entity, 'hash') ?? md5File(fsPath)
      entity.contentSize =
        readOptionalEntityString(entity, 'contentSize') ?? String(stat.size)
      entity.encodingFormat =
        readOptionalEntityString(entity, 'encodingFormat') ??
        mimeTypeFromFilename(relativePath)
      if (!readOptionalEntityString(entity, 'directoryLabel') && parsed.dir) {
        entity.directoryLabel = parsed.dir
      }
      enrichedFileCount += 1
    }
    if (enrichedFileCount > 0) {
      ensureDataverseFileContext(uploadCrate)
    }
    return uploadCrate
  }

  /**
   * Handles create crc32 table.
   */
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

  /**
   * Handles crc32.
   */
  function crc32(buffer: Buffer): number {
    let crc = 0xffffffff
    for (let i = 0; i < buffer.length; i += 1) {
      const index = (crc ^ buffer[i]) & 0xff
      crc = (CRC32_TABLE[index] ^ (crc >>> 8)) >>> 0
    }
    return (crc ^ 0xffffffff) >>> 0
  }

  /**
   * Handles dos date time.
   */
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

  /**
   * Builds a minimal ZIP archive using "stored" (uncompressed) entries.
   *
   * Implemented locally to avoid extra runtime dependencies.
   */
  function crc32File(filePath: string): { crc: number; size: number } {
    const fd = fs.openSync(filePath, 'r')
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let crc = 0xffffffff
    let size = 0
    try {
      while (true) {
        const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)
        if (bytesRead <= 0) {
          break
        }
        size += bytesRead
        for (let i = 0; i < bytesRead; i += 1) {
          const index = (crc ^ buffer[i]) & 0xff
          crc = (CRC32_TABLE[index] ^ (crc >>> 8)) >>> 0
        }
      }
    } finally {
      fs.closeSync(fd)
    }
    return { crc: (crc ^ 0xffffffff) >>> 0, size: size >>> 0 }
  }

  type StoredZipEntry =
    | { name: string; data: Buffer }
    | { name: string; filePath: string }

  function writeStoredZipToFile(entries: StoredZipEntry[], outputPath: string): void {
    const centralParts: Buffer[] = []
    let offset = 0
    const dt = dosDateTime()
    const zipFd = fs.openSync(outputPath, 'w')

    try {
      for (const entry of entries) {
        const nameBuffer = Buffer.from(entry.name, 'utf8')
        const stats =
          'data' in entry
            ? { crc: crc32(entry.data), size: entry.data.length >>> 0 }
            : crc32File(entry.filePath)

        const localHeader = Buffer.alloc(30)
        localHeader.writeUInt32LE(0x04034b50, 0)
        localHeader.writeUInt16LE(20, 4)
        localHeader.writeUInt16LE(0, 6)
        localHeader.writeUInt16LE(0, 8)
        localHeader.writeUInt16LE(dt.time, 10)
        localHeader.writeUInt16LE(dt.date, 12)
        localHeader.writeUInt32LE(stats.crc, 14)
        localHeader.writeUInt32LE(stats.size, 18)
        localHeader.writeUInt32LE(stats.size, 22)
        localHeader.writeUInt16LE(nameBuffer.length, 26)
        localHeader.writeUInt16LE(0, 28)

        fs.writeSync(zipFd, localHeader)
        fs.writeSync(zipFd, nameBuffer)
        if ('data' in entry) {
          fs.writeSync(zipFd, entry.data)
        } else {
          const sourceFd = fs.openSync(entry.filePath, 'r')
          const copyBuffer = Buffer.allocUnsafe(64 * 1024)
          try {
            while (true) {
              const bytesRead = fs.readSync(sourceFd, copyBuffer, 0, copyBuffer.length, null)
              if (bytesRead <= 0) {
                break
              }
              fs.writeSync(zipFd, copyBuffer, 0, bytesRead)
            }
          } finally {
            fs.closeSync(sourceFd)
          }
        }

        const centralHeader = Buffer.alloc(46)
        centralHeader.writeUInt32LE(0x02014b50, 0)
        centralHeader.writeUInt16LE(20, 4)
        centralHeader.writeUInt16LE(20, 6)
        centralHeader.writeUInt16LE(0, 8)
        centralHeader.writeUInt16LE(0, 10)
        centralHeader.writeUInt16LE(dt.time, 12)
        centralHeader.writeUInt16LE(dt.date, 14)
        centralHeader.writeUInt32LE(stats.crc, 16)
        centralHeader.writeUInt32LE(stats.size, 20)
        centralHeader.writeUInt32LE(stats.size, 24)
        centralHeader.writeUInt16LE(nameBuffer.length, 28)
        centralHeader.writeUInt16LE(0, 30)
        centralHeader.writeUInt16LE(0, 32)
        centralHeader.writeUInt16LE(0, 34)
        centralHeader.writeUInt16LE(0, 36)
        centralHeader.writeUInt32LE(0, 38)
        centralHeader.writeUInt32LE(offset >>> 0, 42)
        centralParts.push(centralHeader, nameBuffer)

        offset += localHeader.length + nameBuffer.length + stats.size
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

      fs.writeSync(zipFd, centralDirectory)
      fs.writeSync(zipFd, eocd)
    } finally {
      fs.closeSync(zipFd)
    }
  }

  /**
   * Packages `ro-crate-metadata.json` and referenced file entities into ZIP.
   *
   * Enforces crate-root containment and existence checks for referenced files.
   */
  function buildDataverseUploadZip(crate: RoCrate, cratePath: string, outputPath: string, indent: number): void {
    const crateRoot = path.dirname(cratePath)
    const entries: StoredZipEntry[] = []
    const fileEntries = new Map<string, string>()
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
      if (stat.isDirectory()) {
        walkDirectoryFiles(crateRoot, relativePath, fileEntries)
      } else if (stat.isFile()) {
        addZipFileEntry(fileEntries, crateRoot, relativePath)
      }
    }
    for (const [name, filePath] of Array.from(fileEntries.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      entries.push({ name, filePath })
    }
    writeStoredZipToFile(entries, outputPath)
  }

  function buildMultipartFileUploadBody(
    fieldName: string,
    filename: string,
    filePath: string,
    contentType: string,
    boundary: string,
  ): { body: Readable; contentLength: number } {
    const preamble = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      'utf8',
    )
    const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
    const fileSize = fs.statSync(filePath).size
    const contentLength = preamble.length + fileSize + epilogue.length

    const body = Readable.from(
      (async function* () {
        yield preamble
        const stream = fs.createReadStream(filePath)
        try {
          for await (const chunk of stream) {
            yield chunk
          }
        } finally {
          stream.destroy()
        }
        yield epilogue
      })(),
    )

    return { body, contentLength }
  }

  /**
   * Parses upload params and enforces explicit write intent (`write=true`).
   */
  function parseDataverseUploadParams(params: Record<string, unknown>): DataverseUploadParams {
    if (params.write !== true) {
      throw new Error(
        'upload_rocrate_to_dataverse requires write=true. Use explicit write intent for upload operations.',
      )
    }
    const loaded = deps.loadCrateFromParams(params)
    return {
      mode: loaded.mode,
      cratePath: loaded.cratePath,
      crate: loaded.crate,
      pid: readOptionalStringParam(params.pid),
      baseUrl: resolveDataverseBaseUrl(params.baseUrl),
      ownerId: resolveDataverseOwnerId(params.ownerId),
      apiKey: resolveDataverseApiKey(params.apiKey),
      timeoutMs: parseTimeoutMs(params.timeoutMs, 30000),
      responseMode: deps.parseResponseMode(
        params,
        loaded.mode === 'remote' ? 'full' : 'summary',
      ),
      profileResolutionInputs: deps.parseProfileResolutionInputs(params),
      indent:
        typeof params.indent === 'number' && Number.isFinite(params.indent)
          ? Math.max(0, Math.min(8, Math.floor(params.indent)))
          : 2,
    }
  }

  /**
   * Parses download params and enforces local persistence rules.
   *
   * Local mode requires `write=true`; remote mode always returns payload only.
   */
  function parseDataverseDownloadParams(
    params: Record<string, unknown>,
  ): DataverseDownloadParams {
    const mode = deps.parseAccessMode(params)
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
      cratePath: mode === 'local' ? deps.ensureCratePath(params.cratePath) : undefined,
      pid,
      version: readOptionalStringParam(params.version),
      baseUrl: resolveDataverseBaseUrl(params.baseUrl),
      apiKey: resolveDataverseApiKey(params.apiKey),
      timeoutMs: parseTimeoutMs(params.timeoutMs, 30000),
      responseMode: deps.parseResponseMode(params, mode === 'remote' ? 'full' : 'summary'),
      writeToDisk,
      indent:
        typeof params.indent === 'number' && Number.isFinite(params.indent)
          ? Math.max(0, Math.min(8, Math.floor(params.indent)))
          : 2,
    }
  }

  /**
   * Best-effort parser for Dataverse error payloads that may contain
   * JSON strings with extra text around the object.
   */
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

  /**
   * Normalizes Dataverse validation structures into field-level issues while
   * retaining the original response for agents that need more context.
   */
  function extractDataverseValidationIssues(
    payload: unknown,
    includePlainMessages = true,
  ): DataverseValidationIssue[] {
    const issues: DataverseValidationIssue[] = []
    const addIssue = (entity: string, value: unknown): void => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return
      }
      const issue = value as Record<string, unknown>
      const field =
        readOptionalStringParam(issue.errorField) ??
        readOptionalStringParam(issue.field)
      const message =
        readOptionalStringParam(issue.errorMessage) ??
        readOptionalStringParam(issue.message)
      const suggestion =
        readOptionalStringParam(issue.errorSuggestion) ??
        readOptionalStringParam(issue.suggestion)
      if (!field && !message && !suggestion) {
        return
      }
      issues.push({
        entity,
        ...(field ? { field } : {}),
        message: message ?? 'Dataverse validation error',
        ...(suggestion ? { suggestion } : {}),
      })
    }

    const collectIssues = (report: Record<string, unknown>): void => {
      const errors = Array.isArray(report.errors) ? report.errors : []
      for (const entry of errors) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          continue
        }
        const entryRecord = entry as Record<string, unknown>
        const errorEntity =
          readOptionalStringParam(entryRecord.errorEntity) ?? 'RO-Crate'
        const nested = Array.isArray(entryRecord.errors) ? entryRecord.errors : []
        for (const nestedIssue of nested) {
          addIssue(errorEntity, nestedIssue)
        }
        if (nested.length === 0) {
          addIssue(errorEntity, entryRecord)
        }
      }
    }

    const collectReportValue = (value: unknown, fallbackEntity: string): void => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        collectIssues(value as Record<string, unknown>)
        return
      }
      if (typeof value !== 'string') {
        return
      }
      const parsed = tryParseJsonObjectFromString(value)
      if (parsed) {
        collectIssues(parsed)
        return
      }
      const message = value.trim()
      if (includePlainMessages && message !== '') {
        issues.push({ entity: fallbackEntity, message })
      }
    }

    if (typeof payload === 'string') {
      collectReportValue(payload, 'Dataverse')
    } else if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>
      collectIssues(record)
      const details = record.details
      collectReportValue(details, 'Dataverse')

      const message = record.message
      collectReportValue(message, 'Dataverse')

      const error = record.error
      collectReportValue(error, 'Dataverse')

      const data = record.data
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const dataRecord = data as Record<string, unknown>
        collectIssues(dataRecord)
        collectReportValue(dataRecord.validation, 'Dataverse')
        collectReportValue(dataRecord.details, 'Dataverse')
        collectReportValue(dataRecord.message, 'Dataverse')
      }
    }

    const seen = new Set<string>()
    return issues.filter((issue) => {
      const key = JSON.stringify(issue)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  }

  /**
   * Formats normalized Dataverse issues for concise error messages.
   */
  function formatDataverseValidationIssues(
    issues: DataverseValidationIssue[],
  ): string[] {
    return deps.uniqueStrings(
      issues.map((issue) => {
        const prefix = `${issue.entity}${issue.field ? `.${issue.field}` : ''}`
        return `${prefix}: ${[issue.message, issue.suggestion]
          .filter((part) => part !== '')
          .join(' ')}`.trim()
      }),
    )
  }

  /**
   * Extracts concise Dataverse validation messages.
   */
  function extractDataverseValidationMessages(
    payload: unknown,
    includePlainMessages = true,
  ): string[] {
    return formatDataverseValidationIssues(
      extractDataverseValidationIssues(payload, includePlainMessages),
    )
  }

  /**
   * Handles fetch with timeout.
   */
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

  /**
   * Calls Dataverse preflight validation endpoint and returns parsed result
   * with normalized validation messages.
   */
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
    issues: DataverseValidationIssue[]
    payload: unknown
  }> {
    const endpointUrl = new URL(deps.defaultValidatePath, `${baseUrl}/`)
    endpointUrl.searchParams.set('strict', 'true')
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': getServerUserAgent(),
    }
    if (apiKey) {
      headers['x-dataverse-key'] = apiKey
    }
    const requestBody = JSON.stringify(crate)
    const response = await fetchDataverseWithTelemetry(endpointUrl.toString(), timeoutMs, {
      method: 'POST',
      headers,
      body: requestBody,
    }, {
      requestBodyLog: buildBodySummary(requestBody, headers['content-type'], requestBody),
    })
    const payloadText = await response.text()
    let payload: unknown = payloadText
    try {
      payload = JSON.parse(payloadText) as unknown
    } catch {
      // keep text payload
    }
    const issues = extractDataverseValidationIssues(payload, !response.ok)
    const messages = extractDataverseValidationMessages(payload, !response.ok)
    return {
      ok: response.ok && messages.length === 0,
      status: response.status,
      requestUrl: response.url || endpointUrl.toString(),
      messages,
      issues,
      payload,
    }
  }

  /**
   * Executes Dataverse upload workflow.
   *
   * - Optional profile/context preflight
   * - New dataset: ZIP upload (local mode only)
   * - Existing dataset (`pid`): JSON metadata update
   */
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
    const constraints = deps.ensureProfileConformanceOrThrow(
      params.crate,
      params.mode,
      params.profileResolutionInputs,
      {
        requiredMode: 'enforce_required',
      },
    )
    const contextSuggestion = deps.buildContextTermSuggestion(params.crate, constraints)
    const externalContextCoverage = hasExternalContextCoverage(params.crate)
    const termUsageByScope = collectTermUsageProfileScope(params.crate)
    const blockingMissingTerms = contextSuggestion.missingTerms.filter((term) => {
      if (!externalContextCoverage) {
        return true
      }
      const usage = termUsageByScope.get(term)
      return !!usage?.profiled || !usage?.unprofiled
    })
    if (blockingMissingTerms.length > 0) {
      throw new Error(
        `Upload blocked by @context coverage. Missing mappings for used term(s): ${blockingMissingTerms.join(', ')}. Use suggest_context_terms and mergeContext before upload.`,
      )
    }
    const dataverseUploadCrate =
      creatingDataset && params.mode === 'local' && params.cratePath
        ? buildDataverseUploadCrate(params.crate, params.cratePath)
        : params.crate
    const dataversePreflight = await validateRoCrateViaDataverse(
      dataverseUploadCrate,
      params.baseUrl,
      params.apiKey,
      params.timeoutMs,
    )
    if (!dataversePreflight.ok) {
      if (isDataverseAuthenticationStatus(dataversePreflight.status)) {
        throw new DataverseAuthenticationError({
          status: dataversePreflight.status,
          requestUrl: dataversePreflight.requestUrl,
          cratePath: params.cratePath,
          apiKeyProvided: hasDataverseApiKey(params.apiKey),
          dataverseResponse: dataversePreflight.payload,
          dashboardUrl: getDashboardUrlForUser(),
        })
      }
      throw new DataversePreflightValidationError({
        status: dataversePreflight.status,
        requestUrl: dataversePreflight.requestUrl,
        cratePath: params.cratePath,
        validationIssues: dataversePreflight.issues,
        validationErrors: dataversePreflight.messages,
        validationResponse: dataversePreflight.payload,
      })
    }
    let endpoint: 'create' | 'update'
    let endpointUrl: URL
    let response: Response
    let tempUploadDir: string | undefined
    let zipPath: string | undefined
    let uploadSucceeded = false
    try {
      if (creatingDataset) {
        if (params.mode !== 'local' || !params.cratePath) {
          throw new Error(
            'Creating a new Dataverse dataset requires local mode so files can be zipped with ro-crate-metadata.json.',
          )
        }
        endpoint = 'create'
        endpointUrl = new URL('/api/arp/uploadRoCrateZip', `${params.baseUrl}/`)
        endpointUrl.searchParams.set('ownerId', params.ownerId)
        tempUploadDir = fs.mkdtempSync(path.join(os.tmpdir(), DATAVERSE_UPLOAD_TMP_PREFIX))
        zipPath = path.join(tempUploadDir, 'rocrate.zip')
        const collector = deps.getTelemetryCollector()
        const toolCallId = collector?.getCurrentToolCallId()
        if (collector?.addToolCallArtifact && toolCallId) {
          collector.addToolCallArtifact(toolCallId, {
            label: 'Dataverse upload ZIP',
            path: zipPath,
          })
        }
        buildDataverseUploadZip(
          dataverseUploadCrate,
          params.cratePath,
          zipPath,
          params.indent,
        )
        const boundary = `----rocrate-mcp-${Date.now().toString(16)}-${Math.random()
          .toString(16)
          .slice(2)}`
        const multipart = buildMultipartFileUploadBody(
          'file',
          'rocrate.zip',
          zipPath,
          'application/zip',
          boundary,
        )
        const headers: Record<string, string> = {
          accept: 'application/json',
          'content-length': String(multipart.contentLength),
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'user-agent': getServerUserAgent(),
        }
        if (params.apiKey) {
          headers['x-dataverse-key'] = params.apiKey
        }
        response = await fetchDataverseWithTelemetry(endpointUrl.toString(), params.timeoutMs, {
          method: 'POST',
          duplex: 'half' as const,
          headers,
          body: multipart.body as unknown as RequestInit['body'],
        }, {
          requestBodyLog: `multipart/form-data upload: field=file; filename=rocrate.zip; temp-zip-path=${zipPath}; content-type=application/zip; content omitted; content-length=${multipart.contentLength}`,
        })
      } else {
        endpoint = 'update'
        endpointUrl = new URL(`/api/arp/rocrate/${params.pid}`, `${params.baseUrl}/`)
        const headers: Record<string, string> = {
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': getServerUserAgent(),
        }
        if (params.apiKey) {
          headers['x-dataverse-key'] = params.apiKey
        }
        const requestBody = JSON.stringify(params.crate)
        response = await fetchDataverseWithTelemetry(endpointUrl.toString(), params.timeoutMs, {
          method: 'POST',
          headers,
          body: requestBody,
        }, {
          requestBodyLog: buildBodySummary(requestBody, headers['content-type'], requestBody),
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
        if (isDataverseAuthenticationStatus(response.status)) {
          throw new DataverseAuthenticationError({
            status: response.status,
            requestUrl: response.url || endpointUrl.toString(),
            cratePath: params.cratePath,
            apiKeyProvided: hasDataverseApiKey(params.apiKey),
            dataverseResponse: payload,
            dashboardUrl: getDashboardUrlForUser(),
          })
        }
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
      const writeApplied = false
      const pendingDataverseCrate = ingestedCrate
        ? createPendingDataverseCrate(ingestedCrate, params, resolvedPid, dataverseUrl)
        : undefined

      uploadSucceeded = true
      return {
        mode: params.mode,
        writeApplied,
        cratePath: params.cratePath,
        status: response.status,
        endpoint,
        requestUrl: response.url || endpointUrl.toString(),
        pid: resolvedPid ?? params.pid,
        dataverseUrl,
        fileLinks: extractDataverseFileLinks(ingestedCrate, params.baseUrl, resolvedPid),
        pendingDataverseCrate,
        ingestedCrate: params.responseMode === 'full' ? ingestedCrate : undefined,
        response: payload,
        note:
          pendingDataverseCrate
            ? 'Dataverse returned an updated RO-Crate. Ask the user whether to adopt it; if yes, call adopt_pending_dataverse_rocrate with pendingDataverseCrate.id and write=true.'
            : undefined,
      }
    } catch (error) {
      if (error instanceof DataverseAuthenticationError) {
        if (zipPath) {
          error.setPreservedZipPath(zipPath)
        }
        throw error
      }
      if (zipPath) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`${message} ZIP preserved at ${zipPath}`)
      }
      throw error
    } finally {
      if (tempUploadDir && uploadSucceeded && !shouldKeepDataverseUploadZip()) {
        fs.rmSync(tempUploadDir, { recursive: true, force: true })
      }
    }
  }

  /**
   * Downloads RO-Crate metadata by PID and optionally persists it in local mode.
   */
  async function runDataverseDownload(
    params: DataverseDownloadParams,
  ): Promise<Record<string, unknown>> {
    const endpointUrl = new URL(`/api/arp/rocrate/${params.pid}`, `${params.baseUrl}/`)
    if (params.version) {
      endpointUrl.searchParams.set('version', params.version)
    }
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': getServerUserAgent(),
    }
    if (params.apiKey) {
      headers['x-dataverse-key'] = params.apiKey
    }
    const response = await fetchDataverseWithTelemetry(endpointUrl.toString(), params.timeoutMs, {
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
      deps.writeCrateAtomic(params.cratePath, crate, params.indent)
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

  return {
    parseDataverseUploadParams,
    parseDataverseDownloadParams,
    parsePendingDataverseCrateAdoptionParams,
    runDataverseUpload,
    runDataverseDownload,
    adoptPendingDataverseRoCrate,
  }
}

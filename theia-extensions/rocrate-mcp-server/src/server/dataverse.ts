import * as fs from 'node:fs'
import * as path from 'node:path'
import { validateCrate } from '../core'
import type { RoCrate, RoCrateEntity } from '../core/types'
import type {
  DataverseDownloadParams,
  DataverseUploadParams,
  ProfileResolutionInputs,
} from './types'

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
}

/**
 * Builds Dataverse upload/download/validation handlers and parameter parsers.
 */
export function createDataverseHandlers(deps: DataverseDeps) {
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
      readOptionalStringParam(process.env.DATAVERSE_BASE_URL) ??
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
      readOptionalStringParam(process.env.DATAVERSE_API_KEY)
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
        !Array.isArray(data) &&
        Array.isArray((data as Record<string, unknown>)['@graph'])
      ) {
        return data as RoCrate
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
    return `${baseUrl}/dataset.xhtml?persistentId=${encodeURIComponent(pid)}#metadataMapTab`
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

  /**
   * Collects relative file paths from `File` entities for ZIP upload.
   *
   * Only includes `./...` and `file://./...` ids that pass path-safety checks.
   */
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

  /**
   * Packages `ro-crate-metadata.json` and referenced file entities into ZIP.
   *
   * Enforces crate-root containment and existence checks for referenced files.
   */
  function buildDataverseUploadZip(crate: RoCrate, cratePath: string, indent: number): Buffer {
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
   * Normalizes nested Dataverse validation structures into flat user-facing
   * error messages (`entity.field: message`).
   */
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

    return deps.uniqueStrings(messages.filter((item) => item.trim() !== ''))
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
    payload: unknown
  }> {
    const endpointUrl = new URL(deps.defaultValidatePath, `${baseUrl}/`)
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
      deps.writeCrateAtomic(params.cratePath, ingestedCrate, params.indent)
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
    runDataverseUpload,
    runDataverseDownload,
  }
}

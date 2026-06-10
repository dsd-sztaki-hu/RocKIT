import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const DEFAULT_INDEX_FILENAME = 'metadata-schema-index.json'
const DEFAULT_REMOTE_PROVIDER_CONFIG_FILENAME = 'remote-schema-providers.json'
const DEFAULT_REMOTE_PROVIDER_KEYTAR_SERVICE = 'AROMA2.RemoteSchemaProvider'
const DEFAULT_ARP_PROD_PREFIX = 'https://repo.schema.researchdata.hu/templates/'
const DEFAULT_ARP_DEV_PREFIX = 'https://repo.cedardev.dsd.sztaki.hu/templates/'
const DEFAULT_ARP_W3ID_PROD = 'https://w3id.org/arp/schema/'
const DEFAULT_ARP_W3ID_DEV = 'https://w3id.org/arp/dev/schema/'
const DEFAULT_REGISTRY_FOLDER =
  'https://repo.schema.researchdata.hu/folders/49ba90b3-86ee-45b8-a623-d4a7a7df926c'

export type MetadataProfileSource = 'local' | 'remote'

export type MetadataProfileFiles = {
  sourcePath: string
  convertedPath: string
}

export type MetadataProfileInfo = {
  id: string
  name: string
  version: string
  source: MetadataProfileSource
  type: 'cedar' | string
  files: MetadataProfileFiles
  aux: {
    templateUuid?: string
    reference: string
  }
  conformsTo?: string
  downloadUrl?: string
  createdAt: string | null
  updatedAt: string | null
  downloadedAt: string
  status?: 'downloading' | 'processing' | 'ok' | 'failed'
  statusMessage?: string
}

export type MetadataProfileIndex = {
  profiles: MetadataProfileInfo[]
  conformsToIndex: Record<string, string[]>
}

export type MetadataProfileStorage = {
  rootPath: string
  cedarDir: string
  roCrateDir: string
  indexPath: string
}

export type CedarProvider = {
  id?: string
  title?: string
  baseUrl?: string
  displayUrl?: string
  domainBase?: string
  resourceBaseUrl?: string
  registryFolderId?: string
  apiKey?: string
  type?: string
}

export type CedarProviderListResult = {
  storage: MetadataProfileStorage
  configPath: string
  keytarService: string
  providers: CedarProvider[]
  warnings: string[]
}

export type CedarProviderSaveResult = CedarProviderListResult & {
  saved: CedarProvider
}

export type RemoteSchemaSummary = {
  providerId: string
  providerTitle: string
  id: string
  name: string
  version?: string
  description?: string
  templateUrl: string
  conformsTo: string
  alreadyImported: boolean
}

export type RemoteCedarResource = {
  id: string
  name: string
  resourceType: 'folder' | 'template'
  conformsTo?: string
  alreadyImported: boolean
}

export type ImportResult = {
  storage: MetadataProfileStorage
  profile: MetadataProfileInfo
  sourcePath: string
  convertedPath: string
  warnings: string[]
}

export type ResolveMissingResult = {
  storage: MetadataProfileStorage
  imported: MetadataProfileInfo[]
  unresolvedUrls: string[]
  warnings: string[]
}

type ConverterModule = {
  CedarTemplateToDescriboProfileConverter: new () => {
    processCedarTemplate: (cedarTemplate: string) => string
  }
}

export function resolveProfileRootPath(rootPath?: string): string {
  const configured = rootPath ?? process.env.AROMA_ROOT_PATH
  if (configured && configured.trim() !== '') {
    return path.resolve(configured)
  }
  return path.join(os.homedir(), '.aroma')
}

export function resolveProfileStorage(rootPath?: string): MetadataProfileStorage {
  const root = resolveProfileRootPath(rootPath)
  const indexFile = process.env.AROMA_METADATA_SCHEMA_INDEX_FILE
  const indexPath =
    indexFile && indexFile.trim() !== ''
      ? path.isAbsolute(indexFile)
        ? indexFile
        : path.join(root, indexFile)
      : path.join(root, DEFAULT_INDEX_FILENAME)
  return {
    rootPath: root,
    cedarDir: path.join(root, 'metadata-schemas', 'cedar'),
    roCrateDir: path.join(root, 'metadata-schemas', 'ro-crate'),
    indexPath,
  }
}

export function ensureProfileStorage(rootPath?: string): MetadataProfileStorage {
  const storage = resolveProfileStorage(rootPath)
  fs.mkdirSync(storage.cedarDir, { recursive: true })
  fs.mkdirSync(storage.roCrateDir, { recursive: true })
  fs.mkdirSync(path.dirname(storage.indexPath), { recursive: true })
  if (!fs.existsSync(storage.indexPath)) {
    writeJsonAtomic(storage.indexPath, { profiles: [], conformsToIndex: {} }, 4)
  }
  return storage
}

export function loadProfileIndex(rootPath?: string): MetadataProfileIndex {
  const storage = ensureProfileStorage(rootPath)
  if (!fs.existsSync(storage.indexPath)) {
    return { profiles: [], conformsToIndex: {} }
  }
  const parsed = JSON.parse(fs.readFileSync(storage.indexPath, 'utf8')) as unknown
  if (Array.isArray(parsed)) {
    const migrated = { profiles: parsed as MetadataProfileInfo[], conformsToIndex: {} }
    rebuildConformsToIndex(migrated)
    return migrated
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { profiles: [], conformsToIndex: {} }
  }
  const record = parsed as Partial<MetadataProfileIndex>
  const index = {
    profiles: Array.isArray(record.profiles) ? record.profiles : [],
    conformsToIndex:
      record.conformsToIndex &&
      typeof record.conformsToIndex === 'object' &&
      !Array.isArray(record.conformsToIndex)
        ? record.conformsToIndex
        : {},
  }
  rebuildConformsToIndex(index)
  return index
}

export function saveProfileIndex(index: MetadataProfileIndex, rootPath?: string): MetadataProfileStorage {
  const storage = ensureProfileStorage(rootPath)
  rebuildConformsToIndex(index)
  writeJsonAtomic(storage.indexPath, index, 4)
  return storage
}

export function rebuildConformsToIndex(index: MetadataProfileIndex): void {
  index.conformsToIndex = {}
  for (const profile of index.profiles) {
    if (!profile.conformsTo) {
      continue
    }
    const current = index.conformsToIndex[profile.conformsTo] ?? []
    if (!current.includes(profile.id)) {
      current.push(profile.id)
    }
    index.conformsToIndex[profile.conformsTo] = current
  }
}

export function listLocalProfiles(rootPath?: string): {
  storage: MetadataProfileStorage
  profiles: MetadataProfileInfo[]
  index: MetadataProfileIndex
} {
  const storage = ensureProfileStorage(rootPath)
  const index = loadProfileIndex(rootPath)
  return {
    storage,
    index,
    profiles: index.profiles.map((profile) => ({ ...profile, status: profile.status ?? 'ok' })),
  }
}

export async function importCedarTemplateContent(args: {
  rawContent: string
  source?: MetadataProfileSource
  originalFileName?: string
  rootPath?: string
  conformsTo?: string
  downloadUrl?: string
  now?: Date
}): Promise<ImportResult> {
  const storage = ensureProfileStorage(args.rootPath)
  const warnings: string[] = []
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(args.rawContent) as Record<string, unknown>
  } catch {
    throw new Error('Invalid CEDAR template JSON.')
  }

  const schemaName = readString(parsed['schema:name'])
  if (!schemaName) {
    throw new Error('Missing required CEDAR field: schema:name.')
  }
  const schemaVersion = readString(parsed['pav:version']) ?? '1.0.0'
  const schemaId = readString(parsed['@id']) ?? ''
  const createdAt = readString(parsed['pav:createdOn'])
  const updatedAt = readString(parsed['pav:lastUpdatedOn'])
  const source = args.source ?? 'remote'
  const conformsTo = args.conformsTo || deriveConformsToFromId(schemaId)
  const downloadedAt = (args.now ?? new Date()).toISOString()
  const hash = createShortHash(`${schemaId}:${source}`)
  const safeName = schemaName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const fileName = `${safeName || 'cedar_schema'}_v${schemaVersion}_${source}_${hash}.json`
  const sourcePath = `metadata-schemas/cedar/${fileName}`
  const convertedPath = `metadata-schemas/ro-crate/${fileName}`
  const absoluteSourcePath = path.join(storage.rootPath, sourcePath)
  const absoluteConvertedPath = path.join(storage.rootPath, convertedPath)

  const convertedContent = await convertCedarTemplate(args.rawContent)
  fs.writeFileSync(absoluteSourcePath, args.rawContent, 'utf8')
  fs.writeFileSync(absoluteConvertedPath, convertedContent, 'utf8')

  const profile: MetadataProfileInfo = {
    id: createId(),
    name: schemaName,
    version: schemaVersion,
    source,
    type: 'cedar',
    files: { sourcePath, convertedPath },
    aux: {
      templateUuid: extractUuid(schemaId) ?? schemaId,
      reference: schemaId,
    },
    conformsTo,
    downloadUrl: args.downloadUrl ?? '',
    createdAt: createdAt ?? null,
    updatedAt: updatedAt ?? null,
    downloadedAt,
    status: 'ok',
  }

  const index = loadProfileIndex(args.rootPath)
  index.profiles = index.profiles.filter(
    (existing) => !(existing.aux?.reference === schemaId && existing.source === source),
  )
  index.profiles.push(profile)
  saveProfileIndex(index, args.rootPath)

  return {
    storage,
    profile,
    sourcePath: absoluteSourcePath,
    convertedPath: absoluteConvertedPath,
    warnings,
  }
}

export async function importCedarTemplateFromUrl(args: {
  url: string
  rootPath?: string
  provider?: CedarProvider
  conformsTo?: string
}): Promise<ImportResult> {
  const resolved = resolveTemplateFetchUrl(args.url, args.provider)
  const fetched = await fetchTextWithAuthFallback(resolved, args.provider)
  return importCedarTemplateContent({
    rawContent: fetched.content,
    source: 'remote',
    rootPath: args.rootPath,
    conformsTo: args.conformsTo,
    downloadUrl: fetched.finalUrl,
  })
}

export async function resolveMissingConformsToUrls(args: {
  profileUrls: string[]
  rootPath?: string
  providers?: CedarProvider[]
}): Promise<ResolveMissingResult> {
  const storage = ensureProfileStorage(args.rootPath)
  const imported: MetadataProfileInfo[] = []
  const unresolvedUrls: string[] = []
  const warnings: string[] = []
  const uniqueUrls = unique(args.profileUrls.filter(isCedarLikeUrl))
  for (const profileUrl of uniqueUrls) {
    if (hasLocalProfileForConformsTo(profileUrl, args.rootPath)) {
      continue
    }
    try {
      const result = await importCedarTemplateFromUrl({
        url: profileUrl,
        rootPath: args.rootPath,
        provider: pickProviderForUrl(profileUrl, args.providers),
        conformsTo: profileUrl,
      })
      imported.push(result.profile)
    } catch (error) {
      unresolvedUrls.push(profileUrl)
      warnings.push(`Failed to resolve CEDAR profile ${profileUrl}: ${errorMessage(error)}`)
    }
  }
  return { storage, imported, unresolvedUrls, warnings }
}

export async function listRemoteSchemas(
  provider: CedarProvider = defaultCedarProvider(),
  query?: string,
  rootPath?: string,
): Promise<{
  provider: CedarProvider
  schemas: RemoteSchemaSummary[]
  storage: MetadataProfileStorage
}> {
  const normalizedProvider = normalizeProvider(provider)
  const folderId = normalizedProvider.registryFolderId ?? DEFAULT_REGISTRY_FOLDER
  const url = `${resourceBaseUrl(normalizedProvider)}/folders/${encodeURIComponent(folderId)}/contents?limit=100&offset=0&publication_status=all&resource_types=template,folder&sort=name&version=all`
  const fetched = await fetchJsonWithAuthFallback(url, normalizedProvider)
  const resources = Array.isArray((fetched as { resources?: unknown }).resources)
    ? ((fetched as { resources: unknown[] }).resources)
    : []
  const local = listLocalProfiles(rootPath)
  const needle = query?.trim().toLowerCase()
  const schemas = resources
    .filter((item): item is Record<string, unknown> => {
      return Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    })
    .filter((item) => item.resourceType === 'template' || readString(item['@type'])?.includes('Template'))
    .map((item) => remoteSchemaSummary(item, normalizedProvider, local.profiles))
    .filter((item) => {
      if (!needle) {
        return true
      }
      return (
        item.name.toLowerCase().includes(needle) ||
        item.templateUrl.toLowerCase().includes(needle) ||
        item.conformsTo.toLowerCase().includes(needle)
      )
    })
  return { provider: normalizedProvider, schemas, storage: local.storage }
}

export async function getCedarPublicFolderId(
  provider: CedarProvider = defaultCedarProvider(),
): Promise<string> {
  const normalizedProvider = normalizeProvider(provider)
  const url = `${resourceBaseUrl(normalizedProvider)}/search?sharing=shared-with-everybody&publication_status=all&q=public&resource_types=folder&version=all`
  const fetched = await fetchJsonWithAuthFallback(url, normalizedProvider)
  const resources = Array.isArray((fetched as { resources?: unknown }).resources)
    ? ((fetched as { resources: unknown[] }).resources)
    : []
  const first = resources.find((item): item is Record<string, unknown> => {
    return Boolean(item) && typeof item === 'object' && !Array.isArray(item)
  })
  const id = first ? readString(first['@id']) ?? readString(first.id) : undefined
  if (!id) {
    throw new Error("Public folder's ID missing at /resources/0/@id.")
  }
  return id
}

export async function listCedarFolder(args: {
  provider?: CedarProvider
  folderId?: string
  rootPath?: string
}): Promise<{
  provider: CedarProvider
  storage: MetadataProfileStorage
  folderId: string
  resources: RemoteCedarResource[]
}> {
  const normalizedProvider = normalizeProvider(args.provider ?? defaultCedarProvider())
  const folderId = args.folderId ?? (await getCedarPublicFolderId(normalizedProvider))
  const url = `${resourceBaseUrl(normalizedProvider)}/folders/${encodeURIComponent(folderId)}/contents?limit=100&offset=0&publication_status=all&resource_types=template,folder&sort=name&version=all`
  const fetched = await fetchJsonWithAuthFallback(url, normalizedProvider)
  const resources = Array.isArray((fetched as { resources?: unknown }).resources)
    ? ((fetched as { resources: unknown[] }).resources)
    : []
  const local = listLocalProfiles(args.rootPath)
  return {
    provider: normalizedProvider,
    storage: local.storage,
    folderId,
    resources: resources
      .filter((item): item is Record<string, unknown> => {
        return Boolean(item) && typeof item === 'object' && !Array.isArray(item)
      })
      .map((item) => remoteCedarResource(item, local.profiles))
      .filter((item): item is RemoteCedarResource => item !== undefined)
      .filter((item) => item.name !== 'elements'),
  }
}

export async function importRemoteSchema(args: {
  provider?: CedarProvider
  templateIdOrUrl: string
  rootPath?: string
  conformsTo?: string
}): Promise<ImportResult> {
  const provider = normalizeProvider(args.provider ?? defaultCedarProvider())
  return importCedarTemplateFromUrl({
    url: args.templateIdOrUrl,
    provider,
    rootPath: args.rootPath,
    conformsTo: args.conformsTo,
  })
}

export async function deleteMetadataProfile(args: {
  id: string
  rootPath?: string
}): Promise<{ storage: MetadataProfileStorage; removed: MetadataProfileInfo | null }> {
  const storage = ensureProfileStorage(args.rootPath)
  const index = loadProfileIndex(args.rootPath)
  const removed = index.profiles.find((profile) => profile.id === args.id) ?? null
  if (!removed) {
    return { storage, removed: null }
  }
  index.profiles = index.profiles.filter((profile) => profile.id !== args.id)
  for (const relativePath of [removed.files?.sourcePath, removed.files?.convertedPath]) {
    if (!relativePath) {
      continue
    }
    const absolutePath = path.join(storage.rootPath, relativePath)
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath)
    }
  }
  saveProfileIndex(index, args.rootPath)
  return { storage, removed }
}

export function defaultCedarProvider(): CedarProvider {
  return {
    id: 'arp-prod',
    title: 'ARP Prod',
    displayUrl: 'https://cedar.schema.researchdata.hu/',
    domainBase: 'schema.researchdata.hu',
    resourceBaseUrl: 'https://resource.schema.researchdata.hu',
    registryFolderId: DEFAULT_REGISTRY_FOLDER,
  }
}

export function defaultCedarProviders(): CedarProvider[] {
  return [defaultCedarProvider()]
}

export async function loadCedarProviders(rootPath?: string): Promise<CedarProviderListResult> {
  const storage = ensureProfileStorage(rootPath)
  const configFileName =
    process.env.AROMA_REMOTE_SCHEMA_PROVIDER_CONFIG_FILE ||
    DEFAULT_REMOTE_PROVIDER_CONFIG_FILENAME
  const keytarService =
    process.env.AROMA_REMOTE_SCHEMA_PROVIDER_KEYTAR_SERVICE ||
    DEFAULT_REMOTE_PROVIDER_KEYTAR_SERVICE
  const configPath = path.isAbsolute(configFileName)
    ? configFileName
    : path.join(storage.rootPath, configFileName)
  const warnings: string[] = []
  let configuredProviders: CedarProvider[] = []

  if (fs.existsSync(configPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown
      const rawProviders = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { providers?: unknown }).providers)
          ? (parsed as { providers: unknown[] }).providers
          : []
      configuredProviders = rawProviders
        .map((item) => normalizeConfiguredProvider(item))
        .filter((item): item is CedarProvider => Boolean(item))
    } catch (error) {
      warnings.push(`Failed to read CEDAR provider config ${configPath}: ${errorMessage(error)}`)
    }
  }

  const keytarCredentials = await loadKeytarCredentials(keytarService, warnings)
  const envApiKey = readEnvSecret('CEDAR_API_KEY') ?? readEnvSecret('AROMA_CEDAR_API_KEY')
  const providersByIdentity = new Map<string, CedarProvider>()

  for (const provider of defaultCedarProviders()) {
    const id = provider.id ?? 'arp-prod'
    addProviderByIdentity(providersByIdentity, {
      ...provider,
      apiKey: keytarCredentials.get(id) ?? envApiKey,
    })
  }

  for (const provider of configuredProviders) {
    const normalized = normalizeProvider(provider)
    const id = normalized.id ?? normalized.title ?? normalized.displayUrl ?? normalized.domainBase
    const providerEnvKey =
      id && readEnvSecret(`CEDAR_API_KEY_${id.replace(/[^a-z0-9]/gi, '_').toUpperCase()}`)
    addProviderByIdentity(providersByIdentity, {
      ...normalized,
      apiKey: keytarCredentials.get(id ?? '') ?? provider.apiKey ?? providerEnvKey ?? envApiKey,
    })
  }

  return {
    storage,
    configPath,
    keytarService,
    providers: Array.from(providersByIdentity.values()),
    warnings,
  }
}

export async function saveCedarProvider(
  provider: CedarProvider,
  rootPath?: string,
): Promise<CedarProviderSaveResult> {
  const storage = ensureProfileStorage(rootPath)
  const current = await loadCedarProviders(rootPath)
  const normalized = normalizeProvider(provider)
  if (!normalized.id || !normalized.title || !normalized.displayUrl || !normalized.domainBase) {
    throw new Error('Provider id, title, base URL and domain base are required.')
  }

  const providers = current.providers.filter((existing) => existing.id !== normalized.id)
  providers.push(normalized)
  await writeConfiguredCedarProviders(providers, storage.rootPath, current.configPath)

  if (provider.apiKey) {
    const stored = await setKeytarPassword(current.keytarService, normalized.id, provider.apiKey, current.warnings)
    if (!stored) {
      current.warnings.push(
        `API key for ${normalized.title} was not stored because keytar is unavailable. Set CEDAR_API_KEY_${normalized.id.replace(/[^a-z0-9]/gi, '_').toUpperCase()} for standalone use.`,
      )
    }
  }

  const reloaded = await loadCedarProviders(rootPath)
  return { ...reloaded, saved: normalized }
}

export async function deleteCedarProvider(
  id: string,
  rootPath?: string,
): Promise<CedarProviderListResult & { deleted: boolean }> {
  const current = await loadCedarProviders(rootPath)
  const remaining = current.providers.filter((provider) => provider.id !== id)
  const deleted = remaining.length !== current.providers.length
  await writeConfiguredCedarProviders(remaining, current.storage.rootPath, current.configPath)
  if (deleted) {
    await deleteKeytarPassword(current.keytarService, id, current.warnings)
  }
  const reloaded = await loadCedarProviders(rootPath)
  return { ...reloaded, deleted }
}

export function deriveConformsToFromId(schemaId: string): string {
  const prodPrefix = process.env.ARP_PROD_PREFIX || DEFAULT_ARP_PROD_PREFIX
  const devPrefix = process.env.ARP_DEV_PREFIX || DEFAULT_ARP_DEV_PREFIX
  const prodW3id = process.env.ARP_W3ID_PROD || DEFAULT_ARP_W3ID_PROD
  const devW3id = process.env.ARP_W3ID_DEV || DEFAULT_ARP_W3ID_DEV
  if (schemaId.startsWith(prodPrefix)) {
    return prodW3id + schemaId.substring(prodPrefix.length)
  }
  if (schemaId.startsWith(devPrefix)) {
    return devW3id + schemaId.substring(devPrefix.length)
  }
  return schemaId
}

export function isCedarLikeUrl(url: string): boolean {
  return (
    /^https?:\/\//.test(url) &&
    (url.includes('/schema/') ||
      url.includes('/templates/') ||
      url.includes('/artifacts/') ||
      url.includes('repo.schema.researchdata.hu') ||
      url.includes('repo.cedardev.dsd.sztaki.hu') ||
      url.includes('cedar.schema.researchdata.hu'))
  )
}

function hasLocalProfileForConformsTo(conformsTo: string, rootPath?: string): boolean {
  const index = loadProfileIndex(rootPath)
  if ((index.conformsToIndex[conformsTo] ?? []).length > 0) {
    return true
  }
  return index.profiles.some(
    (profile) => profile.conformsTo === conformsTo || profile.aux?.reference === conformsTo,
  )
}

async function convertCedarTemplate(rawContent: string): Promise<string> {
  const importEsm = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<ConverterModule>
  const mod = await importEsm('cedar-template-converter')
  const converter = new mod.CedarTemplateToDescriboProfileConverter()
  return converter.processCedarTemplate(rawContent)
}

function resolveTemplateFetchUrl(urlOrId: string, provider?: CedarProvider): string {
  const value = urlOrId.trim()
  if (value.startsWith(DEFAULT_ARP_W3ID_PROD)) {
    return `${DEFAULT_ARP_PROD_PREFIX}${value.substring(DEFAULT_ARP_W3ID_PROD.length)}`
  }
  if (value.startsWith(DEFAULT_ARP_W3ID_DEV)) {
    return `${DEFAULT_ARP_DEV_PREFIX}${value.substring(DEFAULT_ARP_W3ID_DEV.length)}`
  }
  if (/^https?:\/\//.test(value)) {
    return value
  }
  const normalizedProvider = normalizeProvider(provider ?? defaultCedarProvider())
  const repoPrefix =
    normalizedProvider.domainBase === 'cedardev.dsd.sztaki.hu'
      ? DEFAULT_ARP_DEV_PREFIX
      : DEFAULT_ARP_PROD_PREFIX
  return `${repoPrefix}${value}`
}

async function fetchTextWithAuthFallback(
  inputUrl: string,
  provider?: CedarProvider,
): Promise<{ content: string; finalUrl: string }> {
  const normalizedProvider = normalizeProvider(provider ?? pickProviderForUrl(inputUrl))
  const candidates = unique([
    inputUrl,
    toResourceTemplateUrl(inputUrl, normalizedProvider),
    inputUrl.includes('openview.') ? inputUrl.replace('openview.', 'open.') : '',
    inputUrl.includes('/artifacts/') ? inputUrl.replace('/artifacts/', '/templates/') : '',
  ].filter((item) => item !== ''))

  let lastError: unknown
  for (const candidate of candidates) {
    try {
      const response = await fetchWithOptionalAuth(candidate, normalizedProvider)
      const content = await response.text()
      JSON.parse(content)
      return { content, finalUrl: response.url }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function fetchJsonWithAuthFallback(url: string, provider: CedarProvider): Promise<unknown> {
  const response = await fetchWithOptionalAuth(url, provider)
  return response.json() as Promise<unknown>
}

async function fetchWithOptionalAuth(url: string, provider: CedarProvider): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  let response = await fetch(url, { headers })
  if ((response.status === 400 || response.status === 401 || response.status === 403) && provider.apiKey) {
    response = await fetch(url, {
      headers: {
        ...headers,
        Authorization: `apiKey ${provider.apiKey}`,
      },
    })
  }
  if (!response.ok) {
    const authHint =
      response.status === 400 || response.status === 401 || response.status === 403
        ? provider.apiKey
          ? 'configured API key was rejected'
          : 'configure a CEDAR provider API key'
        : response.status === 404
          ? 'resource not found'
          : response.statusText
    throw new Error(`Fetch failed for ${url}: HTTP ${response.status} (${authHint}).`)
  }
  return response
}

function toResourceTemplateUrl(inputUrl: string, provider: CedarProvider): string {
  if (inputUrl.includes('/templates/') && inputUrl.includes('resource.')) {
    return inputUrl
  }
  const normalized = resolveTemplateFetchUrl(inputUrl, provider)
  return `${resourceBaseUrl(provider)}/templates/${encodeURIComponent(normalized)}`
}

function resourceBaseUrl(provider: CedarProvider): string {
  if (provider.resourceBaseUrl) {
    return provider.resourceBaseUrl.replace(/\/+$/, '')
  }
  const domain = provider.domainBase ?? 'schema.researchdata.hu'
  return `https://resource.${domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`
}

function normalizeProvider(provider: CedarProvider): CedarProvider {
  const defaults = defaultCedarProvider()
  return {
    ...defaults,
    ...provider,
    id: provider.id ?? defaults.id,
    title: provider.title ?? provider.id ?? defaults.title,
    displayUrl: provider.displayUrl ?? provider.baseUrl ?? defaults.displayUrl,
    resourceBaseUrl: provider.resourceBaseUrl ?? resourceBaseUrl(provider),
  }
}

function normalizeConfiguredProvider(value: unknown): CedarProvider | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  const id = readString(record.id)
  const title = readString(record.title) ?? id
  const baseUrl = readString(record.baseUrl) ?? readString(record.displayUrl)
  const domainBase = readString(record.domainBase)
  if (!id || !title || (!baseUrl && !domainBase)) {
    return undefined
  }
  return {
    id,
    title,
    baseUrl,
    displayUrl: baseUrl,
    domainBase,
    resourceBaseUrl: readString(record.resourceBaseUrl),
    registryFolderId: readString(record.registryFolderId) ?? DEFAULT_REGISTRY_FOLDER,
    type: readString(record.type),
    apiKey: readString(record.apiKey),
  }
}

function addProviderByIdentity(providers: Map<string, CedarProvider>, provider: CedarProvider): void {
  const normalized = normalizeProvider(provider)
  const key = providerIdentity(normalized)
  const current = providers.get(key)
  if (!current) {
    providers.set(key, normalized)
    return
  }
  providers.set(key, {
    ...current,
    ...normalized,
    id: current.id === 'arp-prod' && normalized.apiKey ? normalized.id : current.id,
    title: normalized.title ?? current.title,
    apiKey: normalized.apiKey ?? current.apiKey,
  })
}

function providerIdentity(provider: CedarProvider): string {
  const displayHost = safeHost(provider.displayUrl ?? provider.baseUrl ?? '')
  const resourceHost = safeHost(provider.resourceBaseUrl ?? '')
  const domain = (provider.domainBase ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return (displayHost || resourceHost || domain || provider.id || '').toLowerCase()
}

async function writeConfiguredCedarProviders(
  providers: CedarProvider[],
  rootPath: string,
  configPath: string,
): Promise<void> {
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  const defaultKey = providerIdentity(defaultCedarProvider())
  const safeProviders = providers
    .filter((provider) => providerIdentity(provider) !== defaultKey || provider.id !== 'arp-prod')
    .map((provider) => ({
      id: provider.id,
      title: provider.title,
      baseUrl: provider.displayUrl ?? provider.baseUrl,
      domainBase: provider.domainBase,
      type: provider.type ?? 'CEDAR',
      ...(provider.resourceBaseUrl ? { resourceBaseUrl: provider.resourceBaseUrl } : {}),
      ...(provider.registryFolderId ? { registryFolderId: provider.registryFolderId } : {}),
    }))
  writeJsonAtomic(configPath, safeProviders, 4)
}

async function loadKeytarCredentials(
  service: string,
  warnings: string[],
): Promise<Map<string, string>> {
  const credentials = new Map<string, string>()
  const keytar = await loadKeytarModule(service, warnings)
  if (!keytar) {
    return credentials
  }
  if (typeof keytar.findCredentials !== 'function') {
    warnings.push('keytar is installed but does not expose findCredentials.')
    return credentials
  }
  try {
    const storedCredentials = await keytar.findCredentials(service)
    for (const credential of storedCredentials) {
      if (credential.account && credential.password) {
        credentials.set(credential.account, credential.password)
      }
    }
  } catch (error) {
    warnings.push(`Secure CEDAR provider credentials were not loaded from keytar service ${service}: ${errorMessage(error)}`)
  }
  return credentials
}

async function setKeytarPassword(
  service: string,
  account: string,
  password: string,
  warnings: string[],
): Promise<boolean> {
  const keytar = await loadKeytarModule(service, warnings)
  if (!keytar?.setPassword) {
    return false
  }
  try {
    await keytar.setPassword(service, account, password)
    return true
  } catch (error) {
    warnings.push(`Failed to store CEDAR provider API key in keytar: ${errorMessage(error)}`)
    return false
  }
}

async function deleteKeytarPassword(
  service: string,
  account: string,
  warnings: string[],
): Promise<boolean> {
  const keytar = await loadKeytarModule(service, warnings)
  if (!keytar?.deletePassword) {
    return false
  }
  try {
    await keytar.deletePassword(service, account)
    return true
  } catch (error) {
    warnings.push(`Failed to delete CEDAR provider API key from keytar: ${errorMessage(error)}`)
    return false
  }
}

async function loadKeytarModule(
  service: string,
  warnings: string[],
): Promise<
  | {
      findCredentials?: (service: string) => Promise<{ account: string; password: string }[]>
      setPassword?: (service: string, account: string, password: string) => Promise<void>
      deletePassword?: (service: string, account: string) => Promise<boolean>
    }
  | undefined
> {
  try {
    const importEsm = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<{ default?: unknown; findCredentials?: unknown }>
    const mod = await importEsm('keytar')
    return (mod.default ?? mod) as {
      findCredentials?: (service: string) => Promise<{ account: string; password: string }[]>
      setPassword?: (service: string, account: string, password: string) => Promise<void>
      deletePassword?: (service: string, account: string) => Promise<boolean>
    }
  } catch (error) {
    if (!isMissingOptionalModule(error)) {
      warnings.push(
        `Secure CEDAR provider credentials were not available from keytar service ${service}: ${errorMessage(error)}`,
      )
    }
    return undefined
  }
}

function isMissingOptionalModule(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const record = error as { code?: unknown; message?: unknown }
  const code = typeof record.code === 'string' ? record.code : ''
  const message = typeof record.message === 'string' ? record.message : ''
  return (
    code === 'ERR_MODULE_NOT_FOUND' ||
    code === 'MODULE_NOT_FOUND' ||
    message.includes('Cannot find package')
  )
}

function readEnvSecret(name: string): string | undefined {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function pickProviderForUrl(url: string, providers?: CedarProvider[]): CedarProvider {
  const available = providers && providers.length > 0 ? providers : defaultCedarProviders()
  const match = available.find((provider) => {
    const host = safeHost(url)
    const providerHost = safeHost(provider.displayUrl ?? provider.resourceBaseUrl ?? '')
    const domain = provider.domainBase ?? ''
    return Boolean(host && (host.includes(domain) || providerHost === host))
  })
  return normalizeProvider(match ?? available[0] ?? defaultCedarProvider())
}

function remoteSchemaSummary(
  item: Record<string, unknown>,
  provider: CedarProvider,
  localProfiles: MetadataProfileInfo[],
): RemoteSchemaSummary {
  const id = readString(item['@id']) ?? readString(item.id) ?? ''
  const name = readString(item['schema:name']) ?? readString(item.name) ?? id
  const version = readString(item['pav:version']) ?? readString(item.version)
  const description = readString(item['schema:description']) ?? readString(item.description)
  const conformsTo = deriveConformsToFromId(id)
  return {
    providerId: provider.id ?? 'arp-prod',
    providerTitle: provider.title ?? 'ARP Prod',
    id,
    name,
    version,
    description,
    templateUrl: id,
    conformsTo,
    alreadyImported: localProfiles.some(
      (profile) => profile.conformsTo === conformsTo || profile.aux?.reference === id,
    ),
  }
}

function remoteCedarResource(
  item: Record<string, unknown>,
  localProfiles: MetadataProfileInfo[],
): RemoteCedarResource | undefined {
  const resourceType = readString(item.resourceType)?.toLowerCase()
  if (resourceType !== 'folder' && resourceType !== 'template') {
    return undefined
  }
  const id = readString(item['@id']) ?? readString(item.id)
  if (!id) {
    return undefined
  }
  const name = readString(item['schema:name']) ?? readString(item.name) ?? id
  const conformsTo = resourceType === 'template' ? deriveConformsToFromId(id) : undefined
  return {
    id,
    name,
    resourceType,
    conformsTo,
    alreadyImported:
      resourceType === 'template' &&
      localProfiles.some(
        (profile) => profile.conformsTo === conformsTo || profile.aux?.reference === id,
      ),
  }
}

function writeJsonAtomic(filePath: string, value: unknown, indent: number): void {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, indent)}\n`, 'utf8')
  fs.renameSync(tmpPath, filePath)
}

function createShortHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').substring(0, 8)
}

function createId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : createShortHash(`${Date.now()}:${Math.random()}`)
}

function extractUuid(value: string): string | undefined {
  return value.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i)?.[0]
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

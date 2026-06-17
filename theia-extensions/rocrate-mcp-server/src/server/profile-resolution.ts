import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type {
  ContextMode,
  ProfileContextRecord,
  ProfileRequiredMode,
  ProfileResolution,
  ProfileResolutionInputs,
  ResolvedProfile,
  SchemaIndexDocument,
  SchemaIndexProfile,
} from './types'
import type { RoCrate } from '../core/types'

type ProfileContextStoreLike = {
  parseProfileContextId: (value: unknown) => string | undefined
  parseTtlSec: (value: unknown) => number
  summarize: (record: ProfileContextRecord) => Record<string, unknown>
  getOrThrow: (profileContextId: string) => ProfileContextRecord
  put: (
    payload: {
      profileUrls: string[]
      unresolvedUrls: string[]
      warnings: string[]
      schemaIndex: SchemaIndexDocument
      profileContents: Record<string, Record<string, unknown>>
    },
    ttlSec: number,
  ) => ProfileContextRecord
  deleteById: (profileContextId: string) => Record<string, unknown>
}

type ProfileResolutionDeps = {
  rocrateConformsToUrl: string
  defaultSchemaIndexFilename: string
  uniqueStrings: (values: string[]) => string[]
  profileContext: ProfileContextStoreLike
  loadCrateFromParams: (params: Record<string, unknown>) => {
    mode: 'local' | 'remote'
    crate: RoCrate
    cratePath?: string
  }
  collectProfileUrls: (crate: RoCrate) => string[]
}

/**
 * Builds helpers for resolving RO-Crate profile metadata from local files,
 * inline payloads, or cached profile contexts.
 */
export function createProfileResolutionHelpers(deps: ProfileResolutionDeps) {
  /**
   * Handles resolve aroma root path.
   */
  function resolveRockitRootPath(): string {
    const configuredRoot = process.env.ROCKIT_ROOT_PATH
    if (configuredRoot && configuredRoot.trim() !== '') {
      return path.resolve(configuredRoot)
    }
    return path.join(os.homedir(), '.rockit')
  }

  /**
   * Handles resolve schema index path.
   */
  function resolveSchemaIndexPath(): { rootPath: string; indexPath: string } {
    const rootPath = resolveRockitRootPath()
    const configuredIndex =
      process.env.ROCKIT_METADATA_SCHEMA_INDEX_FILE
    if (!configuredIndex || configuredIndex.trim() === '') {
      return { rootPath, indexPath: path.join(rootPath, deps.defaultSchemaIndexFilename) }
    }
    if (path.isAbsolute(configuredIndex)) {
      return { rootPath: path.dirname(configuredIndex), indexPath: configuredIndex }
    }
    return { rootPath, indexPath: path.join(rootPath, configuredIndex) }
  }

  /**
   * Handles as schema index.
   */
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

  /**
   * Handles parse profile contents map.
   */
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

  /**
   * Handles parse profile context id.
   */
  function parseProfileContextId(value: unknown): string | undefined {
    return deps.profileContext.parseProfileContextId(value)
  }

  /**
   * Handles parse ttl sec.
   */
  function parseTtlSec(value: unknown): number {
    return deps.profileContext.parseTtlSec(value)
  }

  /**
   * Handles summarize profile context.
   */
  function summarizeProfileContext(record: ProfileContextRecord): Record<string, unknown> {
    return deps.profileContext.summarize(record)
  }

  /**
   * Handles get profile context or throw.
   */
  function getProfileContextOrThrow(profileContextId: string): ProfileContextRecord {
    return deps.profileContext.getOrThrow(profileContextId)
  }

  /**
   * Handles store profile context.
   */
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
    return deps.profileContext.put(payload, ttlSec)
  }

  /**
   * Collects schema/profile inputs from params.
   *
   * Resolution precedence:
   * 1. `profileContextId` payload
   * 2. inline `schemaIndex`
   * 3. inline `profileContents`
   */
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

  /**
   * Handles parse profile required mode.
   */
  function parseProfileRequiredMode(
    params: Record<string, unknown>,
    defaultMode: ProfileRequiredMode,
  ): ProfileRequiredMode {
    return params.profileRequiredMode === 'enforce_required'
      ? 'enforce_required'
      : defaultMode
  }

  /**
   * Handles parse context mode.
   */
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

  /**
   * Loads schema index JSON from disk.
   *
   * Returns an empty index plus warning when missing/invalid instead of throwing,
   * so callers can decide whether to fail hard or degrade gracefully.
   */
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

  /**
   * Loads one converted profile JSON and reports load state/errors inline.
   *
   * If `includeProfileContent` is false, only metadata/status fields are returned.
   */
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

  /**
   * Resolves `conformsTo` URLs to concrete profile rule documents.
   *
   * - Local mode: uses schema index + converted profile files from disk.
   * - Remote mode: requires caller-provided schema/profile payloads.
   *
   * Always returns unresolved URLs and non-fatal warnings for partial resolution.
   */
  function resolveProfileUrls(
    profileUrls: string[],
    mode: 'local' | 'remote',
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

    /**
     * Finds inline profile content by candidate keys (profile id, URL, convertedPath).
     */
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
        warnings: deps.uniqueStrings(warnings),
      }
    }

    const loaded = loadSchemaIndexFromDisk()
    const index = inputs.schemaIndex ?? loaded.index
    const indexPath = loaded.indexPath
    const rootPath = loaded.rootPath
    const warnings = loaded.warning ? [loaded.warning] : []

    const profilesById = new Map<string, SchemaIndexProfile>()
    for (const profile of index.profiles) {
      if (typeof profile.id === 'string' && profile.id.trim() !== '') {
        profilesById.set(profile.id, profile)
      }
    }

    const unresolvedUrls: string[] = []
    const resolvedProfiles: ResolvedProfile[] = []
    for (const profileUrl of profileUrls) {
      const profileIds = index.conformsToIndex[profileUrl]
      if (!profileIds || profileIds.length === 0) {
        unresolvedUrls.push(profileUrl)
        continue
      }
      for (const profileId of profileIds) {
        if (resolvedProfiles.some((profile) => profile.id === profileId)) {
          continue
        }
        const profileRecord = profilesById.get(profileId)
        if (!profileRecord) {
          resolvedProfiles.push({
            id: profileId,
            conformsTo: profileUrl,
            loaded: false,
            loadError: `Profile id from index not found in profiles list: ${profileId}`,
          })
          continue
        }
        const loadedProfile = loadConvertedProfile(
          profileRecord,
          rootPath,
          includeProfileContent,
        )
        if (!loadedProfile.conformsTo) {
          loadedProfile.conformsTo = profileUrl
        }
        resolvedProfiles.push(loadedProfile)
      }
    }

    return {
      mode,
      inputProvided: mode === 'local' ? true : hasInlineInputs,
      profileContextId: inputs.profileContextId,
      profileUrls,
      unresolvedUrls,
      profiles: resolvedProfiles,
      indexPath,
      rockitRootPath: rootPath,
      warnings: deps.uniqueStrings(warnings),
    }
  }

  /**
   * Handles read profile urls from params.
   */
  function readProfileUrlsFromParams(params: Record<string, unknown>): string[] {
    if (!Array.isArray(params.profileUrls)) {
      return []
    }
    return deps.uniqueStrings(
      params.profileUrls
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item !== '' && item !== deps.rocrateConformsToUrl),
    )
  }

  /**
   * Builds a transport-safe profile payload for remote calls.
   *
   * If profile URLs are not provided, they are discovered from the local crate.
   * The payload contains `schemaIndex` + `profileContents` keyed by id/URL/path.
   */
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
      const loaded = deps.loadCrateFromParams({ ...params, mode: 'local' })
      profileUrls = deps.collectProfileUrls(loaded.crate)
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
        conformsToIndex[profileUrl] = deps.uniqueStrings(ids)
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

  /**
   * Handles prepare remote profile payload.
   */
  function prepareRemoteProfilePayload(
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    return collectRemoteProfilePayload(params)
  }

  /**
   * Handles create profile context.
   */
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

  /**
   * Handles get profile context info.
   */
  function getProfileContextInfo(params: Record<string, unknown>): Record<string, unknown> {
    const profileContextId = parseProfileContextId(params.profileContextId)
    if (!profileContextId) {
      throw new Error('get_profile_context_info requires profileContextId.')
    }
    const record = getProfileContextOrThrow(profileContextId)
    return summarizeProfileContext(record)
  }

  /**
   * Handles delete profile context.
   */
  function deleteProfileContext(params: Record<string, unknown>): Record<string, unknown> {
    const profileContextId = parseProfileContextId(params.profileContextId)
    if (!profileContextId) {
      throw new Error('delete_profile_context requires profileContextId.')
    }
    return deps.profileContext.deleteById(profileContextId)
  }

  return {
    resolveRockitRootPath,
    resolveSchemaIndexPath,
    asSchemaIndex,
    parseProfileContentsMap,
    parseProfileContextId,
    parseTtlSec,
    summarizeProfileContext,
    getProfileContextOrThrow,
    storeProfileContext,
    parseProfileResolutionInputs,
    parseProfileRequiredMode,
    parseContextMode,
    loadSchemaIndexFromDisk,
    loadConvertedProfile,
    resolveProfileUrls,
    readProfileUrlsFromParams,
    collectRemoteProfilePayload,
    prepareRemoteProfilePayload,
    createProfileContext,
    getProfileContextInfo,
    deleteProfileContext,
  }
}

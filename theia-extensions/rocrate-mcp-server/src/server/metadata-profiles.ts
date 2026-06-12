import * as fs from 'node:fs'
import {
  defaultCedarProvider,
  defaultCedarProviders,
  deleteMetadataProfile,
  importCedarTemplateContent,
  importCedarTemplateFromUrl,
  importRemoteSchema,
  listLocalProfiles,
  listRemoteSchemas,
  resolveMissingConformsToUrls,
  type CedarProvider,
} from 'metadata-profile-core'
import type { RoCrate } from '../core/types'

type MetadataProfilesDeps = {
  collectProfileUrls: (crate: RoCrate) => string[]
}

function parseProvider(params: Record<string, unknown>): CedarProvider | undefined {
  const raw = params.provider
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }
  const record = raw as Record<string, unknown>
  return {
    id: typeof record.id === 'string' ? record.id : undefined,
    title: typeof record.title === 'string' ? record.title : undefined,
    displayUrl: typeof record.displayUrl === 'string' ? record.displayUrl : undefined,
    domainBase: typeof record.domainBase === 'string' ? record.domainBase : undefined,
    resourceBaseUrl:
      typeof record.resourceBaseUrl === 'string' ? record.resourceBaseUrl : undefined,
    registryFolderId:
      typeof record.registryFolderId === 'string' ? record.registryFolderId : undefined,
    accessMode:
      record.accessMode === 'apiKey' || record.accessMode === 'dataverseProxy'
        ? record.accessMode
        : undefined,
    dataverseProxyBaseUrl:
      typeof record.dataverseProxyBaseUrl === 'string' ? record.dataverseProxyBaseUrl : undefined,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : undefined,
  }
}

function parseRootPath(params: Record<string, unknown>): string | undefined {
  return typeof params.rootPath === 'string' && params.rootPath.trim() !== ''
    ? params.rootPath.trim()
    : undefined
}

function parseProviders(params: Record<string, unknown>): CedarProvider[] {
  if (!Array.isArray(params.providers)) {
    const provider = parseProvider(params)
    return provider ? [provider] : defaultCedarProviders()
  }
  const providers = params.providers
    .map((entry) => parseProvider({ provider: entry }))
    .filter((entry): entry is CedarProvider => Boolean(entry))
  return providers.length > 0 ? providers : defaultCedarProviders()
}

export function createMetadataProfileHandlers(deps: MetadataProfilesDeps) {
  async function resolveMissingMetadataProfiles(
    crate: RoCrate,
    mode: 'local' | 'remote',
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown> | undefined> {
    if (mode !== 'local') {
      return undefined
    }
    const profileUrls = deps.collectProfileUrls(crate)
    if (profileUrls.length === 0) {
      return undefined
    }
    return resolveMissingConformsToUrls({
      profileUrls,
      rootPath: parseRootPath(params),
      providers: parseProviders(params),
    })
  }

  async function listWellKnownSchemas(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const provider = parseProvider(params) ?? defaultCedarProvider()
    const query = typeof params.query === 'string' ? params.query : undefined
    const result = await listRemoteSchemas(provider, query, parseRootPath(params))
    return {
      provider: result.provider,
      storage: result.storage,
      count: result.schemas.length,
      schemas: result.schemas,
    }
  }

  async function importWellKnownSchema(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    let templateIdOrUrl =
      typeof params.templateIdOrUrl === 'string'
        ? params.templateIdOrUrl.trim()
        : typeof params.url === 'string'
          ? params.url.trim()
          : typeof params.conformsTo === 'string'
            ? params.conformsTo.trim()
            : ''
    const provider = parseProvider(params)
    if (templateIdOrUrl === '' && typeof params.name === 'string') {
      const query = params.name.trim()
      if (query !== '') {
        const remote = await listRemoteSchemas(provider ?? defaultCedarProvider(), query, parseRootPath(params))
        const lower = query.toLowerCase()
        const match =
          remote.schemas.find((schema) => schema.name.toLowerCase() === lower) ??
          remote.schemas[0]
        templateIdOrUrl = match?.templateUrl ?? ''
      }
    }
    if (templateIdOrUrl === '') {
      throw new Error('import_well_known_schema requires name, templateIdOrUrl, url, or conformsTo.')
    }
    const result = await importRemoteSchema({
      provider,
      templateIdOrUrl,
      rootPath: parseRootPath(params),
      conformsTo: typeof params.conformsTo === 'string' ? params.conformsTo : undefined,
    })
    return {
      imported: true,
      storage: result.storage,
      profile: result.profile,
      sourcePath: result.sourcePath,
      convertedPath: result.convertedPath,
      warnings: result.warnings,
    }
  }

  function listMetadataProfiles(params: Record<string, unknown>): Record<string, unknown> {
    const result = listLocalProfiles(parseRootPath(params))
    return {
      storage: result.storage,
      count: result.profiles.length,
      profiles: result.profiles,
    }
  }

  async function importMetadataProfile(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const rootPath = parseRootPath(params)
    if (typeof params.url === 'string' && params.url.trim() !== '') {
      const result = await importCedarTemplateFromUrl({
        url: params.url.trim(),
        rootPath,
        provider: parseProvider(params),
        conformsTo: typeof params.conformsTo === 'string' ? params.conformsTo : undefined,
      })
      return {
        imported: true,
        storage: result.storage,
        profile: result.profile,
        sourcePath: result.sourcePath,
        convertedPath: result.convertedPath,
        warnings: result.warnings,
      }
    }
    if (typeof params.sourcePath === 'string' && params.sourcePath.trim() !== '') {
      const rawContent = fs.readFileSync(params.sourcePath.trim(), 'utf8')
      const result = await importCedarTemplateContent({
        rawContent,
        source: 'local',
        rootPath,
        originalFileName: params.sourcePath.trim(),
        conformsTo: typeof params.conformsTo === 'string' ? params.conformsTo : undefined,
      })
      return {
        imported: true,
        storage: result.storage,
        profile: result.profile,
        sourcePath: result.sourcePath,
        convertedPath: result.convertedPath,
        warnings: result.warnings,
      }
    }
    throw new Error('import_metadata_profile requires url or sourcePath.')
  }

  async function deleteMetadataProfileTool(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (params.confirmDestructive !== true) {
      throw new Error('delete_metadata_profile requires confirmDestructive=true.')
    }
    const id = typeof params.id === 'string' ? params.id.trim() : ''
    if (id === '') {
      throw new Error('delete_metadata_profile requires id.')
    }
    const result = await deleteMetadataProfile({ id, rootPath: parseRootPath(params) })
    return {
      deleted: Boolean(result.removed),
      storage: result.storage,
      removed: result.removed,
    }
  }

  return {
    resolveMissingMetadataProfiles,
    listWellKnownSchemas,
    importWellKnownSchema,
    listMetadataProfiles,
    importMetadataProfile,
    deleteMetadataProfileTool,
  }
}

import { injectable } from 'inversify'
import {
  deleteCedarProvider,
  deleteMetadataProfile,
  importCedarTemplateContent,
  importCedarTemplateFromUrl,
  importRemoteSchema,
  listCedarFolder,
  listLocalProfiles,
  listRemoteSchemas,
  loadCedarProviders,
  resolveMissingConformsToUrls,
  saveCedarProvider,
  type CedarProvider,
} from 'metadata-profile-core'
import {
  MetadataProfileCoreProviderListResult,
  MetadataProfileCoreService,
} from '../common/metadata-profile-core-protocol'

@injectable()
export class MetadataProfileCoreServiceImpl implements MetadataProfileCoreService {
  async listProfiles() {
    const listing = listLocalProfiles()
    return {
      storage: listing.storage,
      profiles: listing.profiles,
    }
  }

  async importContent(args: {
    rawContent: string
    source: 'local' | 'remote'
    originalFileName?: string
    conformsTo?: string
    downloadUrl?: string
  }) {
    return importCedarTemplateContent(args)
  }

  async importFromUrl(args: { url: string; conformsTo?: string; provider?: CedarProvider }) {
    return importCedarTemplateFromUrl(args)
  }

  async importRemoteSchema(args: {
    templateIdOrUrl: string
    conformsTo?: string
    provider?: CedarProvider
  }) {
    return importRemoteSchema(args)
  }

  async resolveMissingConformsToUrls(urls: string[]) {
    const providers = (await loadCedarProviders()).providers
    return resolveMissingConformsToUrls({ profileUrls: urls, providers })
  }

  async deleteProfile(id: string): Promise<{ deleted: boolean }> {
    const result = await deleteMetadataProfile({ id })
    return { deleted: Boolean(result.removed) }
  }

  async listProviders(): Promise<MetadataProfileCoreProviderListResult> {
    return this.providerList()
  }

  async saveProvider(provider: CedarProvider): Promise<MetadataProfileCoreProviderListResult> {
    await saveCedarProvider(provider)
    return this.providerList()
  }

  async deleteProvider(id: string): Promise<MetadataProfileCoreProviderListResult & { deleted: boolean }> {
    const result = await deleteCedarProvider(id)
    const listing = await this.providerList()
    return { ...listing, deleted: result.deleted }
  }

  async listRemoteFolder(args: { provider: CedarProvider; folderId?: string }) {
    const provider = await this.hydrateProvider(args.provider)
    const result = await listCedarFolder({ provider, folderId: args.folderId })
    return { folderId: result.folderId, resources: result.resources }
  }

  async testProviderConnection(provider: CedarProvider): Promise<string[]> {
    const hydrated = await this.hydrateProvider(provider)
    const result = await listRemoteSchemas(hydrated)
    return result.schemas.map((schema) => schema.name).slice(0, 10)
  }

  private async providerList(): Promise<MetadataProfileCoreProviderListResult> {
    const result = await loadCedarProviders()
    return {
      configPath: result.configPath,
      keytarService: result.keytarService,
      warnings: result.warnings,
      providers: result.providers.map((provider) => {
        const { apiKey, ...safeProvider } = provider
        return { ...safeProvider, apiKeyPresent: Boolean(apiKey) }
      }),
    }
  }

  private async hydrateProvider(provider: CedarProvider): Promise<CedarProvider> {
    if (provider.apiKey) {
      return provider
    }
    const providers = (await loadCedarProviders()).providers
    return providers.find((candidate) => candidate.id === provider.id) ?? provider
  }
}

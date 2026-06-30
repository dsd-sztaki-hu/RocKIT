import type {
  CedarProvider,
  ImportResult,
  MetadataProfileInfo,
  MetadataProfileStorage,
  RemoteCedarResource,
  ResolveMissingResult,
} from 'metadata-profile-core'

export const MetadataProfileCoreService = Symbol('MetadataProfileCoreService')
export const METADATA_PROFILE_CORE_PATH = '/services/metadata-profile-core'

export interface MetadataProfileCoreListResult {
  storage: MetadataProfileStorage
  profiles: MetadataProfileInfo[]
}

export interface MetadataProfileCoreProviderListResult {
  providers: Array<CedarProvider & { apiKeyPresent?: boolean }>
  configPath: string
  keytarService: string
  warnings: string[]
}

export interface MetadataProfileCoreService {
  listProfiles(): Promise<MetadataProfileCoreListResult>
  importContent(args: {
    rawContent: string
    source: 'local' | 'remote'
    originalFileName?: string
    conformsTo?: string
    downloadUrl?: string
  }): Promise<ImportResult>
  importFromUrl(args: {
    url: string
    conformsTo?: string
    provider?: CedarProvider
  }): Promise<ImportResult>
  importRemoteSchema(args: {
    templateIdOrUrl: string
    conformsTo?: string
    provider?: CedarProvider
  }): Promise<ImportResult>
  resolveMissingConformsToUrls(urls: string[]): Promise<ResolveMissingResult>
  deleteProfile(id: string): Promise<{ deleted: boolean }>
  listProviders(): Promise<MetadataProfileCoreProviderListResult>
  saveProvider(provider: CedarProvider): Promise<MetadataProfileCoreProviderListResult>
  deleteProvider(id: string): Promise<MetadataProfileCoreProviderListResult & { deleted: boolean }>
  listRemoteFolder(args: {
    provider: CedarProvider
    folderId?: string
  }): Promise<{ folderId: string; resources: RemoteCedarResource[] }>
  testProviderConnection(provider: CedarProvider): Promise<string[]>
}

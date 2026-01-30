export const MetadataSchemaManager = Symbol('MetadataSchemaManager')

export interface SchemaInfo {
  name: string
  version: string
  reference: string
  source: 'local' | 'remote'
  path: string
}

export interface MetadataSchemaManager {
  convertW3idUrlsToCedarTemplateUrls(w3idUrls: string[]): string[]
  loadAllSchemas(): Promise<SchemaInfo[]>
  getConvertedProfileContent(sourcePath: string): Promise<any>
  getMergedProfile(
    crate: Record<string, any>,
    newProfile: Record<string, any>,
    profile: Record<string, any>,
  ): Promise<Record<string, any>>
}

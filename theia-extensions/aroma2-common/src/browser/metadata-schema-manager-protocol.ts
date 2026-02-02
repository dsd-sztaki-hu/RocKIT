export const MetadataSchemaManager = Symbol('MetadataSchemaManager')

export interface SchemaInfo {
    name: string;
    version: string;
    source: 'local' | 'remote';
    reference: string; // This is the @id
    path: string;
    // New Fields for Metadata Tracking
    conformsTo?: string; 
    downloadUrl?: string;
}

export interface MetadataSchemaManager {
  // convertW3idUrlsToCedarTemplateUrls(w3idUrls: string[]): string[]
  // convertCedarTemplateUrlToW3idUrl(cedarTemplateUrl: string): string
  nameWithoutMetadataSuffix(name: string): string | null
  loadAllSchemas(): Promise<SchemaInfo[]>
  getConvertedProfileContent(sourcePath: string): Promise<any>
  getMergedProfile(
    crate: Record<string, any>,
    newProfile: Record<string, any>,
    profile: Record<string, any>,
    profileUrl?: string
  ): Promise<Record<string, any>>
}

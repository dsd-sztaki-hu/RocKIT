// theia-extensions/aroma2-common/src/common/metadata-schema-manager-protocol.ts

import type { Event } from '@theia/core/lib/common/event'

export const MetadataSchemaManager = Symbol('MetadataSchemaManager')

export interface SchemaFiles {
    sourcePath: string;
    convertedPath: string;
}

export interface SchemaAux {
    templateUuid?: string;
    reference: string;
}

export interface SchemaInfo {
    id: string; // Truly unique generated ID
    name: string;
    version: string;
    source: 'local' | 'remote';
    type: string;
    files: SchemaFiles;
    aux: SchemaAux;
    conformsTo?: string; 
    downloadUrl?: string;
    createdAt: string | null;
    updatedAt: string | null;
    downloadedAt: string;
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
  readonly onDidChangeSchemas: Event<void>
}
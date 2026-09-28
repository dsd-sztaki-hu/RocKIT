// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

// theia-extensions/rockit-common/src/common/metadata-schema-manager-protocol.ts

import type { Event } from '@theia/core/lib/common/event'

export const MetadataProfileManager = Symbol('MetadataProfileManager')

export interface ProfileFiles {
    sourcePath: string;
    convertedPath: string;
    convertedPaths?: Partial<Record<'en' | 'hu', string>>;
}

export interface ProfileAux {
    templateUuid?: string;
    reference: string;
    /** @deprecated Converted profiles are now stored once per language. */
    conversionLanguage?: 'en' | 'hu';
}

export interface ProfileInfo {
    id: string; // Truly unique generated ID
    name: string;
    version: string;
    source: 'local' | 'remote';
    type: string;
    files: ProfileFiles;
    aux: ProfileAux;
    conformsTo?: string; 
    downloadUrl?: string;
    createdAt: string | null;
    updatedAt: string | null;
    downloadedAt: string;
}

export interface MetadataProfileManager {
  // convertW3idUrlsToCedarTemplateUrls(w3idUrls: string[]): string[]
  // convertCedarTemplateUrlToW3idUrl(cedarTemplateUrl: string): string
  nameWithoutMetadataSuffix(name: string): string | null
  loadAllProfiles(): Promise<ProfileInfo[]>
  getConvertedProfileContent(sourcePath: string): Promise<any>
  getMergedProfile(
    crate: Record<string, any>,
    newProfile: Record<string, any>,
    profile: Record<string, any>,
    profileUrl?: string
  ): Promise<Record<string, any>>
  getMergedProfileForClass(
    newProfile: Record<string, any>,
    profile: Record<string, any>,
    className: string,
    profileUrl?: string
  ): Promise<Record<string, any>>
  readonly onDidChangeProfiles: Event<void>
}

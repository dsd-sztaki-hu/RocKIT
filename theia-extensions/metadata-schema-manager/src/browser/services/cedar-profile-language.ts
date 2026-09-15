// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

export type CedarProfileLanguage = 'en' | 'hu';

export type CedarConvertedProfilePaths = Partial<Record<CedarProfileLanguage, string>>;

export function toCedarProfileLanguage(locale: string | undefined): CedarProfileLanguage {
  const language = locale?.trim().toLowerCase().split(/[-_]/, 1)[0];
  return language === 'hu' ? 'hu' : 'en';
}

/**
 * Keeps the historic converted profile path as the canonical English file and
 * stores other languages in a sibling language directory.
 */
export function toLocalizedConvertedProfilePath(
  canonicalPath: string,
  language: CedarProfileLanguage,
): string {
  if (language === 'en') {
    return canonicalPath;
  }
  const separator = canonicalPath.lastIndexOf('/');
  if (separator < 0) {
    return `${language}/${canonicalPath}`;
  }
  return `${canonicalPath.slice(0, separator)}/${language}/${canonicalPath.slice(separator + 1)}`;
}

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import {
  toCedarProfileLanguage,
  toLocalizedConvertedProfilePath,
} from './cedar-profile-language';

describe('toCedarProfileLanguage', () => {
  it.each(['hu', 'HU', 'hu-HU', 'hu_HU'])(
    'maps %s to Hungarian',
    (locale) => {
      expect(toCedarProfileLanguage(locale)).toBe('hu');
    },
  );

  it.each([undefined, '', 'en', 'en-US', 'de'])(
    'maps %s to the English fallback',
    (locale) => {
      expect(toCedarProfileLanguage(locale)).toBe('en');
    },
  );
});

describe('toLocalizedConvertedProfilePath', () => {
  it('preserves the historic path for the canonical English profile', () => {
    expect(toLocalizedConvertedProfilePath('metadata-profiles/ro-crate/profile.json', 'en'))
      .toBe('metadata-profiles/ro-crate/profile.json');
  });

  it('places Hungarian profiles in a sibling language directory', () => {
    expect(toLocalizedConvertedProfilePath('metadata-profiles/ro-crate/profile.json', 'hu'))
      .toBe('metadata-profiles/ro-crate/hu/profile.json');
  });

  it('supports a file name without a directory', () => {
    expect(toLocalizedConvertedProfilePath('profile.json', 'hu'))
      .toBe('hu/profile.json');
  });
});

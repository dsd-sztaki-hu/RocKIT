// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { toRecrateLanguage } from './recrate-language'

describe('toRecrateLanguage', () => {
  it.each(['hu', 'HU', 'hu-HU', 'hu_HU'])(
    'maps %s to Hungarian',
    (locale) => {
      expect(toRecrateLanguage(locale)).toBe('hu')
    },
  )

  it.each([undefined, '', 'en', 'en-US', 'de'])(
    'maps %s to the English fallback',
    (locale) => {
      expect(toRecrateLanguage(locale)).toBe('en')
    },
  )
})

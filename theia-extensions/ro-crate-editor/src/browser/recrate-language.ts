// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

export type RecrateLanguage = 'en' | 'hu'

export function toRecrateLanguage(locale: string | undefined): RecrateLanguage {
  const language = locale?.trim().toLowerCase().split(/[-_]/, 1)[0]
  return language === 'hu' ? 'hu' : 'en'
}

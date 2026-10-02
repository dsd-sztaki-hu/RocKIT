// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import * as semver from 'semver'

export function normalizeVersion(value: string): string {
  const normalized = semver.clean(value.trim())
  if (!normalized) {
    throw new Error(`Invalid semantic version: ${value}`)
  }
  return normalized
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return semver.gt(normalizeVersion(candidate), normalizeVersion(current))
}

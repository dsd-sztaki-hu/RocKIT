// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { createHash } from 'node:crypto'
import type { ProfileContextRecord, SchemaIndexDocument } from './types'

type CreateProfileContextStoreOptions = {
  defaultTtlSec: number
  uniqueStrings: (values: string[]) => string[]
  createId: () => string
}

/**
 * Handles create profile context store.
 */
export function createProfileContextStore(options: CreateProfileContextStoreOptions) {
  const store = new Map<string, ProfileContextRecord>()

  /**
   * Handles parse profile context id.
   */
  function parseProfileContextId(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined
    }
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
  }

  /**
   * Handles parse ttl sec.
   */
  function parseTtlSec(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return options.defaultTtlSec
    }
    return Math.max(60, Math.min(86400, Math.floor(value)))
  }

  /**
   * Handles prune expired.
   */
  function pruneExpired(now = Date.now()): void {
    for (const [id, record] of store.entries()) {
      if (new Date(record.expiresAt).getTime() <= now) {
        store.delete(id)
      }
    }
  }

  /**
   * Handles summarize.
   */
  function summarize(record: ProfileContextRecord): Record<string, unknown> {
    return {
      profileContextId: record.id,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      profileUrls: record.profileUrls,
      unresolvedUrls: record.unresolvedUrls,
      warnings: record.warnings,
      profileIds: record.profileIds,
      profileCount: record.profileIds.length,
      profileContentEntryCount: Object.keys(record.profileContents).length,
      contentHash: record.contentHash,
    }
  }

  /**
   * Handles get or throw.
   */
  function getOrThrow(profileContextId: string): ProfileContextRecord {
    pruneExpired()
    const record = store.get(profileContextId)
    if (!record) {
      throw new Error(`Unknown or expired profileContextId: ${profileContextId}`)
    }
    return record
  }

  /**
   * Handles put.
   */
  function put(
    payload: {
      profileUrls: string[]
      unresolvedUrls: string[]
      warnings: string[]
      schemaIndex: SchemaIndexDocument
      profileContents: Record<string, Record<string, unknown>>
    },
    ttlSec: number,
  ): ProfileContextRecord {
    pruneExpired()
    const now = new Date()
    const contentHash = createHash('sha256')
      .update(
        JSON.stringify({
          schemaIndex: payload.schemaIndex,
          profileContents: payload.profileContents,
        }),
        'utf8',
      )
      .digest('hex')
    const profileIds = options.uniqueStrings(
      payload.schemaIndex.profiles
        .map((profile) => profile.id)
        .filter((id): id is string => typeof id === 'string' && id.trim() !== ''),
    )

    for (const existing of store.values()) {
      if (existing.contentHash === contentHash) {
        existing.expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString()
        return existing
      }
    }

    const record: ProfileContextRecord = {
      id: options.createId(),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSec * 1000).toISOString(),
      profileUrls: payload.profileUrls,
      unresolvedUrls: payload.unresolvedUrls,
      warnings: payload.warnings,
      schemaIndex: payload.schemaIndex,
      profileContents: payload.profileContents,
      profileIds,
      contentHash,
    }
    store.set(record.id, record)
    return record
  }

  /**
   * Handles get info or throw.
   */
  function getInfoOrThrow(profileContextId: string): Record<string, unknown> {
    return summarize(getOrThrow(profileContextId))
  }

  /**
   * Handles delete by id.
   */
  function deleteById(profileContextId: string): Record<string, unknown> {
    pruneExpired()
    const deleted = store.delete(profileContextId)
    return {
      profileContextId,
      deleted,
      remainingContextCount: store.size,
    }
  }

  return {
    parseProfileContextId,
    parseTtlSec,
    pruneExpired,
    summarize,
    getOrThrow,
    put,
    getInfoOrThrow,
    deleteById,
  }
}

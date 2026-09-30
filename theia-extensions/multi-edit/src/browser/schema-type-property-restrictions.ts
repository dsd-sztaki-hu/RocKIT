// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import schemaTypePropertyRestrictions = require('./schema-type-property-restrictions.json')

type SemanticBucket =
  | 'AgentLike'
  | 'RecordLike'
  | 'InstantiationLike'
  | 'EventLike'
  | 'PlaceLike'
  | 'ConceptLike'

interface PropertyRule {
  allowedBuckets?: SemanticBucket[]
  disallowedBuckets?: SemanticBucket[]
  allowForTypeHierarchy?: string[]
  disallowForTypeHierarchy?: string[]
}

interface FallbackRule {
  broadDomainType?: string
  allowFromBroadDomain?: string[]
}

interface PropertyRestrictionsConfig {
  bucketRules?: Record<SemanticBucket, string[]>
  propertyProfiles?: Record<string, PropertyRule>
  fallback?: FallbackRule
}

interface PropertyContext {
  sourceType?: string
  hierarchy?: string[]
  entityTypes?: string[]
}

const RESTRICTIONS = schemaTypePropertyRestrictions as PropertyRestrictionsConfig
const BUCKET_PRIORITY: SemanticBucket[] = [
  'AgentLike',
  'RecordLike',
  'InstantiationLike',
  'EventLike',
  'PlaceLike',
  'ConceptLike',
]

export function isSchemaOrgPropertyAllowedForHierarchy(
  propertyName: string,
  hierarchy: string[],
  context?: PropertyContext,
): boolean {
  if (!propertyName || hierarchy.length === 0) {
    return true
  }

  const normalizedHierarchy = new Set(
    hierarchy
      .map((typeName) => String(typeName ?? '').trim())
      .filter((typeName) => typeName.length > 0),
  )
  const entityTypes = Array.isArray(context?.entityTypes)
    ? context?.entityTypes ?? []
    : []
  for (const typeName of entityTypes) {
    const normalized = String(typeName ?? '').trim()
    if (normalized) {
      normalizedHierarchy.add(normalized)
    }
  }

  const inferredBucket = inferBucket(normalizedHierarchy)
  const profile = RESTRICTIONS.propertyProfiles?.[propertyName]

  if (profile) {
    const allowedTypes = Array.isArray(profile.allowForTypeHierarchy)
      ? profile.allowForTypeHierarchy
      : []
    if (
      allowedTypes.length > 0 &&
      !allowedTypes.some((typeName) => normalizedHierarchy.has(typeName))
    ) {
      return false
    }

    const disallowedTypes = Array.isArray(profile.disallowForTypeHierarchy)
      ? profile.disallowForTypeHierarchy
      : []
    if (disallowedTypes.some((typeName) => normalizedHierarchy.has(typeName))) {
      return false
    }

    const allowedBuckets = Array.isArray(profile.allowedBuckets)
      ? profile.allowedBuckets
      : []
    if (
      allowedBuckets.length > 0 &&
      (!inferredBucket || !allowedBuckets.includes(inferredBucket))
    ) {
      return false
    }

    const disallowedBuckets = Array.isArray(profile.disallowedBuckets)
      ? profile.disallowedBuckets
      : []
    if (inferredBucket && disallowedBuckets.includes(inferredBucket)) {
      return false
    }

    return true
  }

  const broadDomainType = String(RESTRICTIONS.fallback?.broadDomainType ?? '').trim()
  const sourceType = String(context?.sourceType ?? '').trim()
  if (broadDomainType && sourceType && sourceType === broadDomainType) {
    const allowedFromBroad = new Set(
      (RESTRICTIONS.fallback?.allowFromBroadDomain ?? [])
        .map((name) => String(name ?? '').trim())
        .filter((name) => name.length > 0),
    )
    if (!allowedFromBroad.has(propertyName)) {
      return false
    }
  }

  return true
}

function inferBucket(hierarchy: Set<string>): SemanticBucket | undefined {
  const bucketRules: Partial<Record<SemanticBucket, string[]>> =
    RESTRICTIONS.bucketRules ?? {}
  for (const bucket of BUCKET_PRIORITY) {
    const mappedTypes = Array.isArray(bucketRules[bucket])
      ? bucketRules[bucket] ?? []
      : []
    if (mappedTypes.some((typeName: string) => hierarchy.has(typeName))) {
      return bucket
    }
  }
  return undefined
}

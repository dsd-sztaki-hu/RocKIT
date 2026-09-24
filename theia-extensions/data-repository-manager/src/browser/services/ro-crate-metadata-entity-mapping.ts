// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

export type RoCrateEntityIdMapping = Record<string, string>

type RoCrate = Record<string, unknown>
type RoCrateEntity = Record<string, unknown>

/**
 * Extends an operational File/Dataset ID mapping with stable mappings for
 * metadata entities whose IDs may have been rewritten by a repository.
 *
 * Existing mappings and equal IDs take precedence. Remaining entities are
 * paired only when their type and non-reference metadata form a unique match
 * on both sides, so two otherwise identical people are never guessed apart.
 */
export function extendMappingWithMetadataEntities(
  localCrate: RoCrate,
  remoteCrate: RoCrate,
  existingMapping: RoCrateEntityIdMapping = {},
): RoCrateEntityIdMapping {
  const mapping = { ...existingMapping }
  const localEntities = graph(localCrate).filter(isMetadataEntity)
  const remoteEntities = graph(remoteCrate).filter(isMetadataEntity)
  const remoteById = new Map(remoteEntities.map(entity => [entityId(entity), entity]))
  const claimedRemoteIds = new Set<string>()
  const mappedLocalIds = new Set<string>()

  for (const localEntity of localEntities) {
    const localId = entityId(localEntity)
    const mappedId = mapping[localId]
    if (mappedId && remoteById.has(mappedId) && !claimedRemoteIds.has(mappedId)) {
      mappedLocalIds.add(localId)
      claimedRemoteIds.add(mappedId)
    }
  }

  for (const localEntity of localEntities) {
    const localId = entityId(localEntity)
    if (
      !mappedLocalIds.has(localId) &&
      remoteById.has(localId) &&
      !claimedRemoteIds.has(localId)
    ) {
      mapping[localId] = localId
      mappedLocalIds.add(localId)
      claimedRemoteIds.add(localId)
    }
  }

  const localBySignature = groupBySignature(
    localEntities.filter(entity => !mappedLocalIds.has(entityId(entity))),
  )
  const remoteBySignature = groupBySignature(
    remoteEntities.filter(entity => !claimedRemoteIds.has(entityId(entity))),
  )
  for (const [signature, localMatches] of localBySignature) {
    const remoteMatches = remoteBySignature.get(signature) ?? []
    if (localMatches.length !== 1 || remoteMatches.length !== 1) {
      continue
    }
    const localId = entityId(localMatches[0])
    const remoteId = entityId(remoteMatches[0])
    mapping[localId] = remoteId
    mappedLocalIds.add(localId)
    claimedRemoteIds.add(remoteId)
  }

  return Object.fromEntries(
    Object.entries(mapping).sort((a, b) => a[0].localeCompare(b[0])),
  )
}

function groupBySignature(entities: RoCrateEntity[]): Map<string, RoCrateEntity[]> {
  const groups = new Map<string, RoCrateEntity[]>()
  for (const entity of entities) {
    const signature = metadataEntitySignature(entity)
    groups.set(signature, [...(groups.get(signature) ?? []), entity])
  }
  return groups
}

function metadataEntitySignature(entity: RoCrateEntity): string {
  return JSON.stringify({
    type: entityTypes(entity).sort((a, b) => a.localeCompare(b)),
    values: meaningfulMetadataValues(entity),
  })
}

function meaningfulMetadataValues(entity: RoCrateEntity): Record<string, unknown> {
  const values = Object.entries(entity)
    .filter(([key, value]) =>
      key !== '@id' &&
      key !== '@type' &&
      key !== '@reverse' &&
      key !== 'url' &&
      !isEntityReferenceValue(value),
    )
    .map(([key, value]): [string, unknown] => [key, stableMetadataValue(value)])
    .sort((a, b) => a[0].localeCompare(b[0]))
  return Object.fromEntries(values)
}

function stableMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(item => stableMetadataValue(item))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  if (!isRecord(value)) {
    return value
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, child]) => key !== '@id' && !isEntityReferenceValue(child))
      .map(([key, child]): [string, unknown] => [key, stableMetadataValue(child)])
      .sort((a, b) => a[0].localeCompare(b[0])),
  )
}

function isEntityReferenceValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.every(item => isEntityReferenceValue(item))
  }
  return isRecord(value) && typeof value['@id'] === 'string' && Object.keys(value).length === 1
}

function isMetadataEntity(entity: RoCrateEntity): boolean {
  const id = entityId(entity)
  const types = entityTypes(entity)
  return (
    !!id &&
    id !== './' &&
    id !== 'ro-crate-metadata.json' &&
    !types.includes('Dataset') &&
    !types.includes('File')
  )
}

function entityTypes(entity: RoCrateEntity): string[] {
  const value = entity['@type']
  return (Array.isArray(value) ? value : [value]).filter(
    (type): type is string => typeof type === 'string',
  )
}

function entityId(entity: RoCrateEntity): string {
  return typeof entity['@id'] === 'string' ? entity['@id'] : ''
}

function graph(crate: RoCrate): RoCrateEntity[] {
  const value = crate['@graph']
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function isRecord(value: unknown): value is RoCrateEntity {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

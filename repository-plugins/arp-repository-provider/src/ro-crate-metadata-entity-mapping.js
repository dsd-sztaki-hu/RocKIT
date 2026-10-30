// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

function extendMappingWithMetadataEntities(localCrate, remoteCrate, existingMapping = {}) {
  const mapping = { ...existingMapping }
  const localEntities = graph(localCrate).filter(isMetadataEntity)
  const remoteEntities = graph(remoteCrate).filter(isMetadataEntity)
  const remoteById = new Map(remoteEntities.map(entity => [entityId(entity), entity]))
  const claimedRemoteIds = new Set()
  const mappedLocalIds = new Set()

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
    if (!mappedLocalIds.has(localId) && remoteById.has(localId) && !claimedRemoteIds.has(localId)) {
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
    const remoteMatches = remoteBySignature.get(signature) || []
    if (localMatches.length !== 1 || remoteMatches.length !== 1) continue
    const localId = entityId(localMatches[0])
    const remoteId = entityId(remoteMatches[0])
    mapping[localId] = remoteId
    mappedLocalIds.add(localId)
    claimedRemoteIds.add(remoteId)
  }

  return Object.fromEntries(
    Object.entries(mapping).sort(([left], [right]) => left.localeCompare(right)),
  )
}

function groupBySignature(entities) {
  const groups = new Map()
  for (const entity of entities) {
    const signature = metadataEntitySignature(entity)
    groups.set(signature, [...(groups.get(signature) || []), entity])
  }
  return groups
}

function metadataEntitySignature(entity) {
  return JSON.stringify({
    type: entityTypes(entity).sort((left, right) => left.localeCompare(right)),
    values: meaningfulMetadataValues(entity),
  })
}

function meaningfulMetadataValues(entity) {
  return Object.fromEntries(
    Object.entries(entity)
      .filter(([key, value]) =>
        key !== '@id' && key !== '@type' && key !== '@reverse' && key !== 'url' &&
        !isEntityReferenceValue(value))
      .map(([key, value]) => [key, stableMetadataValue(value)])
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function stableMetadataValue(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => stableMetadataValue(item))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  }
  if (!record(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, child]) => key !== '@id' && !isEntityReferenceValue(child))
      .map(([key, child]) => [key, stableMetadataValue(child)])
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function isEntityReferenceValue(value) {
  if (Array.isArray(value)) return value.every(item => isEntityReferenceValue(item))
  return record(value) && typeof value['@id'] === 'string' && Object.keys(value).length === 1
}

function isMetadataEntity(entity) {
  const id = entityId(entity)
  const types = entityTypes(entity)
  return !!id && id !== './' && id !== 'ro-crate-metadata.json' &&
    !types.includes('Dataset') && !types.includes('File')
}

function entityTypes(entity) {
  const value = entity['@type']
  return (Array.isArray(value) ? value : [value]).filter(type => typeof type === 'string')
}

function entityId(entity) {
  return typeof entity['@id'] === 'string' ? entity['@id'] : ''
}

function graph(crate) {
  return Array.isArray(crate?.['@graph']) ? crate['@graph'].filter(record) : []
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

module.exports = { extendMappingWithMetadataEntities }

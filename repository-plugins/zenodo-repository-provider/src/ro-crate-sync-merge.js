// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

function mergeRoCratesForSync(localCrate, remoteCrate, mode) {
  if (mode === 'complete') {
    return clone(remoteCrate)
  }
  return mode === 'remote-additions'
    ? retainAdditions(localCrate, remoteCrate)
    : retainAdditions(remoteCrate, localCrate)
}

function retainAdditions(baseCrate, additionsCrate) {
  const result = clone(baseCrate)
  result['@context'] = mergeContexts(baseCrate['@context'], additionsCrate['@context'])
  const resultGraph = graph(result)
  const additionsGraph = graph(additionsCrate)
  const resultById = new Map(resultGraph.map((entity) => [entityId(entity), entity]))
  const addedIds = new Set(
    additionsGraph.map(entityId).filter((id) => id && !resultById.has(id)),
  )

  for (const entity of additionsGraph) {
    const id = entityId(entity)
    if (id && addedIds.has(id)) {
      const added = clone(entity)
      resultGraph.push(added)
      resultById.set(id, added)
    }
  }
  for (const sourceEntity of additionsGraph) {
    const id = entityId(sourceEntity)
    const targetEntity = id ? resultById.get(id) : undefined
    if (!id || !targetEntity || addedIds.has(id)) continue
    for (const [property, sourceValue] of Object.entries(sourceEntity)) {
      if (property === '@id' || property === '@type') continue
      const newReferences = referenceValues(sourceValue).filter((reference) =>
        addedIds.has(reference['@id']),
      )
      if (newReferences.length) {
        targetEntity[property] = mergeReferenceValues(targetEntity[property], newReferences)
      }
    }
  }
  result['@graph'] = resultGraph
  return result
}

function mergeReferenceValues(current, additions) {
  const merged = Array.isArray(current)
    ? clone(current)
    : current === undefined || current === null
      ? []
      : [clone(current)]
  const ids = new Set(referenceValues(current).map((reference) => reference['@id']))
  for (const addition of additions) {
    if (!ids.has(addition['@id'])) {
      merged.push(clone(addition))
      ids.add(addition['@id'])
    }
  }
  return !Array.isArray(current) && (current === undefined || current === null) && merged.length === 1
    ? merged[0]
    : merged
}

function referenceValues(value) {
  return (Array.isArray(value) ? value : [value]).filter(
    (candidate) => record(candidate) && typeof candidate['@id'] === 'string',
  )
}

function mergeContexts(base, additions) {
  if (base === undefined) return clone(additions)
  if (additions === undefined) return clone(base)
  if (record(base) && record(additions)) return { ...clone(additions), ...clone(base) }
  const values = [...(Array.isArray(base) ? base : [base])]
  for (const value of Array.isArray(additions) ? additions : [additions]) {
    if (!values.some((existing) => JSON.stringify(existing) === JSON.stringify(value))) {
      values.push(clone(value))
    }
  }
  return values.length === 1 ? values[0] : values
}

function graph(crate) {
  return Array.isArray(crate?.['@graph']) ? crate['@graph'].filter(record) : []
}

function entityId(entity) {
  return typeof entity['@id'] === 'string' ? entity['@id'] : ''
}

function record(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

module.exports = { mergeRoCratesForSync }

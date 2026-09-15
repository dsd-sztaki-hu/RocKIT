// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { RepositorySyncMode } from '../types'

export type SyncRoCrate = Record<string, unknown>
type RoCrateEntity = Record<string, unknown>

/**
 * Combines already-localized RO-Crates according to the selected sync policy.
 * Shared entities always come from the base side. Only relationships pointing
 * to newly retained entities are copied from the additions side.
 */
export function mergeRoCratesForSync(
  localCrate: SyncRoCrate,
  remoteCrate: SyncRoCrate,
  mode: RepositorySyncMode,
): SyncRoCrate {
  if (mode === 'complete') {
    return clone(remoteCrate)
  }
  return mode === 'remote-additions'
    ? retainAdditions(localCrate, remoteCrate)
    : retainAdditions(remoteCrate, localCrate)
}

function retainAdditions(baseCrate: SyncRoCrate, additionsCrate: SyncRoCrate): SyncRoCrate {
  const result = clone(baseCrate)
  result['@context'] = mergeContexts(baseCrate['@context'], additionsCrate['@context'])

  const resultGraph = graph(result)
  const additionsGraph = graph(additionsCrate)
  const resultById = new Map(resultGraph.map(entity => [entityId(entity), entity]))
  const addedIds = new Set(
    additionsGraph
      .map(entityId)
      .filter(id => !!id && !resultById.has(id)),
  )

  for (const entity of additionsGraph) {
    const id = entityId(entity)
    if (id && addedIds.has(id)) {
      const added = clone(entity)
      resultGraph.push(added)
      resultById.set(id, added)
    }
  }

  // Preserve inbound links (for example Dataset.hasPart) to the new entities.
  for (const sourceEntity of additionsGraph) {
    const id = entityId(sourceEntity)
    const targetEntity = id ? resultById.get(id) : undefined
    if (!id || !targetEntity || addedIds.has(id)) {
      continue
    }
    for (const [property, sourceValue] of Object.entries(sourceEntity)) {
      if (property === '@id' || property === '@type') {
        continue
      }
      const newReferences = referenceValues(sourceValue)
        .filter(reference => addedIds.has(reference['@id'] as string))
      if (newReferences.length) {
        targetEntity[property] = mergeReferenceValues(targetEntity[property], newReferences)
      }
    }
  }
  result['@graph'] = resultGraph
  return result
}

function mergeReferenceValues(current: unknown, additions: RoCrateEntity[]): unknown {
  const currentReferences = referenceValues(current)
  const merged: unknown[] = Array.isArray(current)
    ? clone(current)
    : current === undefined || current === null
      ? []
      : [clone(current)]
  const ids = new Set(currentReferences.map(reference => reference['@id'] as string))
  for (const addition of additions) {
    const id = addition['@id'] as string
    if (!ids.has(id)) {
      merged.push(clone(addition))
      ids.add(id)
    }
  }
  if (!Array.isArray(current) && (current === undefined || current === null) && merged.length === 1) {
    return merged[0]
  }
  return merged
}

function referenceValues(value: unknown): RoCrateEntity[] {
  const values = Array.isArray(value) ? value : [value]
  return values.filter((candidate): candidate is RoCrateEntity =>
    !!candidate &&
    typeof candidate === 'object' &&
    !Array.isArray(candidate) &&
    typeof (candidate as RoCrateEntity)['@id'] === 'string',
  )
}

function mergeContexts(base: unknown, additions: unknown): unknown {
  if (base === undefined) {
    return clone(additions)
  }
  if (additions === undefined) {
    return clone(base)
  }
  if (isRecord(base) && isRecord(additions)) {
    return { ...clone(additions), ...clone(base) }
  }
  const values = [...(Array.isArray(base) ? base : [base])]
  for (const value of Array.isArray(additions) ? additions : [additions]) {
    if (!values.some(existing => JSON.stringify(existing) === JSON.stringify(value))) {
      values.push(clone(value))
    }
  }
  return values.length === 1 ? values[0] : values
}

function graph(crate: SyncRoCrate): RoCrateEntity[] {
  return Array.isArray(crate['@graph'])
    ? crate['@graph'].filter(isRecord)
    : []
}

function entityId(entity: RoCrateEntity): string {
  return typeof entity['@id'] === 'string' ? entity['@id'] : ''
}

function isRecord(value: unknown): value is RoCrateEntity {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T
}

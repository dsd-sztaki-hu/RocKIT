// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import {
  DEFAULT_ROCRATE_CONTEXT,
  type RoCrate,
  type RoCrateChangeSet,
  type RoCrateEntity,
  type RoCrateReference,
} from './types'
import { cloneCrate, normalizeCrate } from './io'

function graphMap(graph: RoCrateEntity[]): Map<string, RoCrateEntity> {
  const map = new Map<string, RoCrateEntity>()
  for (const entity of graph) {
    if (typeof entity?.['@id'] === 'string') {
      map.set(entity['@id'], entity)
    }
  }
  return map
}

function asHasPartList(value: unknown): RoCrateReference[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is RoCrateReference =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>)['@id'] === 'string',
    )
  }
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>)['@id'] === 'string'
  ) {
    return [value as RoCrateReference]
  }
  return []
}

function ensureHasPart(entity: RoCrateEntity): RoCrateReference[] {
  const hasPart = asHasPartList(entity.hasPart)
  entity.hasPart = hasPart
  return hasPart
}

function mergeEntityType(target: RoCrateEntity, incoming: RoCrateEntity): void {
  const sourceType = incoming['@type']
  const targetType = target['@type']
  if (sourceType === undefined) {
    return
  }
  if (Array.isArray(targetType)) {
    const values = new Set<string>(targetType.filter((item): item is string => typeof item === 'string'))
    if (Array.isArray(sourceType)) {
      for (const item of sourceType) {
        if (typeof item === 'string') {
          values.add(item)
        }
      }
    } else if (typeof sourceType === 'string') {
      values.add(sourceType)
    }
    target['@type'] = Array.from(values).sort()
    return
  }
  if (targetType === undefined) {
    target['@type'] = sourceType
    return
  }
  if (Array.isArray(sourceType)) {
    const values = new Set<string>(
      sourceType.filter((item): item is string => typeof item === 'string'),
    )
    if (typeof targetType === 'string') {
      values.add(targetType)
    }
    target['@type'] = Array.from(values).sort()
  }
}

function mergeContext(crate: RoCrate, contextUpdate: Record<string, unknown>): void {
  const context = crate['@context']
  if (Array.isArray(context)) {
    let targetObject: Record<string, unknown> | undefined
    for (let i = context.length - 1; i >= 0; i -= 1) {
      const item = context[i]
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        targetObject = item as Record<string, unknown>
        break
      }
    }
    if (!targetObject) {
      targetObject = {}
      context.push(targetObject)
    }
    Object.assign(targetObject, contextUpdate)
    return
  }
  if (context && typeof context === 'object' && !Array.isArray(context)) {
    Object.assign(context as Record<string, unknown>, contextUpdate)
    return
  }
  if (typeof context === 'string') {
    crate['@context'] = [context, { ...contextUpdate }]
    return
  }
  crate['@context'] = [DEFAULT_ROCRATE_CONTEXT, { ...contextUpdate }]
}

export function applyChangeSet(crate: RoCrate, changeSet: RoCrateChangeSet): RoCrate {
  const next = normalizeCrate(cloneCrate(crate))
  const graph = Array.isArray(next['@graph']) ? next['@graph'] : []
  next['@graph'] = graph
  let idMap = graphMap(graph)

  const removeEntities = changeSet.removeEntities ?? []
  if (removeEntities.length > 0) {
    const removed = new Set<string>(
      removeEntities.filter((item): item is string => typeof item === 'string'),
    )
    next['@graph'] = graph.filter((entity) => {
      const entityId = entity['@id']
      return typeof entityId !== 'string' || !removed.has(entityId)
    })
    for (const entity of next['@graph']) {
      const list = asHasPartList(entity.hasPart)
      entity.hasPart = list.filter((item) => !removed.has(item['@id']))
    }
    idMap = graphMap(next['@graph'])
  }

  const addEntities = changeSet.addEntities ?? []
  for (const entity of addEntities) {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
      continue
    }
    const entityId = entity['@id']
    if (typeof entityId !== 'string') {
      continue
    }
    const existing = idMap.get(entityId)
    if (existing) {
      mergeEntityType(existing, entity)
      if (entity.hasPart) {
        const targetHasPart = ensureHasPart(existing)
        const knownIds = new Set<string>(targetHasPart.map((item) => item['@id']))
        for (const item of asHasPartList(entity.hasPart)) {
          if (!knownIds.has(item['@id'])) {
            targetHasPart.push({ '@id': item['@id'] })
            knownIds.add(item['@id'])
          }
        }
      }
      for (const [key, value] of Object.entries(entity)) {
        if (key === '@id' || key === '@type' || key === 'hasPart') {
          continue
        }
        if (!(key in existing)) {
          existing[key] = value
        }
      }
      continue
    }
    next['@graph'].push(entity)
    idMap.set(entityId, entity)
  }

  const updates = changeSet.updateEntities ?? []
  for (const update of updates) {
    if (!update || typeof update !== 'object' || Array.isArray(update)) {
      continue
    }
    const entityId = update['@id']
    if (typeof entityId !== 'string') {
      continue
    }
    const target = idMap.get(entityId)
    if (!target) {
      continue
    }
    const mergePayload =
      update.merge && typeof update.merge === 'object' && !Array.isArray(update.merge)
        ? update.merge
        : Object.fromEntries(
            Object.entries(update).filter(
              ([key]) => key !== '@id' && key !== 'merge' && key !== 'unset',
            ),
          )
    Object.assign(target, mergePayload)
    const unsetFields = Array.isArray(update.unset)
      ? update.unset.filter((item): item is string => typeof item === 'string')
      : []
    for (const key of unsetFields) {
      if (key === '@id' || key === '@type') {
        continue
      }
      delete target[key]
    }
  }

  if (changeSet.setRootFields && typeof changeSet.setRootFields === 'object') {
    const root = idMap.get('./')
    if (root) {
      Object.assign(root, changeSet.setRootFields)
    }
  }

  const addHasPart = changeSet.addHasPart ?? []
  for (const edge of addHasPart) {
    const datasetId = edge?.dataset
    const childId = edge?.child
    if (typeof datasetId !== 'string' || typeof childId !== 'string') {
      continue
    }
    const dataset = idMap.get(datasetId)
    if (!dataset) {
      continue
    }
    const list = ensureHasPart(dataset)
    if (!list.some((item) => item['@id'] === childId)) {
      list.push({ '@id': childId })
    }
  }

  const removeHasPart = changeSet.removeHasPart ?? []
  for (const edge of removeHasPart) {
    const datasetId = edge?.dataset
    const childId = edge?.child
    if (typeof datasetId !== 'string' || typeof childId !== 'string') {
      continue
    }
    const dataset = idMap.get(datasetId)
    if (!dataset) {
      continue
    }
    dataset.hasPart = asHasPartList(dataset.hasPart).filter(
      (item) => item['@id'] !== childId,
    )
  }

  if (changeSet.mergeContext && typeof changeSet.mergeContext === 'object') {
    mergeContext(next, changeSet.mergeContext)
  }

  return next
}

export {
  RO_CRATE_APPROVAL_FILE,
  RO_CRATE_APPROVAL_FILE_NAME,
} from 'aroma2-common/lib/common/ro-crate-technical-files'

export type RoCrateApprovalOperation = 'create' | 'update' | 'delete'

export interface RoCrateChangedProperty {
  entityId: string
  propertyName: string
  operation: RoCrateApprovalOperation
  previousValue?: unknown
}

export interface RoCrateApprovalItem {
  propertyName: string
  previousValue?: unknown
  operation: RoCrateApprovalOperation
  approved: boolean
  timestamp: string
}

export interface RoCrateApprovalEntity {
  '@id': string
  approval: RoCrateApprovalItem[]
}

export type RoCrateApprovalFile = RoCrateApprovalEntity[]

const ROOT_ENTITY_ID = '@root'

export function collectRoCrateChangedProperties(
  before: Record<string, any> | undefined,
  after: Record<string, any> | undefined,
): RoCrateChangedProperty[] {
  if (!before || !after) {
    return []
  }

  const changes: RoCrateChangedProperty[] = []

  for (const property of sortedUnionKeys(before, after).filter((key) => key !== '@graph')) {
    appendPropertyChange(changes, ROOT_ENTITY_ID, property, before[property], after[property])
  }

  const beforeEntities = buildEntityMap(before)
  const afterEntities = buildEntityMap(after)

  for (const entityId of sortedUnionKeysFromMaps(beforeEntities, afterEntities)) {
    const previousEntity = beforeEntities.get(entityId)
    const nextEntity = afterEntities.get(entityId)
    if (!previousEntity || !nextEntity) {
      const entity = previousEntity ?? nextEntity
      if (!entity) {
        continue
      }
      const operation: RoCrateApprovalOperation = previousEntity ? 'delete' : 'create'
      for (const property of Object.keys(entity).filter((key) => key !== '@id').sort()) {
        changes.push({
          entityId,
          propertyName: property,
          operation,
          previousValue: previousEntity ? entity[property] : undefined,
        })
      }
      continue
    }

    for (const property of sortedUnionKeys(previousEntity, nextEntity).filter((key) => key !== '@id')) {
      appendPropertyChange(
        changes,
        entityId,
        property,
        previousEntity[property],
        nextEntity[property],
      )
    }
  }

  return changes
}

export function maintainRoCrateApprovalFile(
  existing: RoCrateApprovalFile | undefined,
  changedProperties: RoCrateChangedProperty[],
  now = new Date().toISOString(),
): RoCrateApprovalFile {
  const previousItemsByKey = new Map<string, RoCrateApprovalItem>()
  const previousEntityIdsByKey = new Map<string, string>()

  for (const entity of Array.isArray(existing) ? existing : []) {
    if (!entity || typeof entity !== 'object') {
      continue
    }
    const entityId = typeof entity['@id'] === 'string' ? entity['@id'] : ''
    if (!entityId) {
      continue
    }
    const approval = Array.isArray(entity.approval)
      ? entity.approval
          .filter((item): item is RoCrateApprovalItem => Boolean(item) && typeof item === 'object')
          .map((item) => ({
            propertyName: typeof item.propertyName === 'string' ? item.propertyName : '',
            previousValue: item.previousValue,
            operation: normalizeOperation(item.operation),
            approved: item.approved === true,
            timestamp: typeof item.timestamp === 'string' ? item.timestamp : now,
          }))
          .filter((item) => item.propertyName)
      : []
    for (const item of approval) {
      const key = approvalKey(entityId, item.propertyName)
      previousItemsByKey.set(key, item)
      previousEntityIdsByKey.set(key, entityId)
    }
  }

  const nextEntitiesById = new Map<string, RoCrateApprovalEntity>()
  for (const [key, item] of previousItemsByKey.entries()) {
    const entityId = previousEntityIdsByKey.get(key)
    if (!entityId) {
      continue
    }
    const entity = nextEntitiesById.get(entityId) ?? {
      '@id': entityId,
      approval: [],
    }
    entity.approval.push(item)
    nextEntitiesById.set(entityId, entity)
  }

  for (const change of changedProperties) {
    const entity = nextEntitiesById.get(change.entityId) ?? {
      '@id': change.entityId,
      approval: [],
    }
    const previousItem = previousItemsByKey.get(
      approvalKey(change.entityId, change.propertyName),
    )
    const isSameOutstandingChange =
      previousItem?.operation === change.operation &&
      valuesEqual(previousItem.previousValue, change.previousValue)
    const nextItem: RoCrateApprovalItem = {
      propertyName: change.propertyName,
      previousValue: change.previousValue,
      operation: change.operation,
      approved: isSameOutstandingChange ? previousItem.approved : false,
      timestamp: isSameOutstandingChange ? previousItem.timestamp : now,
    }
    const existingIndex = entity.approval.findIndex(
      (item) => item.propertyName === change.propertyName,
    )
    if (existingIndex >= 0) {
      entity.approval[existingIndex] = nextItem
    } else {
      entity.approval.push(nextItem)
    }
    entity.approval.sort((left, right) => left.propertyName.localeCompare(right.propertyName))
    nextEntitiesById.set(change.entityId, entity)
  }

  return Array.from(nextEntitiesById.values())
    .filter((entity) => entity.approval.length > 0)
    .sort((left, right) => left['@id'].localeCompare(right['@id']))
}

export function parseRoCrateApprovalFile(value: unknown): RoCrateApprovalFile | undefined {
  if (Array.isArray(value)) {
    return value as RoCrateApprovalFile
  }

  if (value && typeof value === 'object' && Array.isArray((value as any).changes)) {
    const migrated = new Map<string, RoCrateApprovalEntity>()
    for (const entry of (value as any).changes) {
      if (!entry || typeof entry !== 'object') {
        continue
      }
      const entityId = typeof entry.entityId === 'string' ? entry.entityId : ''
      const propertyName =
        typeof entry.propertyName === 'string'
          ? entry.propertyName
          : typeof entry.property === 'string'
            ? entry.property
            : ''
      if (!entityId || !propertyName) {
        continue
      }
      const entity: RoCrateApprovalEntity = migrated.get(entityId) ?? {
        '@id': entityId,
        approval: [],
      }
      entity.approval.push({
        propertyName,
        previousValue: entry.previousValue,
        operation: normalizeOperation(entry.operation),
        approved: entry.status === 'approved',
        timestamp:
          typeof entry.updatedAt === 'string'
            ? entry.updatedAt
            : typeof entry.timestamp === 'string'
              ? entry.timestamp
              : new Date().toISOString(),
      })
      migrated.set(entityId, entity)
    }
    return Array.from(migrated.values())
  }

  return undefined
}

function appendPropertyChange(
  changes: RoCrateChangedProperty[],
  entityId: string,
  propertyName: string,
  previousValue: unknown,
  nextValue: unknown,
): void {
  if (valuesEqual(previousValue, nextValue)) {
    return
  }

  changes.push({
    entityId,
    propertyName,
    operation: approvalOperation(previousValue, nextValue),
    previousValue,
  })
}

function buildEntityMap(crate: Record<string, any>): Map<string, Record<string, any>> {
  const map = new Map<string, Record<string, any>>()
  const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
  for (const entity of graph) {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
      continue
    }
    const entityId = typeof entity['@id'] === 'string' ? entity['@id'] : ''
    if (entityId) {
      map.set(entityId, entity)
    }
  }
  return map
}

function sortedUnionKeys(left: Record<string, any>, right: Record<string, any>): string[] {
  return Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort()
}

function sortedUnionKeysFromMaps(
  left: Map<string, unknown>,
  right: Map<string, unknown>,
): string[] {
  return Array.from(new Set([...left.keys(), ...right.keys()])).sort()
}

function valuesEqual(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return left === right
  }
}

function approvalOperation(
  previousValue: unknown,
  nextValue: unknown,
): RoCrateApprovalOperation {
  if (previousValue === undefined) {
    return 'create'
  }
  if (nextValue === undefined) {
    return 'delete'
  }
  return 'update'
}

function normalizeOperation(operation: unknown): RoCrateApprovalOperation {
  if (operation === 'create' || operation === 'update' || operation === 'delete') {
    return operation
  }
  if (operation === 'add') {
    return 'create'
  }
  if (operation === 'remove') {
    return 'delete'
  }
  return 'update'
}

function approvalKey(entityId: string, propertyName: string): string {
  return `${entityId}\u0000${propertyName}`
}

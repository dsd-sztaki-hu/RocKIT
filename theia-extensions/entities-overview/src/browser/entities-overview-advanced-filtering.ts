export type AdvancedFilterCombinator = 'and' | 'or'

export type AdvancedRuleOperator =
  | 'equal'
  | 'not_equal'
  | 'contains'
  | 'not_contains'
  | 'is_null'
  | 'is_not_null'

export interface AdvancedSchemaOption {
  id: string
  label: string
  url?: string
}

export interface AdvancedFieldDefinition {
  key: string
  label: string
  schemaId: string
  schemaLabel: string
  propertyName: string
  help?: string
  supportedClasses: string[]
}

export interface AdvancedFilterRuleNode {
  id: string
  kind: 'rule'
  fieldKey?: string
  operator: AdvancedRuleOperator
  value: string
}

export interface AdvancedFilterGroupNode {
  id: string
  kind: 'group'
  combinator: AdvancedFilterCombinator
  not: boolean
  children: AdvancedFilterNode[]
}

export type AdvancedFilterNode = AdvancedFilterRuleNode | AdvancedFilterGroupNode

export const ALL_ENTITY_TYPES_OPTION = '__all__'

export interface AdvancedFilterState {
  selectedEntityType: string
  selectedSchemaIds: string[]
  root: AdvancedFilterGroupNode
}

export interface AdvancedFilterCatalog {
  fields: AdvancedFieldDefinition[]
  schemas: AdvancedSchemaOption[]
}

export type AdvancedEntityMatcher = (entity: Record<string, unknown>) => boolean

interface SchemaMeta {
  id: string
  label: string
  url?: string
  selectable: boolean
}

const OPERATORS_WITHOUT_VALUE = new Set<AdvancedRuleOperator>(['is_null', 'is_not_null'])

/**
 * Builds advanced-filter field/schema catalog using the same profile layout grouping
 * used by multi-edit schema selection.
 */
export function buildAdvancedFilterCatalog(
  crate: Record<string, unknown> | undefined,
  profile: Record<string, unknown> | undefined,
): AdvancedFilterCatalog {
  const classes = asRecord(profile?.classes)
  if (!classes) {
    return { fields: [], schemas: [] }
  }
  const layouts = Array.isArray(profile?.layouts)
    ? (profile.layouts as Record<string, unknown>[])
    : []

  const entityTypes = collectEntityTypes(crate, classes)
  const fieldsByKey = new Map<string, AdvancedFieldDefinition>()
  const schemasById = new Map<string, AdvancedSchemaOption>()

  for (const className of entityTypes) {
    const classDef = asRecord(classes[className])
    if (!classDef) {
      continue
    }
    const inputs = Array.isArray(classDef.inputs)
      ? (classDef.inputs as Record<string, unknown>[])
      : []
    const layout = findLayoutForClass(layouts, className)

    for (const input of inputs) {
      const propertyName =
        typeof input?.name === 'string' ? String(input.name).trim() : ''
      if (!propertyName) {
        continue
      }

      const schemaMeta = resolveSchemaMeta(layout, getFieldGroup(input))
      if (schemaMeta.selectable && !schemasById.has(schemaMeta.id)) {
        schemasById.set(schemaMeta.id, {
          id: schemaMeta.id,
          label: schemaMeta.label,
          url: schemaMeta.url,
        })
      }

      if (!schemaMeta.selectable) {
        continue
      }

      const label = String(input?.label ?? propertyName)
      const dedupeKey = `${schemaMeta.id}::${propertyName}::${label}`
      const existing = fieldsByKey.get(dedupeKey)
      if (existing) {
        const supported = new Set(existing.supportedClasses)
        supported.add(className)
        existing.supportedClasses = Array.from(supported.values())
        continue
      }

      fieldsByKey.set(dedupeKey, {
        key: dedupeKey,
        label,
        schemaId: schemaMeta.id,
        schemaLabel: schemaMeta.label,
        propertyName,
        help: typeof input?.help === 'string' ? input.help : undefined,
        supportedClasses: [className],
      })
    }
  }

  const fields = Array.from(fieldsByKey.values()).sort((a, b) => {
    const labelCompare = a.label.localeCompare(b.label)
    if (labelCompare !== 0) {
      return labelCompare
    }
    return a.schemaLabel.localeCompare(b.schemaLabel)
  })
  const schemas = Array.from(schemasById.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  )

  return { fields, schemas }
}

export function cloneAdvancedFilterState(state: AdvancedFilterState): AdvancedFilterState {
  return {
    selectedEntityType: state.selectedEntityType,
    selectedSchemaIds: [...state.selectedSchemaIds],
    root: cloneGroup(state.root),
  }
}

export function countActiveAdvancedRules(
  state: AdvancedFilterState | undefined,
  catalog: AdvancedFilterCatalog,
): number {
  if (!state) {
    return 0
  }
  const sanitized = sanitizeState(state, catalog)
  if (!sanitized) {
    return 0
  }
  return countRules(sanitized.root)
}

export function buildAdvancedEntityMatcher(
  state: AdvancedFilterState | undefined,
  catalog: AdvancedFilterCatalog,
): AdvancedEntityMatcher | undefined {
  if (!state) {
    return undefined
  }

  const sanitized = sanitizeState(state, catalog)
  if (!sanitized || sanitized.root.children.length === 0) {
    return undefined
  }

  const fieldsByKey = new Map(
    catalog.fields
      .filter((field) => sanitized.selectedSchemaIds.includes(field.schemaId))
      .map((field) => [field.key, field] as const),
  )

  return (entity) => evaluateGroup(entity, sanitized.root, fieldsByKey)
}

function sanitizeState(
  state: AdvancedFilterState,
  catalog: AdvancedFilterCatalog,
): AdvancedFilterState | undefined {
  const schemaIds = new Set(catalog.schemas.map((schema) => schema.id))
  const selectedSchemaIds = state.selectedSchemaIds.filter((schemaId) =>
    schemaIds.has(schemaId),
  )
  if (selectedSchemaIds.length === 0) {
    return undefined
  }

  const allowedFieldIds = new Set(
    catalog.fields
      .filter((field) => selectedSchemaIds.includes(field.schemaId))
      .map((field) => field.key),
  )
  if (allowedFieldIds.size === 0) {
    return undefined
  }

  const root = sanitizeGroup(state.root, allowedFieldIds)
  if (!root || root.children.length === 0) {
    return undefined
  }

  return {
    selectedEntityType: state.selectedEntityType,
    selectedSchemaIds,
    root,
  }
}

function sanitizeGroup(
  group: AdvancedFilterGroupNode | undefined,
  allowedFieldIds: Set<string>,
): AdvancedFilterGroupNode | undefined {
  if (!group || group.kind !== 'group') {
    return undefined
  }

  const children: AdvancedFilterNode[] = []
  for (const child of group.children) {
    if (child.kind === 'group') {
      const sanitizedGroup = sanitizeGroup(child, allowedFieldIds)
      if (sanitizedGroup && sanitizedGroup.children.length > 0) {
        children.push(sanitizedGroup)
      }
      continue
    }

    if (!child.fieldKey || !allowedFieldIds.has(child.fieldKey)) {
      continue
    }
    if (OPERATORS_WITHOUT_VALUE.has(child.operator)) {
      children.push({
        id: child.id,
        kind: 'rule',
        fieldKey: child.fieldKey,
        operator: child.operator,
        value: '',
      })
      continue
    }
    if (!child.value.trim()) {
      continue
    }
    children.push({
      id: child.id,
      kind: 'rule',
      fieldKey: child.fieldKey,
      operator: child.operator,
      value: child.value,
    })
  }

  return {
    id: group.id,
    kind: 'group',
    combinator: group.combinator === 'or' ? 'or' : 'and',
    not: Boolean(group.not),
    children,
  }
}

function evaluateGroup(
  entity: Record<string, unknown>,
  group: AdvancedFilterGroupNode,
  fieldsByKey: Map<string, AdvancedFieldDefinition>,
): boolean {
  if (group.children.length === 0) {
    return true
  }
  const results = group.children.map((child) => {
    if (child.kind === 'group') {
      return evaluateGroup(entity, child, fieldsByKey)
    }
    return evaluateRule(entity, child, fieldsByKey)
  })

  const value =
    group.combinator === 'or' ? results.some(Boolean) : results.every(Boolean)
  return group.not ? !value : value
}

function evaluateRule(
  entity: Record<string, unknown>,
  rule: AdvancedFilterRuleNode,
  fieldsByKey: Map<string, AdvancedFieldDefinition>,
): boolean {
  if (!rule.fieldKey) {
    return false
  }
  const field = fieldsByKey.get(rule.fieldKey)
  if (!field) {
    return false
  }

  const values = getComparableValues(entity, field)
  const hasValue = values.length > 0
  const normalizedValues = values.map((value) => value.toLocaleLowerCase())
  const query = rule.value.trim().toLocaleLowerCase()

  switch (rule.operator) {
    case 'is_null':
      return !hasValue
    case 'is_not_null':
      return hasValue
    case 'equal':
      return normalizedValues.some((value) => value === query)
    case 'not_equal':
      return normalizedValues.every((value) => value !== query)
    case 'contains':
      return normalizedValues.some((value) => value.includes(query))
    case 'not_contains':
      return normalizedValues.every((value) => !value.includes(query))
    default:
      return false
  }
}

function getComparableValues(
  entity: Record<string, unknown>,
  field: AdvancedFieldDefinition,
): string[] {
  const applicable =
    field.supportedClasses.length === 0 ||
    getEntityTypeNames(entity).some((typeName) =>
      field.supportedClasses.includes(typeName),
    )
  if (!applicable) {
    return []
  }
  return flattenComparableValues(entity[field.propertyName])
}

function flattenComparableValues(rawValue: unknown): string[] {
  if (rawValue === null || rawValue === undefined) {
    return []
  }
  if (Array.isArray(rawValue)) {
    return rawValue.flatMap((item) => flattenComparableValues(item))
  }
  if (typeof rawValue === 'object') {
    const asObj = rawValue as Record<string, unknown>
    if (typeof asObj['@id'] === 'string') {
      const value = asObj['@id'].trim()
      return value ? [value] : []
    }
    if (asObj['@value'] !== undefined && asObj['@value'] !== null) {
      const value = String(asObj['@value']).trim()
      return value ? [value] : []
    }
    if (typeof asObj.name === 'string' && asObj.name.trim()) {
      return [asObj.name.trim()]
    }
    return []
  }

  const value = String(rawValue).trim()
  return value ? [value] : []
}

function collectEntityTypes(
  crate: Record<string, unknown> | undefined,
  classes: Record<string, unknown>,
): string[] {
  const graph = Array.isArray(crate?.['@graph'])
    ? (crate['@graph'] as Record<string, unknown>[])
    : []
  const types = new Set<string>()
  for (const entity of graph) {
    for (const typeName of getEntityTypeNames(entity)) {
      if (classes[typeName]) {
        types.add(typeName)
      }
    }
  }
  return Array.from(types.values()).sort((a, b) => a.localeCompare(b))
}

function getEntityTypeNames(entity: Record<string, unknown>): string[] {
  const rawType = entity['@type']
  const candidates = Array.isArray(rawType) ? rawType : rawType ? [rawType] : []
  const names: string[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const typeName = toTypeTail(String(candidate))
    if (!typeName || typeName === 'CreativeWork' || seen.has(typeName)) {
      continue
    }
    seen.add(typeName)
    names.push(typeName)
  }
  return names
}

function toTypeTail(typeName: string): string {
  const trimmed = typeName.trim()
  if (!trimmed) {
    return ''
  }
  const slashIndex = trimmed.lastIndexOf('/')
  const hashIndex = trimmed.lastIndexOf('#')
  const cut = Math.max(slashIndex, hashIndex)
  if (cut < 0) {
    return trimmed
  }
  return trimmed.slice(cut + 1)
}

function findLayoutForClass(
  layouts: Record<string, unknown>[],
  className: string,
): Record<string, unknown> | undefined {
  return layouts.find((layout) => {
    const appliesTo = Array.isArray(layout?.appliesTo) ? layout.appliesTo : []
    return appliesTo.includes(className)
  })
}

function getFieldGroup(input: Record<string, unknown>): string {
  if (typeof input.group === 'string' && input.group.trim().length > 0) {
    return input.group.trim()
  }
  return 'about'
}

function resolveSchemaMeta(
  layout: Record<string, unknown> | undefined,
  group: string,
): SchemaMeta {
  if (group.toLowerCase() === 'about') {
    const about = asRecord(layout?.about)
    const label =
      typeof about?.label === 'string' && about.label.trim().length > 0
        ? about.label.trim()
        : 'About'
    const url =
      typeof about?.url === 'string' && about.url.trim().length > 0
        ? about.url.trim()
        : undefined
    return {
      id: '__about__',
      label,
      url,
      selectable: false,
    }
  }

  const layoutGroup = asRecord(layout?.[group])
  const label =
    typeof layoutGroup?.label === 'string' && layoutGroup.label.trim().length > 0
      ? layoutGroup.label.trim()
      : group
  const url =
    typeof layoutGroup?.url === 'string' && layoutGroup.url.trim().length > 0
      ? layoutGroup.url.trim()
      : undefined

  return {
    id: normalizeSchemaId(label),
    label,
    url,
    selectable: true,
  }
}

function normalizeSchemaId(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

function cloneGroup(group: AdvancedFilterGroupNode): AdvancedFilterGroupNode {
  return {
    id: group.id,
    kind: 'group',
    combinator: group.combinator,
    not: group.not,
    children: group.children.map((child) =>
      child.kind === 'group'
        ? cloneGroup(child)
        : {
            id: child.id,
            kind: 'rule',
            fieldKey: child.fieldKey,
            operator: child.operator,
            value: child.value,
          },
    ),
  }
}

function countRules(group: AdvancedFilterGroupNode): number {
  let count = 0
  for (const child of group.children) {
    if (child.kind === 'group') {
      count += countRules(child)
    } else {
      count += 1
    }
  }
  return count
}

export type AdvancedFilterCombinator = 'and' | 'or'

export type AdvancedRuleOperator =
  | 'equal'
  | 'not_equal'
  | 'contains'
  | 'not_contains'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'between'
  | 'not_between'
  | 'is_null'
  | 'is_not_null'
  | 'fields'

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
  entityTypes: string[]
  expectsObjectValue: boolean
  valueKind: 'text' | 'date'
  objectSubfields: AdvancedFieldDefinition[]
}

export interface AdvancedFilterRuleNode {
  id: string
  kind: 'rule'
  fieldKey?: string
  operator: AdvancedRuleOperator
  value: string
  fieldsMode?: 'all' | 'any'
  fieldsRoot?: AdvancedFilterGroupNode
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
const MULTI_VALUE_PREFIX = '__advanced_multi__:'
const DATE_ORDER_OPERATORS = new Set<AdvancedRuleOperator>([
  'lt',
  'lte',
  'gt',
  'gte',
])
const DATE_RANGE_OPERATORS = new Set<AdvancedRuleOperator>(['between', 'not_between'])

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
      const entityTypes = extractEntityTypes(input, classes)
      const expectsObjectValue = resolveExpectsObjectValue(input, classes, entityTypes)
      const valueKind = resolveValueKind(input, expectsObjectValue)
      const objectSubfields = expectsObjectValue
        ? buildObjectSubfields(entityTypes, classes)
        : []

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
        const mergedEntityTypes = new Set(existing.entityTypes)
        for (const typeName of entityTypes) {
          mergedEntityTypes.add(typeName)
        }
        existing.entityTypes = Array.from(mergedEntityTypes.values())
        existing.expectsObjectValue = existing.expectsObjectValue || expectsObjectValue
        if (existing.valueKind !== 'date' && valueKind === 'date') {
          existing.valueKind = 'date'
        }
        const mergedSubfields = new Map(
          existing.objectSubfields.map((subfield) => [subfield.key, subfield] as const),
        )
        for (const subfield of objectSubfields) {
          if (!mergedSubfields.has(subfield.key)) {
            mergedSubfields.set(subfield.key, subfield)
          }
        }
        existing.objectSubfields = Array.from(mergedSubfields.values()).sort((a, b) =>
          a.label.localeCompare(b.label),
        )
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
        entityTypes,
        expectsObjectValue,
        valueKind,
        objectSubfields,
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
  const fieldsByKey = new Map(
    catalog.fields.map((field) => [field.key, field] as const),
  )
  const sanitized = sanitizeState(state, catalog, fieldsByKey)
  if (!sanitized) {
    return 0
  }
  return countRules(sanitized.root)
}

export function buildAdvancedEntityMatcher(
  state: AdvancedFilterState | undefined,
  catalog: AdvancedFilterCatalog,
  crate?: Record<string, unknown>,
): AdvancedEntityMatcher | undefined {
  if (!state) {
    return undefined
  }

  const fieldsByKey = new Map(
    catalog.fields.map((field) => [field.key, field] as const),
  )

  const sanitized = sanitizeState(state, catalog, fieldsByKey)
  if (!sanitized || sanitized.root.children.length === 0) {
    return undefined
  }

  const activeFieldsByKey = new Map(
    catalog.fields
      .filter((field) => sanitized.selectedSchemaIds.includes(field.schemaId))
      .map((field) => [field.key, field] as const),
  )

  const entityById = new Map<string, Record<string, unknown>>()
  const graph = Array.isArray(crate?.['@graph'])
    ? (crate?.['@graph'] as Record<string, unknown>[])
    : []
  for (const graphEntity of graph) {
    const id = graphEntity['@id']
    if (typeof id === 'string' && id.trim().length > 0) {
      entityById.set(id, graphEntity)
    }
  }

  return (entity) => evaluateGroup(entity, sanitized.root, activeFieldsByKey, entityById)
}

function sanitizeState(
  state: AdvancedFilterState,
  catalog: AdvancedFilterCatalog,
  fieldsByKey: Map<string, AdvancedFieldDefinition>,
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

  const root = sanitizeGroup(state.root, allowedFieldIds, fieldsByKey)
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
  fieldsByKey: Map<string, AdvancedFieldDefinition>,
): AdvancedFilterGroupNode | undefined {
  if (!group || group.kind !== 'group') {
    return undefined
  }

  const children: AdvancedFilterNode[] = []
  for (const child of group.children) {
    if (child.kind === 'group') {
      const sanitizedGroup = sanitizeGroup(child, allowedFieldIds, fieldsByKey)
      if (sanitizedGroup && sanitizedGroup.children.length > 0) {
        children.push(sanitizedGroup)
      }
      continue
    }

    if (!child.fieldKey || !allowedFieldIds.has(child.fieldKey)) {
      continue
    }
    const field = fieldsByKey.get(child.fieldKey)
    if (!field) {
      continue
    }
    if (child.operator === 'fields') {
      if (!field.expectsObjectValue || field.objectSubfields.length === 0) {
        continue
      }
      const subfieldIds = new Set(field.objectSubfields.map((item) => item.key))
      const subfieldsByKey = new Map(
        field.objectSubfields.map((item) => [item.key, item] as const),
      )
      const sanitizedFieldsRoot = sanitizeGroup(
        child.fieldsRoot,
        subfieldIds,
        subfieldsByKey,
      )
      if (!sanitizedFieldsRoot || sanitizedFieldsRoot.children.length === 0) {
        continue
      }
      children.push({
        id: child.id,
        kind: 'rule',
        fieldKey: child.fieldKey,
        operator: 'fields',
        value: '',
        fieldsMode: 'any',
        fieldsRoot: sanitizedFieldsRoot,
      })
      continue
    }
    if (OPERATORS_WITHOUT_VALUE.has(child.operator)) {
      children.push({
        id: child.id,
        kind: 'rule',
        fieldKey: child.fieldKey,
        operator: child.operator,
        value: '',
        fieldsMode: undefined,
        fieldsRoot: undefined,
      })
      continue
    }
    const decodedValues = decodeAdvancedRuleValues(child.value)
    if (isDateOrderingOperator(child.operator) && field.valueKind !== 'date') {
      continue
    }
    if (isRangeOperator(child.operator)) {
      const rangeValues = decodeDateQueryValues(child.value)
      if (field.valueKind !== 'date' || rangeValues.length < 2) {
        continue
      }
    } else if (decodedValues.length === 0) {
      continue
    }
    children.push({
      id: child.id,
      kind: 'rule',
      fieldKey: child.fieldKey,
      operator: child.operator,
      value: child.value,
      fieldsMode: undefined,
      fieldsRoot: undefined,
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
  entityById: Map<string, Record<string, unknown>>,
): boolean {
  if (group.children.length === 0) {
    return true
  }
  const results = group.children.map((child) => {
    if (child.kind === 'group') {
      return evaluateGroup(entity, child, fieldsByKey, entityById)
    }
    return evaluateRule(entity, child, fieldsByKey, entityById)
  })

  const value =
    group.combinator === 'or' ? results.some(Boolean) : results.every(Boolean)
  return group.not ? !value : value
}

function evaluateRule(
  entity: Record<string, unknown>,
  rule: AdvancedFilterRuleNode,
  fieldsByKey: Map<string, AdvancedFieldDefinition>,
  entityById: Map<string, Record<string, unknown>>,
): boolean {
  if (!rule.fieldKey) {
    return false
  }
  const field = fieldsByKey.get(rule.fieldKey)
  if (!field) {
    return false
  }
  if (rule.operator === 'fields') {
    if (!rule.fieldsRoot || field.objectSubfields.length === 0) {
      return false
    }
    const nestedFieldsByKey = new Map(
      field.objectSubfields.map((subfield) => [subfield.key, subfield] as const),
    )
    const objectEntities = resolveObjectEntities(entity[field.propertyName], entityById)
    if (objectEntities.length === 0) {
      return false
    }
    const results = objectEntities.map((item) =>
      evaluateGroup(item, rule.fieldsRoot!, nestedFieldsByKey, entityById),
    )
    return results.some(Boolean)
  }

  const values = getComparableValues(entity, field)
  const hasValue = values.length > 0
  if (field.valueKind === 'date' && isDateComparableOperator(rule.operator)) {
    return evaluateDateRule(values, rule.operator, rule.value)
  }
  const normalizedValues = values.map((value) => value.toLocaleLowerCase())
  const queries = decodeAdvancedRuleValues(rule.value).map((value) =>
    value.toLocaleLowerCase(),
  )
  const query = queries[0] ?? ''

  switch (rule.operator) {
    case 'is_null':
      return !hasValue
    case 'is_not_null':
      return hasValue
    case 'equal':
      if (field.expectsObjectValue) {
        return hasExactValueSetMatch(normalizedValues, queries)
      }
      if (queries.length > 1) {
        return queries.every((value) => normalizedValues.includes(value))
      }
      return normalizedValues.some((value) => value === query)
    case 'not_equal':
      if (field.expectsObjectValue) {
        return !hasExactValueSetMatch(normalizedValues, queries)
      }
      if (queries.length > 1) {
        return !queries.every((value) => normalizedValues.includes(value))
      }
      return normalizedValues.every((value) => value !== query)
    case 'contains':
      if (queries.length > 1) {
        return queries.every((queryValue) =>
          normalizedValues.some((value) => value.includes(queryValue)),
        )
      }
      return normalizedValues.some((value) => value.includes(query))
    case 'not_contains':
      if (queries.length > 1) {
        return queries.every((queryValue) =>
          normalizedValues.every((value) => !value.includes(queryValue)),
        )
      }
      return normalizedValues.every((value) => !value.includes(query))
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
    case 'between':
    case 'not_between':
      return false
    default:
      return false
  }
}

function evaluateDateRule(
  values: string[],
  operator: Extract<
    AdvancedRuleOperator,
    'equal' | 'not_equal' | 'lt' | 'lte' | 'gt' | 'gte' | 'between' | 'not_between'
  >,
  rawValue: string,
): boolean {
  const dateValues = values
    .map((value) => toDateDayKey(value))
    .filter((value): value is number => value !== undefined)
  const queryDates = decodeAdvancedRuleValues(rawValue)
    .map((value) => toDateDayKey(value))
    .filter((value): value is number => value !== undefined)
  const normalizedQueryDates =
    queryDates.length >= 2
      ? queryDates
      : decodeDateQueryValues(rawValue)
    .map((value) => toDateDayKey(value))
    .filter((value): value is number => value !== undefined)
  const queryDate = normalizedQueryDates[0]

  switch (operator) {
    case 'equal':
      return queryDate !== undefined && dateValues.some((value) => value === queryDate)
    case 'not_equal':
      return queryDate !== undefined && dateValues.every((value) => value !== queryDate)
    case 'lt':
      return queryDate !== undefined && dateValues.some((value) => value < queryDate)
    case 'lte':
      return queryDate !== undefined && dateValues.some((value) => value <= queryDate)
    case 'gt':
      return queryDate !== undefined && dateValues.some((value) => value > queryDate)
    case 'gte':
      return queryDate !== undefined && dateValues.some((value) => value >= queryDate)
    case 'between':
    case 'not_between': {
      if (normalizedQueryDates.length < 2) {
        return false
      }
      const [rangeStart, rangeEnd] =
        normalizedQueryDates[0] <= normalizedQueryDates[1]
          ? [normalizedQueryDates[0], normalizedQueryDates[1]]
          : [normalizedQueryDates[1], normalizedQueryDates[0]]
      if (operator === 'between') {
        return dateValues.some(
          (value) => value >= rangeStart && value <= rangeEnd,
        )
      }
      return dateValues.every((value) => value < rangeStart || value > rangeEnd)
    }
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
    const stable = stableStringify(asObj)
    return stable ? [stable] : []
  }

  const value = String(rawValue).trim()
  return value ? [value] : []
}

function resolveObjectEntities(
  rawValue: unknown,
  entityById: Map<string, Record<string, unknown>>,
): Record<string, unknown>[] {
  if (rawValue === null || rawValue === undefined) {
    return []
  }
  if (Array.isArray(rawValue)) {
    return rawValue.flatMap((item) => resolveObjectEntities(item, entityById))
  }
  if (typeof rawValue === 'object') {
    const asObj = rawValue as Record<string, unknown>
    if (typeof asObj['@id'] === 'string') {
      const idValue = asObj['@id'].trim()
      const resolved = idValue ? entityById.get(idValue) : undefined
      if (resolved) {
        return [resolved]
      }
    }
    return [asObj]
  }
  return []
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

function hasExactValueSetMatch(values: string[], queries: string[]): boolean {
  const valueSet = new Set(values.map((value) => value.trim()).filter(Boolean))
  const querySet = new Set(queries.map((query) => query.trim()).filter(Boolean))
  if (valueSet.size !== querySet.size) {
    return false
  }
  for (const queryValue of querySet) {
    if (!valueSet.has(queryValue)) {
      return false
    }
  }
  return true
}

export function encodeAdvancedRuleValues(values: string[]): string {
  const normalized = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  if (normalized.length === 0) {
    return ''
  }
  if (normalized.length === 1) {
    return normalized[0]
  }
  return `${MULTI_VALUE_PREFIX}${JSON.stringify(normalized)}`
}

export function decodeAdvancedRuleValues(rawValue: string): string[] {
  const value = String(rawValue ?? '').trim()
  if (!value) {
    return []
  }
  if (!value.startsWith(MULTI_VALUE_PREFIX)) {
    return [value]
  }

  const payload = value.slice(MULTI_VALUE_PREFIX.length)
  try {
    const parsed = JSON.parse(payload)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .map((item) => String(item ?? '').trim())
      .filter((item) => item.length > 0)
  } catch {
    return []
  }
}

function extractEntityTypes(
  input: Record<string, unknown>,
  classes: Record<string, unknown>,
): string[] {
  const rawType = input.type
  const typeValues = Array.isArray(rawType) ? rawType : rawType ? [rawType] : []
  const entityTypes = new Set<string>()
  for (const typeValue of typeValues) {
    const tail = toTypeTail(String(typeValue))
    const classDef = tail ? asRecord(classes[tail]) : undefined
    if (tail && classDef && Array.isArray(classDef.inputs)) {
      entityTypes.add(tail)
    }
  }
  return Array.from(entityTypes.values())
}

function buildObjectSubfields(
  entityTypes: string[],
  classes: Record<string, unknown>,
): AdvancedFieldDefinition[] {
  const subfieldsByKey = new Map<string, AdvancedFieldDefinition>()
  for (const entityType of entityTypes) {
    const classDef = asRecord(classes[entityType])
    if (!classDef) {
      continue
    }
    const inputs = Array.isArray(classDef.inputs)
      ? (classDef.inputs as Record<string, unknown>[])
      : []
    for (const input of inputs) {
      const propertyName =
        typeof input?.name === 'string' ? String(input.name).trim() : ''
      if (!propertyName) {
        continue
      }
      const key = `${entityType}::${propertyName}`
      if (subfieldsByKey.has(key)) {
        continue
      }
      subfieldsByKey.set(key, {
        key,
        label: String(input?.label ?? propertyName),
        schemaId: '__object_fields__',
        schemaLabel: entityType,
        propertyName,
        help: typeof input?.help === 'string' ? input.help : undefined,
        supportedClasses: [],
        entityTypes: [],
        expectsObjectValue: false,
        valueKind: resolveValueKind(input, false),
        objectSubfields: [],
      })
    }
  }
  return Array.from(subfieldsByKey.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  )
}

function resolveExpectsObjectValue(
  input: Record<string, unknown>,
  classes: Record<string, unknown>,
  entityTypes: string[],
): boolean {
  if (entityTypes.length > 0) {
    return true
  }

  if (Array.isArray(input.values) && input.values.length > 0) {
    return false
  }

  const rawType = input.type
  const typeValues = Array.isArray(rawType) ? rawType : rawType ? [rawType] : []
  if (typeValues.length === 0) {
    return false
  }

  for (const typeValue of typeValues) {
    const raw = String(typeValue).trim()
    if (!raw) {
      continue
    }
    const tail = toTypeTail(raw)
    if (tail && classes[tail]) {
      return true
    }
    if (!isScalarType(raw)) {
      return true
    }
  }

  return false
}

function resolveValueKind(
  input: Record<string, unknown>,
  expectsObjectValue: boolean,
): 'text' | 'date' {
  if (expectsObjectValue) {
    return 'text'
  }
  if (Array.isArray(input.values) && input.values.length > 0) {
    return 'text'
  }

  const rawType = input.type
  const typeValues = Array.isArray(rawType) ? rawType : rawType ? [rawType] : []
  for (const typeValue of typeValues) {
    if (isDateType(String(typeValue))) {
      return 'date'
    }
  }
  return 'text'
}

function isDateType(typeName: string): boolean {
  const normalized = typeName.trim().toLowerCase()
  if (!normalized) {
    return false
  }
  return (
    normalized === 'date' ||
    normalized === 'datetime' ||
    normalized.includes('#date') ||
    normalized.endsWith('/date') ||
    normalized.includes('datetime')
  )
}

function isScalarType(typeName: string): boolean {
  const normalized = typeName.toLowerCase()
  return (
    normalized === 'text' ||
    normalized === 'textarea' ||
    normalized === 'select' ||
    normalized === 'url' ||
    normalized.includes('string') ||
    normalized.includes('token') ||
    normalized.includes('langstring') ||
    normalized.includes('uri') ||
    normalized.includes('int') ||
    normalized.includes('integer') ||
    normalized.includes('float') ||
    normalized.includes('double') ||
    normalized.includes('decimal') ||
    normalized.includes('number') ||
    normalized.includes('boolean') ||
    normalized.includes('date') ||
    normalized.includes('time')
  )
}

function isDateOrderingOperator(
  operator: AdvancedRuleOperator,
): operator is 'lt' | 'lte' | 'gt' | 'gte' {
  return DATE_ORDER_OPERATORS.has(operator)
}

function isRangeOperator(
  operator: AdvancedRuleOperator,
): operator is 'between' | 'not_between' {
  return DATE_RANGE_OPERATORS.has(operator)
}

function isDateComparableOperator(
  operator: AdvancedRuleOperator,
): operator is
  | 'equal'
  | 'not_equal'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'between'
  | 'not_between' {
  return (
    operator === 'equal' ||
    operator === 'not_equal' ||
    isDateOrderingOperator(operator) ||
    isRangeOperator(operator)
  )
}

function decodeDateQueryValues(rawValue: string): string[] {
  const decoded = decodeAdvancedRuleValues(rawValue)
  if (decoded.length >= 2) {
    return decoded
  }

  const fallbackMatches = String(rawValue ?? '').match(/\d{4}-\d{2}-\d{2}/g)
  if (fallbackMatches && fallbackMatches.length >= 2) {
    return [fallbackMatches[0], fallbackMatches[1]]
  }

  return decoded
}

function toDateDayKey(rawValue: string): number | undefined {
  const value = String(rawValue ?? '').trim()
  if (!value) {
    return undefined
  }

  // Date-only values should be treated as explicit calendar dates.
  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1])
    const month = Number(dateOnlyMatch[2])
    const day = Number(dateOnlyMatch[3])
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return undefined
    }
    const parsed = new Date(year, month - 1, day)
    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      return undefined
    }
    return parsed.getTime()
  }

  const parsedMs = Date.parse(value)
  if (!Number.isFinite(parsedMs)) {
    return undefined
  }
  // Date-time values should be matched by the user's local calendar day.
  const parsedDate = new Date(parsedMs)
  return new Date(
    parsedDate.getFullYear(),
    parsedDate.getMonth(),
    parsedDate.getDate(),
  ).getTime()
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value)
  }

  const objectValue = value as Record<string, unknown>
  const keys = Object.keys(objectValue).sort((a, b) => a.localeCompare(b))
  const entries = keys.map(
    (key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`,
  )
  return `{${entries.join(',')}}`
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
            fieldsMode: child.fieldsMode,
            fieldsRoot: child.fieldsRoot ? cloneGroup(child.fieldsRoot) : undefined,
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
      if (child.fieldsRoot) {
        count += countRules(child.fieldsRoot)
      }
    }
  }
  return count
}

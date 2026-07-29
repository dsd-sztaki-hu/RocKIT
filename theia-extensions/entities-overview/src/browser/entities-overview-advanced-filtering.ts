import schemaTypeDefinitions = require('./schema-type-definitions.json')
import { nls } from '@theia/core/lib/common/nls'

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

export type AdvancedFieldValueKind = 'entity' | 'text' | 'url' | 'date'

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
  valueKind: AdvancedFieldValueKind
  valueKinds?: AdvancedFieldValueKind[]
  objectSubfields: AdvancedFieldDefinition[]
}

export interface AdvancedFilterRuleNode {
  id: string
  kind: 'rule'
  fieldKey?: string
  operator: AdvancedRuleOperator
  value: string
  valueKind?: AdvancedFieldValueKind
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
export const SCHEMA_ORG_SCHEMA_ID = '__schemaorg__'
const SCHEMA_ORG_LABEL = 'schema.org'
const OTHER_ONTOLOGIES_LABEL = nls.localize('rockit/entitiesOverview/otherOntologies', 'Other ontologies')

interface SchemaTypeDefinitionInput {
  id?: string
  name?: string
  label?: string
  help?: string
  type?: string | string[]
  values?: unknown[]
}

interface SchemaTypeDefinition {
  subClassOf?: string[]
  hierarchy?: string[]
  inputs?: SchemaTypeDefinitionInput[]
}

export interface AdvancedFilterState {
  selectedEntityType: string
  selectedSchemaIds: string[]
  schemaOrgEnabled: boolean
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

interface RuleEvaluationCache {
  normalizedQueries: string[]
  dateQueryDayKeys?: number[]
  nestedFieldsByKey?: Map<string, AdvancedFieldDefinition>
}

interface RuleEvaluationContext {
  comparableValuesByEntity: WeakMap<Record<string, unknown>, Map<string, string[]>>
  normalizedValuesByEntity: WeakMap<Record<string, unknown>, Map<string, string[]>>
  dateDayKeysByEntity: WeakMap<Record<string, unknown>, Map<string, number[]>>
  objectEntitiesByEntity: WeakMap<
    Record<string, unknown>,
    Map<string, Record<string, unknown>[]>
  >
}

const OPERATORS_WITHOUT_VALUE = new Set<AdvancedRuleOperator>(['is_null', 'is_not_null'])
const MULTI_VALUE_PREFIX = '__advanced_multi__:'
const SCHEMA_TYPE_DEFINITIONS = schemaTypeDefinitions as Record<
  string,
  SchemaTypeDefinition
>
const DATE_ORDER_OPERATORS = new Set<AdvancedRuleOperator>([
  'lt',
  'lte',
  'gt',
  'gte',
])
const DATE_RANGE_OPERATORS = new Set<AdvancedRuleOperator>(['between', 'not_between'])
const FIELD_VALUE_KIND_PRIORITY: Record<AdvancedFieldValueKind, number> = {
  entity: 0,
  date: 1,
  text: 2,
  url: 3,
}

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
      const valueKinds = resolveValueKinds(input, classes, entityTypes, expectsObjectValue)
      const valueKind = valueKinds[0] ?? 'text'
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
        existing.valueKinds = sortAdvancedFieldValueKinds([
          ...getFieldValueKinds(existing),
          ...valueKinds,
        ])
        existing.valueKind = existing.valueKinds[0] ?? existing.valueKind
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
        valueKinds,
        objectSubfields,
      })
    }
  }

  const schemaOrgFields = buildSchemaOrgCatalogFields(crate, classes)
  for (const field of schemaOrgFields) {
    fieldsByKey.set(field.key, field)
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
    schemaOrgEnabled: Boolean(state.schemaOrgEnabled),
    root: cloneGroup(state.root),
  }
}

/**
 * Counts active, valid rules in the current advanced-filter state.
 * Rules removed by sanitization are not counted.
 */
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

/**
 * Builds the predicate used by the entities overview tree.
 * Returns `undefined` when the advanced query is empty/invalid after sanitization.
 */
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

  const selectedSchemaIds = new Set(sanitized.selectedSchemaIds)
  const includeSchemaOrg = sanitized.schemaOrgEnabled
  const activeFieldsByKey = new Map(
    catalog.fields
      .filter(
        (field) =>
          selectedSchemaIds.has(field.schemaId) ||
          (includeSchemaOrg && field.schemaId === SCHEMA_ORG_SCHEMA_ID),
      )
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
  const { cache: ruleCache } = buildRuleEvaluationCache(
    sanitized.root,
    activeFieldsByKey,
  )

  return (entity) =>
    evaluateGroup(
      entity,
      sanitized.root,
      activeFieldsByKey,
      entityById,
      ruleCache,
      createRuleEvaluationContext(),
    )
}

/**
 * Keeps only selected schemas/fields and drops invalid branches from the query tree.
 */
function sanitizeState(
  state: AdvancedFilterState,
  catalog: AdvancedFilterCatalog,
  fieldsByKey: Map<string, AdvancedFieldDefinition>,
): AdvancedFilterState | undefined {
  const schemaIds = new Set(catalog.schemas.map((schema) => schema.id))
  const selectedSchemaIds = state.selectedSchemaIds.filter((schemaId) =>
    schemaIds.has(schemaId),
  )
  const schemaOrgEnabled = Boolean(state.schemaOrgEnabled)
  if (selectedSchemaIds.length === 0 && !schemaOrgEnabled) {
    return undefined
  }
  const selectedSchemaSet = new Set(selectedSchemaIds)

  const allowedFieldIds = new Set(
    catalog.fields
      .filter(
        (field) =>
          selectedSchemaSet.has(field.schemaId) ||
          (schemaOrgEnabled && field.schemaId === SCHEMA_ORG_SCHEMA_ID),
      )
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
    schemaOrgEnabled,
    root,
  }
}

/**
 * Recursively validates one group and its descendants.
 * This normalizes operators and removes incomplete rules.
 */
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
    const effectiveValueKind = getEffectiveRuleValueKind(child, field)
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
        valueKind: 'entity',
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
        valueKind: effectiveValueKind,
        fieldsMode: undefined,
        fieldsRoot: undefined,
      })
      continue
    }
    const decodedValues = decodeAdvancedRuleValues(child.value)
    if (isDateOrderingOperator(child.operator) && effectiveValueKind !== 'date') {
      continue
    }
    if (isRangeOperator(child.operator)) {
      const rangeValues = decodeDateQueryValues(child.value)
      if (effectiveValueKind !== 'date' || rangeValues.length < 2) {
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
      valueKind: effectiveValueKind,
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

/**
 * Evaluates one group against an entity, honoring group combinator and `not`.
 */
function evaluateGroup(
  entity: Record<string, unknown>,
  group: AdvancedFilterGroupNode,
  fieldsByKey: Map<string, AdvancedFieldDefinition>,
  entityById: Map<string, Record<string, unknown>>,
  ruleCache: WeakMap<AdvancedFilterRuleNode, RuleEvaluationCache>,
  evaluationContext: RuleEvaluationContext,
): boolean {
  if (group.children.length === 0) {
    return true
  }

  let value: boolean
  if (group.combinator === 'or') {
    value = false
    for (const child of group.children) {
      const matches =
        child.kind === 'group'
          ? evaluateGroup(
              entity,
              child,
              fieldsByKey,
              entityById,
              ruleCache,
              evaluationContext,
            )
          : evaluateRule(
              entity,
              child,
              fieldsByKey,
              entityById,
              ruleCache,
              evaluationContext,
            )
      if (matches) {
        value = true
        break
      }
    }
  } else {
    value = true
    for (const child of group.children) {
      const matches =
        child.kind === 'group'
          ? evaluateGroup(
              entity,
              child,
              fieldsByKey,
              entityById,
              ruleCache,
              evaluationContext,
            )
          : evaluateRule(
              entity,
              child,
              fieldsByKey,
              entityById,
              ruleCache,
              evaluationContext,
            )
      if (!matches) {
        value = false
        break
      }
    }
  }

  return group.not ? !value : value
}

/**
 * Evaluates one rule against one entity.
 * Supports scalar operators and object `fields` operator.
 */
function evaluateRule(
  entity: Record<string, unknown>,
  rule: AdvancedFilterRuleNode,
  fieldsByKey: Map<string, AdvancedFieldDefinition>,
  entityById: Map<string, Record<string, unknown>>,
  ruleCache: WeakMap<AdvancedFilterRuleNode, RuleEvaluationCache>,
  evaluationContext: RuleEvaluationContext,
): boolean {
  if (!rule.fieldKey) {
    return false
  }
  const field = fieldsByKey.get(rule.fieldKey)
  if (!field) {
    return false
  }
  const effectiveValueKind = getEffectiveRuleValueKind(rule, field)
  if (rule.operator === 'fields') {
    if (!rule.fieldsRoot || field.objectSubfields.length === 0) {
      return false
    }
    const cached = ruleCache.get(rule)
    const nestedFieldsByKey =
      cached?.nestedFieldsByKey ??
      new Map(field.objectSubfields.map((subfield) => [subfield.key, subfield] as const))
    const objectEntities = getObjectEntitiesCached(
      entity,
      field,
      entityById,
      evaluationContext,
    )
    if (objectEntities.length === 0) {
      return false
    }
    for (const item of objectEntities) {
      if (
        evaluateGroup(
          item,
          rule.fieldsRoot,
          nestedFieldsByKey,
          entityById,
          ruleCache,
          evaluationContext,
        )
      ) {
        return true
      }
    }
    return false
  }

  const values = getComparableValuesCached(entity, field, evaluationContext)
  const hasValue = values.length > 0
  if (rule.operator === 'is_null') {
    return !hasValue
  }
  if (rule.operator === 'is_not_null') {
    return hasValue
  }

  const cached = ruleCache.get(rule)
  if (effectiveValueKind === 'date' && isDateComparableOperator(rule.operator)) {
    return evaluateDateRule(
      getDateDayKeysCached(entity, field, evaluationContext),
      rule.operator,
      cached?.dateQueryDayKeys,
    )
  }

  const normalizedValues = getNormalizedComparableValuesCached(
    entity,
    field,
    evaluationContext,
  )
  const queries =
    cached?.normalizedQueries ??
    decodeAdvancedRuleValues(rule.value).map((value) => value.toLocaleLowerCase())
  const query = queries[0] ?? ''

  switch (rule.operator) {
    case 'equal':
      if (effectiveValueKind === 'entity') {
        return hasExactValueSetMatch(normalizedValues, queries)
      }
      if (queries.length > 1) {
        return queries.every((value) => normalizedValues.includes(value))
      }
      return normalizedValues.some((value) => value === query)
    case 'not_equal':
      if (effectiveValueKind === 'entity') {
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

/**
 * Evaluates date/date-time operators using normalized calendar-day keys.
 */
function evaluateDateRule(
  dateValues: number[],
  operator: Extract<
    AdvancedRuleOperator,
    'equal' | 'not_equal' | 'lt' | 'lte' | 'gt' | 'gte' | 'between' | 'not_between'
  >,
  queryDayKeys: number[] | undefined,
): boolean {
  const normalizedQueryDates = queryDayKeys ?? []
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

/**
 * Resolves and flattens values of one property into comparable strings.
 */
function getComparableValues(
  entity: Record<string, unknown>,
  field: AdvancedFieldDefinition,
): string[] {
  return flattenComparableValues(entity[field.propertyName])
}

function createRuleEvaluationContext(): RuleEvaluationContext {
  return {
    comparableValuesByEntity: new WeakMap(),
    normalizedValuesByEntity: new WeakMap(),
    dateDayKeysByEntity: new WeakMap(),
    objectEntitiesByEntity: new WeakMap(),
  }
}

function getEntityPropertyCache<T>(
  store: WeakMap<Record<string, unknown>, Map<string, T>>,
  entity: Record<string, unknown>,
): Map<string, T> {
  let cache = store.get(entity)
  if (!cache) {
    cache = new Map<string, T>()
    store.set(entity, cache)
  }
  return cache
}

function getComparableValuesCached(
  entity: Record<string, unknown>,
  field: AdvancedFieldDefinition,
  evaluationContext: RuleEvaluationContext,
): string[] {
  const cache = getEntityPropertyCache(
    evaluationContext.comparableValuesByEntity,
    entity,
  )
  const existing = cache.get(field.propertyName)
  if (existing) {
    return existing
  }
  const values = getComparableValues(entity, field)
  cache.set(field.propertyName, values)
  return values
}

function getNormalizedComparableValuesCached(
  entity: Record<string, unknown>,
  field: AdvancedFieldDefinition,
  evaluationContext: RuleEvaluationContext,
): string[] {
  const cache = getEntityPropertyCache(
    evaluationContext.normalizedValuesByEntity,
    entity,
  )
  const existing = cache.get(field.propertyName)
  if (existing) {
    return existing
  }
  const normalized = getComparableValuesCached(entity, field, evaluationContext).map((value) =>
    value.toLocaleLowerCase(),
  )
  cache.set(field.propertyName, normalized)
  return normalized
}

function getDateDayKeysCached(
  entity: Record<string, unknown>,
  field: AdvancedFieldDefinition,
  evaluationContext: RuleEvaluationContext,
): number[] {
  const cache = getEntityPropertyCache(evaluationContext.dateDayKeysByEntity, entity)
  const existing = cache.get(field.propertyName)
  if (existing) {
    return existing
  }
  const dayKeys = getComparableValuesCached(entity, field, evaluationContext)
    .map((value) => toDateDayKey(value))
    .filter((value): value is number => value !== undefined)
  cache.set(field.propertyName, dayKeys)
  return dayKeys
}

function getObjectEntitiesCached(
  entity: Record<string, unknown>,
  field: AdvancedFieldDefinition,
  entityById: Map<string, Record<string, unknown>>,
  evaluationContext: RuleEvaluationContext,
): Record<string, unknown>[] {
  const cache = getEntityPropertyCache(
    evaluationContext.objectEntitiesByEntity,
    entity,
  )
  const existing = cache.get(field.propertyName)
  if (existing) {
    return existing
  }
  const values = resolveObjectEntities(entity[field.propertyName], entityById)
  cache.set(field.propertyName, values)
  return values
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

/**
 * Collects entity types present in the current crate and known by the profile.
 */
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

function collectAllEntityTypes(crate: Record<string, unknown> | undefined): string[] {
  const graph = Array.isArray(crate?.['@graph'])
    ? (crate['@graph'] as Record<string, unknown>[])
    : []
  const types = new Set<string>()
  for (const entity of graph) {
    for (const typeName of getEntityTypeNames(entity)) {
      types.add(typeName)
    }
  }
  return Array.from(types.values()).sort((a, b) => a.localeCompare(b))
}

function getSchemaTypeHierarchy(
  typeName: string,
  classes: Record<string, unknown>,
): string[] {
  const normalized = toTypeTail(typeName)
  if (!normalized) {
    return []
  }

  const collected = new Set<string>()
  const queue: string[] = [normalized]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || collected.has(current)) {
      continue
    }
    collected.add(current)

    const profileClass = asRecord(classes[current])
    const profileParents = Array.isArray(profileClass?.subClassOf)
      ? profileClass.subClassOf
      : []
    for (const parent of profileParents) {
      const parentTail = toTypeTail(String(parent))
      if (parentTail && !collected.has(parentTail)) {
        queue.push(parentTail)
      }
    }

    const schemaHierarchy = Array.isArray(SCHEMA_TYPE_DEFINITIONS[current]?.hierarchy)
      ? SCHEMA_TYPE_DEFINITIONS[current].hierarchy
      : []
    for (const parent of schemaHierarchy ?? []) {
      const parentTail = toTypeTail(String(parent))
      if (parentTail && !collected.has(parentTail)) {
        queue.push(parentTail)
      }
    }
  }

  if (!collected.has('Thing')) {
    collected.add('Thing')
  }
  return Array.from(collected.values())
}

function buildSchemaOrgCatalogFields(
  crate: Record<string, unknown> | undefined,
  classes: Record<string, unknown>,
): AdvancedFieldDefinition[] {
  const entityTypes = collectAllEntityTypes(crate)
  if (entityTypes.length === 0) {
    return []
  }

  const fieldsByProperty = new Map<string, AdvancedFieldDefinition>()
  for (const entityType of entityTypes) {
    const hierarchy = getSchemaTypeHierarchy(entityType, classes)
    for (const typeName of hierarchy) {
      const schemaInputs = Array.isArray(SCHEMA_TYPE_DEFINITIONS[typeName]?.inputs)
        ? SCHEMA_TYPE_DEFINITIONS[typeName].inputs
        : []
      for (const input of schemaInputs ?? []) {
        const propertyName = typeof input?.name === 'string' ? input.name.trim() : ''
        if (!propertyName) {
          continue
        }
        const ontologyLabel = resolveOntologyLabelForSchemaInput(input)

        const inputRecord = input as Record<string, unknown>
        const relationshipTypes = extractEntityTypes(inputRecord, classes)
        const expectsObjectValue = resolveExpectsObjectValue(
          inputRecord,
          classes,
          relationshipTypes,
        )
        const valueKinds = resolveValueKinds(
          inputRecord,
          classes,
          relationshipTypes,
          expectsObjectValue,
        )
        const valueKind = valueKinds[0] ?? 'text'
        const objectSubfields = expectsObjectValue
          ? buildObjectSubfields(relationshipTypes, classes)
          : []

        const existing = fieldsByProperty.get(propertyName)
        if (existing) {
          const supported = new Set(existing.supportedClasses)
          supported.add(entityType)
          existing.supportedClasses = Array.from(supported.values())

          const mergedEntityTypes = new Set(existing.entityTypes)
          for (const type of relationshipTypes) {
            mergedEntityTypes.add(type)
          }
          existing.entityTypes = Array.from(mergedEntityTypes.values())

          existing.expectsObjectValue = existing.expectsObjectValue || expectsObjectValue
          existing.valueKinds = sortAdvancedFieldValueKinds([
            ...getFieldValueKinds(existing),
            ...valueKinds,
          ])
          existing.valueKind = existing.valueKinds[0] ?? existing.valueKind
          const existingIsSchemaOrg = existing.schemaLabel
            .toLowerCase()
            .includes(SCHEMA_ORG_LABEL)
          if (ontologyLabel === SCHEMA_ORG_LABEL && !existingIsSchemaOrg) {
            existing.schemaLabel = SCHEMA_ORG_LABEL
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

        fieldsByProperty.set(propertyName, {
          key: `schemaorg::${propertyName}`,
          label:
            typeof input?.label === 'string' && input.label.trim().length > 0
              ? input.label.trim()
              : propertyName,
          schemaId: SCHEMA_ORG_SCHEMA_ID,
          schemaLabel: ontologyLabel,
          propertyName,
          help: typeof input?.help === 'string' ? input.help : undefined,
          supportedClasses: [entityType],
          entityTypes: relationshipTypes,
          expectsObjectValue,
          valueKind,
          valueKinds,
          objectSubfields,
        })
      }
    }
  }

  return Array.from(fieldsByProperty.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  )
}

function resolveOntologyLabelForSchemaInput(input: SchemaTypeDefinitionInput): string {
  const id = typeof input?.id === 'string' ? input.id.toLowerCase() : ''
  return id.includes(SCHEMA_ORG_LABEL) ? SCHEMA_ORG_LABEL : OTHER_ONTOLOGIES_LABEL
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
        : nls.localize('rockit/entitiesOverview/about', 'About')
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
    const schemaInputs = tail ? SCHEMA_TYPE_DEFINITIONS[tail]?.inputs : undefined
    const schemaTypeHasInputs = Array.isArray(schemaInputs) && schemaInputs.length > 0
    if (tail && ((classDef && Array.isArray(classDef.inputs)) || schemaTypeHasInputs)) {
      entityTypes.add(tail)
    }
  }
  return Array.from(entityTypes.values())
}

/**
 * Builds selectable subfields for object-valued properties (e.g. Author -> Name/Affiliation).
 */
function buildObjectSubfields(
  entityTypes: string[],
  classes: Record<string, unknown>,
): AdvancedFieldDefinition[] {
  const subfieldsByKey = new Map<string, AdvancedFieldDefinition>()
  for (const entityType of entityTypes) {
    const classDef = asRecord(classes[entityType])
    const profileInputs =
      classDef && Array.isArray(classDef.inputs)
        ? (classDef.inputs as Record<string, unknown>[])
        : []
    const schemaInputs = Array.isArray(SCHEMA_TYPE_DEFINITIONS[entityType]?.inputs)
      ? (SCHEMA_TYPE_DEFINITIONS[entityType].inputs as Record<string, unknown>[])
      : []
    const inputs = profileInputs.length > 0 ? profileInputs : schemaInputs
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
      const subfieldValueKinds = resolveValueKinds(input, classes, [], false)
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
        valueKind: subfieldValueKinds[0] ?? 'text',
        valueKinds: subfieldValueKinds,
        objectSubfields: [],
      })
    }
  }
  return Array.from(subfieldsByKey.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  )
}

/**
 * Determines whether a field value is an object/reference rather than a scalar.
 */
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
    const schemaTypeHasInputs =
      tail &&
      Array.isArray(SCHEMA_TYPE_DEFINITIONS[tail]?.inputs) &&
      (SCHEMA_TYPE_DEFINITIONS[tail].inputs?.length ?? 0) > 0
    if (tail && (classes[tail] || schemaTypeHasInputs)) {
      return true
    }
    if (!isScalarType(raw)) {
      return true
    }
  }

  return false
}

function sortAdvancedFieldValueKinds(
  kinds: AdvancedFieldValueKind[],
): AdvancedFieldValueKind[] {
  return Array.from(new Set(kinds)).sort(
    (a, b) => (FIELD_VALUE_KIND_PRIORITY[a] ?? 999) - (FIELD_VALUE_KIND_PRIORITY[b] ?? 999),
  )
}

function getFieldValueKinds(field: AdvancedFieldDefinition): AdvancedFieldValueKind[] {
  const configured =
    field.valueKinds && field.valueKinds.length > 0 ? field.valueKinds : [field.valueKind]
  return sortAdvancedFieldValueKinds(configured)
}

function getEffectiveRuleValueKind(
  rule: AdvancedFilterRuleNode,
  field: AdvancedFieldDefinition,
): AdvancedFieldValueKind {
  const kinds = getFieldValueKinds(field)
  if (rule.operator === 'fields' && kinds.includes('entity')) {
    return 'entity'
  }
  if (rule.valueKind && kinds.includes(rule.valueKind)) {
    return rule.valueKind
  }
  return kinds[0] ?? 'text'
}

/**
 * Classifies supported value modes for one field (object/text/url/date).
 */
function resolveValueKinds(
  input: Record<string, unknown>,
  classes: Record<string, unknown>,
  entityTypes: string[],
  expectsObjectValue: boolean,
): AdvancedFieldValueKind[] {
  const kinds = new Set<AdvancedFieldValueKind>()

  if (expectsObjectValue || entityTypes.length > 0) {
    kinds.add('entity')
  }
  if (Array.isArray(input.values) && input.values.length > 0) {
    kinds.add('text')
  }

  const rawType = input.type
  const typeValues = Array.isArray(rawType) ? rawType : rawType ? [rawType] : []
  for (const typeValue of typeValues) {
    const raw = String(typeValue)
    if (!raw.trim()) {
      continue
    }
    const normalized = raw.trim().toLowerCase()
    if (isDateType(normalized)) {
      kinds.add('date')
      continue
    }
    if (
      normalized.includes('url') ||
      normalized.includes('uri') ||
      normalized.includes('iri')
    ) {
      kinds.add('url')
      continue
    }
    if (isScalarType(raw)) {
      kinds.add('text')
      continue
    }
    const tail = toTypeTail(raw)
    const classDef = tail ? asRecord(classes[tail]) : undefined
    const schemaInputs = tail ? SCHEMA_TYPE_DEFINITIONS[tail]?.inputs : undefined
    const schemaTypeHasInputs = Array.isArray(schemaInputs) && schemaInputs.length > 0
    if (tail && ((classDef && Array.isArray(classDef.inputs)) || schemaTypeHasInputs)) {
      kinds.add('entity')
      continue
    }
    kinds.add('entity')
  }

  if (kinds.size === 0) {
    kinds.add('text')
  }
  return sortAdvancedFieldValueKinds(Array.from(kinds.values()))
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

function decodeDateQueryDayKeys(rawValue: string): number[] {
  const queryDates = decodeAdvancedRuleValues(rawValue)
    .map((value) => toDateDayKey(value))
    .filter((value): value is number => value !== undefined)
  const normalizedQueryDates =
    queryDates.length >= 2
      ? queryDates
      : decodeDateQueryValues(rawValue)
          .map((value) => toDateDayKey(value))
          .filter((value): value is number => value !== undefined)
  return normalizedQueryDates
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

function buildRuleEvaluationCache(
  group: AdvancedFilterGroupNode,
  fieldsByKey: Map<string, AdvancedFieldDefinition>,
  cache: WeakMap<AdvancedFilterRuleNode, RuleEvaluationCache> = new WeakMap(),
): { cache: WeakMap<AdvancedFilterRuleNode, RuleEvaluationCache>; ruleCount: number } {
  let ruleCount = 0
  for (const child of group.children) {
    if (child.kind === 'group') {
      const nested = buildRuleEvaluationCache(child, fieldsByKey, cache)
      ruleCount += nested.ruleCount
      continue
    }

    const field = child.fieldKey ? fieldsByKey.get(child.fieldKey) : undefined
    const decodedValues = decodeAdvancedRuleValues(child.value)
    const effectiveValueKind = field ? getEffectiveRuleValueKind(child, field) : undefined
    const entry: RuleEvaluationCache = {
      normalizedQueries: decodedValues.map((value) =>
        value.toLocaleLowerCase(),
      ),
    }

    if (effectiveValueKind === 'date' && isDateComparableOperator(child.operator)) {
      entry.dateQueryDayKeys = decodeDateQueryDayKeys(child.value)
    }

    if (child.operator === 'fields' && field && field.objectSubfields.length > 0) {
      const nestedFieldsByKey = new Map(
        field.objectSubfields.map((subfield) => [subfield.key, subfield] as const),
      )
      entry.nestedFieldsByKey = nestedFieldsByKey
      if (child.fieldsRoot) {
        const nested = buildRuleEvaluationCache(child.fieldsRoot, nestedFieldsByKey, cache)
        ruleCount += nested.ruleCount
      }
    }

    cache.set(child, entry)
    ruleCount += 1
  }

  return { cache, ruleCount }
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
            valueKind: child.valueKind,
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

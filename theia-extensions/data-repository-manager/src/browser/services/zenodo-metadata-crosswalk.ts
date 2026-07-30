import crosswalk = require('../metadata-crosswalks/ro-crate-repository-crosswalk.json')

type JsonObject = Record<string, unknown>

interface RequirementCondition {
  field: string
  equals?: unknown
  in?: unknown[]
}

interface ConditionalRequirement {
  when: RequirementCondition
}

interface ZenodoRequirements {
  alwaysRequired: string[]
  conditionalRequired: Record<string, ConditionalRequirement>
}

interface SourceCandidate {
  entity?: string
  entityClass?: string
  property?: string
  localName?: string
}

interface MappingOperation extends JsonObject {
  operation: string
}

interface ZenodoMapping {
  id: string
  mappingStatus: string
  source?: {
    canonicalCandidates?: SourceCandidate[]
    selection?: string
  }
  target: {
    field: string
    path: string
    type?: string
    required?: boolean
  }
  transformations: MappingOperation[]
}

interface RepositoryCrosswalk {
  repositories: {
    zenodo: {
      officialRequirements: ZenodoRequirements
      schema: {
        properties: Record<string, JsonObject>
      }
    }
  }
  crosswalks: {
    canonicalToZenodo: {
      mappings: ZenodoMapping[]
    }
  }
}

export interface ZenodoMappingDiagnostic {
  mappingId: string
  targetField: string
  outcome: 'mapped' | 'omitted' | 'defaulted' | 'needsReview'
  message: string
}

export interface ZenodoCrosswalkResult {
  metadata: Record<string, unknown>
  diagnostics: ZenodoMappingDiagnostic[]
}

const repositoryCrosswalk = crosswalk as RepositoryCrosswalk
const EMPTY = Symbol('empty-crosswalk-value')
type MappingValue = unknown | typeof EMPTY

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function values(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === EMPTY ? [] : [value]
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === EMPTY || value === null || value === undefined) {
    return false
  }
  if (typeof value === 'string') {
    return value.trim().length > 0 && value !== './' && value !== '.'
  }
  if (Array.isArray(value)) {
    return value.some(hasMeaningfulValue)
  }
  if (isObject(value)) {
    return Object.values(value).some(hasMeaningfulValue)
  }
  return true
}

function strings(value: unknown): string[] {
  return values(value)
    .flatMap((item) => {
      if (typeof item === 'string') {
        return [item]
      }
      if (typeof item === 'number' || typeof item === 'boolean') {
        return [String(item)]
      }
      return []
    })
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== './' && item !== '.')
}

function entityTypes(entity: JsonObject): string[] {
  return strings(entity['@type'])
}

function unique(valuesToDeduplicate: unknown[]): unknown[] {
  const seen = new Set<string>()
  return valuesToDeduplicate.filter((value) => {
    const key = isObject(value)
      ? `object:${String(value['@id'] ?? JSON.stringify(value))}`
      : `${typeof value}:${String(value)}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function readGraph(crate: JsonObject): JsonObject[] {
  const graph = crate['@graph']
  return Array.isArray(graph) ? graph.filter(isObject) : []
}

function resolveReferences(value: MappingValue, graph: JsonObject[]): MappingValue {
  const byId = new Map(
    graph
      .map((entity) => [entity['@id'], entity] as const)
      .filter((entry): entry is readonly [string, JsonObject] =>
        typeof entry[0] === 'string',
      ),
  )
  const resolve = (item: unknown): unknown => {
    if (typeof item === 'string' && byId.has(item)) {
      return byId.get(item)
    }
    if (isObject(item) && typeof item['@id'] === 'string') {
      return byId.get(item['@id']) ?? item
    }
    return item
  }
  const resolved = unique(values(value).map(resolve))
  return resolved.length ? resolved : EMPTY
}

function candidateValue(
  candidate: SourceCandidate,
  root: JsonObject,
  graph: JsonObject[],
): MappingValue {
  const localName = candidate.localName
  if (!localName) {
    return EMPTY
  }
  const propertyName =
    candidate.property === '@type' && localName === 'upload_type'
      ? '@type'
      : localName

  if (candidate.entity === 'root' || !candidate.entity) {
    const direct = root[propertyName]
    return hasMeaningfulValue(direct) ? direct : EMPTY
  }

  const matchingEntities = graph.filter((entity) => {
    const types = entityTypes(entity)
    return (
      types.includes(candidate.entity ?? '') ||
      types.includes(candidate.entityClass ?? '')
    )
  })
  const found = matchingEntities.flatMap((entity) => values(entity[propertyName]))
  return found.some(hasMeaningfulValue) ? found : EMPTY
}

function selectSourceValue(
  mapping: ZenodoMapping,
  root: JsonObject,
  graph: JsonObject[],
): MappingValue {
  for (const candidate of mapping.source?.canonicalCandidates ?? []) {
    const value = candidateValue(candidate, root, graph)
    if (hasMeaningfulValue(value)) {
      return value
    }
  }
  return EMPTY
}

function recursivelyTrim(value: MappingValue): MappingValue {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (Array.isArray(value)) {
    return value.map(recursivelyTrim)
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, recursivelyTrim(child)]),
    )
  }
  return value
}

function omitValues(value: MappingValue, omitted: unknown[]): MappingValue {
  const retained = values(value).filter(
    (item) => !omitted.some((candidate) => candidate === item),
  )
  return retained.length ? (Array.isArray(value) ? retained : retained[0]) : EMPTY
}

function first(value: MappingValue): MappingValue {
  return Array.isArray(value) ? value.find(hasMeaningfulValue) ?? EMPTY : value
}

function normalizeDate(value: MappingValue): MappingValue {
  const normalized = strings(value)
    .map((item) => {
      const match = item.match(/^(\d{4}-\d{2}-\d{2})/)
      if (match) {
        return match[1]
      }
      const parsed = new Date(item)
      return Number.isNaN(parsed.getTime())
        ? undefined
        : parsed.toISOString().slice(0, 10)
    })
    .filter((item): item is string => !!item)
  return normalized.length ? normalized : EMPTY
}

function textFromObject(entity: JsonObject): string[] {
  const preferredFields = [
    'dsDescriptionValue',
    'keywordValue',
    'notesText',
    'socialScienceNotesText',
    'otherReferences',
    'relatedMaterial',
    'name',
    'title',
    'description',
    'value',
  ]
  for (const field of preferredFields) {
    const found = strings(entity[field])
    if (found.length) {
      return found
    }
  }
  return []
}

function flattenText(value: MappingValue, separator: string): MappingValue {
  const flattened = values(value).flatMap((item) =>
    isObject(item) ? textFromObject(item) : strings(item),
  )
  return flattened.length ? flattened.join(separator) : EMPTY
}

function readEntityField(
  entity: JsonObject,
  definition: unknown,
  targetField: string,
): MappingValue {
  const candidates = Array.isArray(definition)
    ? definition
    : isObject(definition) && Array.isArray(definition.source)
      ? definition.source
      : []
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue
    }
    const value = entity[candidate]
    if (hasMeaningfulValue(value)) {
      if (targetField === 'orcid') {
        const scheme = strings(
          entity.authorIdentifierScheme ?? entity.identifierScheme,
        )[0]?.toLowerCase()
        if (scheme !== 'orcid') {
          continue
        }
      }
      return first(value)
    }
  }
  if (isObject(definition) && definition.default !== undefined) {
    return definition.default
  }
  return EMPTY
}

function mapEntities(value: MappingValue, operation: MappingOperation): MappingValue {
  const fields = isObject(operation.fields) ? operation.fields : {}
  const mapped = values(value)
    .map((item) => {
      const entity = isObject(item) ? item : { name: item }
      const target = Object.fromEntries(
        Object.entries(fields)
          .map(([targetField, definition]) => [
            targetField,
            readEntityField(entity, definition, targetField),
          ])
          .filter((entry) => hasMeaningfulValue(entry[1])),
      )
      return target
    })
    .filter(hasMeaningfulValue)
  return mapped.length ? mapped : EMPTY
}

function deriveAccessRight(value: MappingValue, defaultValue: unknown): MappingValue {
  const text = strings(value)[0]?.toLowerCase()
  if (!text) {
    return defaultValue ?? 'open'
  }
  if (['open', 'public', 'unrestricted'].includes(text)) {
    return 'open'
  }
  if (text.includes('embargo')) {
    return 'embargoed'
  }
  if (text.includes('restrict')) {
    return 'restricted'
  }
  if (text.includes('closed')) {
    return 'closed'
  }
  return defaultValue ?? 'open'
}

function inferResourceType(value: MappingValue): MappingValue {
  const types = strings(value).map((item) => item.toLowerCase())
  if (types.some((type) => type.includes('software'))) {
    return 'software'
  }
  if (types.some((type) => type.includes('image'))) {
    return 'image'
  }
  if (types.some((type) => type.includes('publication'))) {
    return 'publication'
  }
  return types.some((type) => type.includes('dataset')) ? 'dataset' : EMPTY
}

function aggregateIdentifiers(value: MappingValue): MappingValue {
  const aggregated = values(value)
    .flatMap((item) => {
      if (!isObject(item)) {
        return strings(item).map((identifier) => ({
          identifier,
          relation: 'isRelatedTo',
        }))
      }
      const identifier = strings(
        item.otherIdValue ??
          item.publicationIDNumber ??
          item.identifier ??
          item['@id'],
      )[0]
      if (!identifier) {
        return []
      }
      return [{
        identifier,
        relation: strings(item.relation ?? item.publicationRelationType)[0] ??
          'isRelatedTo',
      }]
    })
  return aggregated.length ? aggregated : EMPTY
}

function mapVocabulary(
  value: MappingValue,
  operation: MappingOperation,
): MappingValue {
  const mappings = isObject(operation.values) ? operation.values : {}
  const mapped = values(value).flatMap((item) => {
    const source = strings(item)[0]
    if (!source) {
      return []
    }
    const target = mappings[source]
    if (typeof target === 'string') {
      return [target]
    }
    return operation.onUnknown === 'keep' ? [source] : []
  })
  return mapped.length ? (Array.isArray(value) ? mapped : mapped[0]) : EMPTY
}

function applyOperation(
  value: MappingValue,
  operation: MappingOperation,
  graph: JsonObject[],
): MappingValue {
  switch (operation.operation) {
    case 'omitEmpty':
      return hasMeaningfulValue(value) ? value : EMPTY
    case 'omitValues':
      return omitValues(value, Array.isArray(operation.values) ? operation.values : [])
    case 'trim':
      return recursivelyTrim(value)
    case 'firstNonEmpty':
      return first(value)
    case 'first':
      return first(value)
    case 'asArray':
      return hasMeaningfulValue(value) ? values(value) : EMPTY
    case 'normalizeDate':
      return normalizeDate(value)
    case 'resolveReferences':
      return resolveReferences(value, graph)
    case 'mapEntities':
      return mapEntities(value, operation)
    case 'flattenText':
      return flattenText(value, String(operation.separator ?? '\n'))
    case 'deriveAccessRight':
      return deriveAccessRight(value, operation.default)
    case 'inferResourceType':
      return inferResourceType(value)
    case 'defaultValue':
      return hasMeaningfulValue(value) ? value : operation.value
    case 'aggregateIdentifiers':
      return aggregateIdentifiers(value)
    case 'mapVocabulary':
      return mapVocabulary(value, operation)
    default:
      throw new Error(
        `Unsupported crosswalk operation '${operation.operation}'.`,
      )
  }
}

function coerceTargetValue(mapping: ZenodoMapping, value: MappingValue): MappingValue {
  if (!hasMeaningfulValue(value)) {
    return EMPTY
  }
  if (mapping.target.type === 'array') {
    const structuredArray = mapping.transformations.some((operation) =>
      ['mapEntities', 'aggregateIdentifiers'].includes(operation.operation),
    )
    if (structuredArray) {
      return values(value)
    }
    const array = values(value).flatMap((item) => {
      if (!isObject(item)) {
        return [item]
      }
      const text = textFromObject(item)
      return text.length ? text : [item]
    })
    return array.length ? array : EMPTY
  }
  return first(value)
}

function conditionMatches(
  metadata: Record<string, unknown>,
  condition: RequirementCondition,
): boolean {
  const value = metadata[condition.field]
  if (condition.equals !== undefined) {
    return value === condition.equals
  }
  if (condition.in) {
    return condition.in.includes(value)
  }
  return false
}

export function missingRequiredZenodoMetadataFields(
  metadata: Record<string, unknown>,
): string[] {
  const requirements =
    repositoryCrosswalk.repositories.zenodo.officialRequirements
  const required = new Set(requirements.alwaysRequired)

  for (const [field, requirement] of Object.entries(
    requirements.conditionalRequired,
  )) {
    if (conditionMatches(metadata, requirement.when)) {
      required.add(field)
    }
  }

  return Array.from(required)
    .filter((field) => !hasMeaningfulValue(metadata[field]))
    .sort()
}

/**
 * Executes accepted canonical-to-Zenodo mappings from the generated crosswalk.
 *
 * `mapped` rules are emitted. Required `needsReview` rules are also executed
 * so their declared fallback/validation behavior can satisfy the repository
 * contract; the report keeps that review status visible.
 */
export function buildZenodoMetadataFromCrosswalk(
  crate: Record<string, unknown>,
): ZenodoCrosswalkResult {
  const graph = readGraph(crate)
  const root = graph.find((entity) => entity['@id'] === './')
  if (!root) {
    throw new Error('The RO-Crate does not contain a root Dataset with @id "./".')
  }

  const metadata: Record<string, unknown> = {}
  const diagnostics: ZenodoMappingDiagnostic[] = []
  const mappings =
    repositoryCrosswalk.crosswalks.canonicalToZenodo.mappings

  for (const mapping of mappings) {
    const executable =
      mapping.mappingStatus === 'mapped' ||
      (mapping.mappingStatus === 'needsReview' && mapping.target.required)
    if (!executable) {
      diagnostics.push({
        mappingId: mapping.id,
        targetField: mapping.target.field,
        outcome:
          mapping.mappingStatus === 'needsReview' ? 'needsReview' : 'omitted',
        message: `Mapping status is ${mapping.mappingStatus}; field was not uploaded automatically.`,
      })
      continue
    }

    let value = selectSourceValue(mapping, root, graph)
    let defaulted = false
    for (const operation of mapping.transformations) {
      const before = value
      value = applyOperation(value, operation, graph)
      if (
        operation.operation === 'defaultValue' &&
        !hasMeaningfulValue(before) &&
        hasMeaningfulValue(value)
      ) {
        defaulted = true
      }
    }
    value = coerceTargetValue(mapping, value)

    if (hasMeaningfulValue(value)) {
      metadata[mapping.target.field] = value
      diagnostics.push({
        mappingId: mapping.id,
        targetField: mapping.target.field,
        outcome: defaulted ? 'defaulted' : 'mapped',
        message: defaulted
          ? 'Mapped using the crosswalk repository fallback.'
          : 'Mapped from RO-Crate using the crosswalk.',
      })
    } else {
      diagnostics.push({
        mappingId: mapping.id,
        targetField: mapping.target.field,
        outcome: 'omitted',
        message: 'No meaningful mapped source value was available.',
      })
    }
  }

  return { metadata, diagnostics }
}

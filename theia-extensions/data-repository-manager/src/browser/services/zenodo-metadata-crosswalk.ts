import crosswalk = require('../crosswalks/arp-zenodo-crosswalk.json')

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
  direction?: string
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

export interface ZenodoReverseCrosswalkResult {
  crate: Record<string, unknown>
  updatedFields: string[]
}

export interface ZenodoMetadataOption {
  value: string
  label: string
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

function readMutableGraph(crate: JsonObject): JsonObject[] {
  const graph = crate['@graph']
  if (!Array.isArray(graph)) {
    crate['@graph'] = []
    return crate['@graph'] as JsonObject[]
  }
  return graph as JsonObject[]
}

/**
 * Resolves a crosswalk `resolveReferences` operation.
 *
 * This is important for fields such as Zenodo `keywords`: an RO-Crate keyword
 * may be stored directly as a string, as an inline object, or as an `@id`
 * reference to another entity in `@graph`. The generated mapping only declares
 * that references should be resolved; this executor performs the lookup against
 * the parsed graph before later operations coerce the value for the target
 * Zenodo field.
 */
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

function shouldSkipExportSource(mapping: ZenodoMapping, candidate: SourceCandidate): boolean {
  return (
    (mapping.target.field === 'access_right' && !!candidate.localName) ||
    (mapping.target.field === 'imprint_publisher' && candidate.localName === 'producer')
  )
}

/**
 * Selects the first populated source candidate declared by the mapping.
 *
 * The generated crosswalk already orders candidates according to its selection
 * policy. For `zenodo.keywords`, that means trying canonical/root `keyword`
 * first, then falling back to root `subject` only when keyword is absent.
 */
function selectSourceValue(
  mapping: ZenodoMapping,
  root: JsonObject,
  graph: JsonObject[],
): MappingValue {
  for (const candidate of mapping.source?.canonicalCandidates ?? []) {
    if (shouldSkipExportSource(mapping, candidate)) {
      continue
    }
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
    const source = strings(
      isObject(item)
        ? item['@id'] ?? item.identifier ?? item.name
        : item,
    )[0]
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

function htmlToPlainText(value: string): string {
  const withBreaks = value
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*p\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
  if (typeof document !== 'undefined') {
    const element = document.createElement('textarea')
    element.innerHTML = withBreaks
    return element.value.replace(/\n{3,}/g, '\n\n').trim()
  }
  return withBreaks
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function inverseVocabularyValue(value: unknown, mapping: ZenodoMapping): unknown {
  const operation = mapping.transformations.find((item) => item.operation === 'mapVocabulary')
  const mappings = operation && isObject(operation.values) ? operation.values : undefined
  const text = strings(value)[0]
  if (!text || !mappings) {
    return value
  }
  const entries = Object.entries(mappings)
    .filter(([, target]) => target === text)
    .map(([source]) => source)
  return entries.find((source) => /^https?:\/\//i.test(source)) ?? entries[0] ?? value
}

function firstWritableCandidate(mapping: ZenodoMapping): SourceCandidate | undefined {
  const candidates = mapping.source?.canonicalCandidates ?? []
  return (
    candidates.find((candidate) =>
      candidate.entity !== 'root' && !!candidate.localName,
    ) ??
    candidates.find((candidate) => candidate.entity === 'root' && !!candidate.localName)
  )
}

function setRootValue(root: JsonObject, candidate: SourceCandidate, value: unknown, mapping: ZenodoMapping): boolean {
  if (!candidate.localName || !hasMeaningfulValue(value)) {
    return false
  }
  const nextValue = mapping.transformations.some((operation) => operation.operation === 'mapVocabulary')
    ? inverseVocabularyValue(value, mapping)
    : value
  root[candidate.localName] = candidate.localName === 'license' && typeof nextValue === 'string' && /^https?:\/\//i.test(nextValue)
    ? { '@id': nextValue }
    : nextValue
  return true
}

function zenodoDescriptionText(value: unknown): string[] {
  return values(value)
    .flatMap((item) => {
      if (isObject(item)) {
        return strings(
          item.description ??
            item.text ??
            item.value ??
            item.title ??
            item.name,
        )
      }
      return strings(item)
    })
    .map(htmlToPlainText)
    .filter((item) => item.length > 0)
}

function collectZenodoDescriptionTexts(metadata: Record<string, unknown>): string[] {
  return unique([
    ...zenodoDescriptionText(metadata.description),
    ...zenodoDescriptionText(metadata.additional_descriptions),
    ...zenodoDescriptionText(metadata.additionalDescriptions),
    ...zenodoDescriptionText(metadata.additional_description),
    ...zenodoDescriptionText(metadata.additionalDescription),
    ...zenodoDescriptionText(metadata.notes),
  ]).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function rootDescriptionIds(root: JsonObject): string[] {
  return values(root.dsDescription)
    .flatMap((item) => isObject(item) ? strings(item['@id']) : strings(item))
}

function descriptionEntityId(root: JsonObject, index: number): string {
  const arpPid = strings(root['@arpPid'])[0]
  if (arpPid) {
    const suffix = index === 0 ? 'sync-description' : `sync-description-${index + 1}`
    return `https://w3id.org/arp/ro-id/${arpPid}/dsDescription/${suffix}`
  }
  return index === 0 ? '#description' : `#description-${index + 1}`
}

function generatedEntityId(root: JsonObject, typeName: string, index: number): string {
  const arpPid = strings(root['@arpPid'])[0]
  if (arpPid) {
    return `https://w3id.org/arp/ro-id/${arpPid}/${typeName}/sync-${index + 1}`
  }
  return `#${typeName}-${index + 1}`
}

function generatedKeywordEntityId(root: JsonObject, keyword: string, index: number): string {
  const arpPid = strings(root['@arpPid'])[0]
  if (arpPid) {
    return `https://w3id.org/arp/ro-id/${arpPid}/keyword/${encodeURIComponent(keyword)}`
  }
  const encoded = encodeURIComponent(keyword)
  return encoded ? `#${encoded}` : generatedEntityId(root, 'keyword', index)
}

function ensureContextTerm(crate: JsonObject, term: string, iri: string): void {
  const context = crate['@context']
  if (Array.isArray(context)) {
    const existingObject = context.find(isObject)
    if (existingObject) {
      existingObject[term] = existingObject[term] ?? iri
    } else {
      context.push({ [term]: iri })
    }
    return
  }
  if (isObject(context)) {
    context[term] = context[term] ?? iri
    return
  }
  if (typeof context === 'string') {
    crate['@context'] = [context, { [term]: iri }]
    return
  }
  crate['@context'] = [{ [term]: iri }]
}

function updateDescriptionEntities(root: JsonObject, graph: JsonObject[], descriptions: string[]): boolean {
  if (!descriptions.length) {
    return false
  }
  const referencedIds = rootDescriptionIds(root)
  const existingDescriptionEntities = graph.filter((entity) => entityTypes(entity).includes('dsDescription'))
  const refs: JsonObject[] = []
  descriptions.forEach((description, index) => {
    const id =
      referencedIds[index] ??
      strings(existingDescriptionEntities[index]?.['@id'])[0] ??
      descriptionEntityId(root, index)
    let entity = graph.find((item) => item['@id'] === id)
    if (!entity) {
      entity = {
        '@id': id,
        '@type': 'dsDescription',
        '@reverse': { dsDescription: { '@id': './' } },
      }
      graph.push(entity)
    }
    entity.name = description
    entity.dsDescriptionValue = description
    refs.push({ '@id': id })
  })
  root.dsDescription = refs.length === 1 ? refs[0] : refs
  return true
}

function updateCreatorEntities(root: JsonObject, graph: JsonObject[], value: unknown): boolean {
  const creators = values(value)
    .filter(isObject)
    .map((creator) => ({
      name: strings(creator.name)[0],
      affiliation: strings(creator.affiliation)[0],
      orcid: strings(creator.orcid)[0],
    }))
    .filter((creator) => !!creator.name)
  if (!creators.length) {
    return false
  }
  const existingRefs = values(root.author)
    .flatMap((item) => isObject(item) ? strings(item['@id']) : strings(item))
  const existingAuthors = graph.filter((entity) => entityTypes(entity).includes('author'))
  const refs: JsonObject[] = []
  creators.forEach((creator, index) => {
    const id =
      existingRefs[index] ??
      strings(existingAuthors[index]?.['@id'])[0] ??
      generatedEntityId(root, 'author', index)
    let entity = graph.find((item) => item['@id'] === id)
    if (!entity) {
      entity = {
        '@id': id,
        '@type': 'author',
        '@reverse': { author: { '@id': './' } },
      }
      graph.push(entity)
    }
    entity.name = creator.name
    entity.authorName = creator.name
    if (creator.affiliation) {
      entity.authorAffiliation = creator.affiliation
    } else {
      delete entity.authorAffiliation
    }
    if (creator.orcid) {
      entity.authorIdentifier = creator.orcid
      entity.authorIdentifierScheme = 'ORCID'
    }
    refs.push({ '@id': id })
  })
  root.author = refs.length === 1 ? refs[0] : refs
  return true
}

function updateKeywordEntities(crate: JsonObject, root: JsonObject, graph: JsonObject[], value: unknown): boolean {
  const keywords = unique(strings(value).map(htmlToPlainText))
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (!keywords.length) {
    return false
  }
  ensureContextTerm(crate, 'keyword', 'https://dataverse.org/schema/citation/keyword')
  const existingRefs = values(root.keyword)
    .flatMap((item) => isObject(item) ? strings(item['@id']) : strings(item))
  const existingKeywords = graph.filter((entity) => entityTypes(entity).includes('keyword'))
  const refs: JsonObject[] = []
  keywords.forEach((keyword, index) => {
    const id =
      existingRefs[index] ??
      strings(existingKeywords[index]?.['@id'])[0] ??
      generatedKeywordEntityId(root, keyword, index)
    let entity = graph.find((item) => item['@id'] === id)
    if (!entity) {
      entity = {
        '@id': id,
        '@type': 'keyword',
        '@reverse': { keyword: { '@id': './' } },
      }
      graph.push(entity)
    }
    entity.name = keyword
    entity.keywordValue = keyword
    entity['@reverse'] = { keyword: { '@id': './' } }
    refs.push({ '@id': id })
  })
  root.keyword = refs.length === 1 ? refs[0] : refs
  return true
}

function reverseScalarValue(value: unknown, mapping: ZenodoMapping): unknown {
  const mapped = mapping.transformations.some((operation) => operation.operation === 'mapVocabulary')
    ? inverseVocabularyValue(value, mapping)
    : value
  if (typeof mapped === 'string') {
    return htmlToPlainText(mapped)
  }
  if (Array.isArray(mapped)) {
    const decoded = mapped.map((item) => typeof item === 'string' ? htmlToPlainText(item) : item)
    return mapping.target.type === 'array' ? decoded : decoded[0]
  }
  return mapped
}

export function zenodoMetadataOptions(
  field: string,
): ZenodoMetadataOption[] {
  const property = repositoryCrosswalk.repositories.zenodo.schema.properties[field]
  const enumValues = property && Array.isArray(property.enum)
    ? property.enum
    : []
  return enumValues
    .filter((value): value is string => typeof value === 'string')
    .map((value) => ({ value, label: value }))
}

/**
 * Applies one declarative transformation from the generated crosswalk.
 *
 * Mappings remain data-driven: the JSON says which operation is needed for a
 * target field, and this switch is the runtime vocabulary that gives those
 * operation names behavior. For `zenodo.keywords`, the operations are
 * `omitEmpty`, `omitValues`, `trim`, `resolveReferences`, and `asArray`.
 */
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

/**
 * Coerces the transformed value into the target field shape required by the
 * Zenodo schema. For plain array targets such as `metadata.keywords`, object
 * values are reduced to readable text with `textFromObject`, so Dataverse-style
 * keyword objects contribute `keywordValue` rather than leaking their whole
 * structured object into Zenodo's string array.
 */
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
 * contract; the report keeps that review status visible. Field-specific logic,
 * including keyword extraction and coercion, is driven by each mapping's source
 * candidates and transformation list rather than hardcoded by target field.
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
        (operation.operation === 'defaultValue' || operation.operation === 'deriveAccessRight') &&
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

/**
 * Applies Zenodo deposition metadata back onto an RO-Crate using the
 * bidirectional source candidates declared in the crosswalk.
 *
 * The reverse path intentionally updates only fields that the crosswalk says
 * can travel both ways. Repository-only Zenodo fields stay out of the local
 * RO-Crate because there is no declared local field to overwrite safely.
 */
export function applyZenodoMetadataToRoCrate(
  crate: Record<string, unknown>,
  zenodoMetadata: Record<string, unknown>,
): ZenodoReverseCrosswalkResult {
  const nextCrate = JSON.parse(JSON.stringify(crate)) as Record<string, unknown>
  const graph = readMutableGraph(nextCrate)
  const root = graph.find((entity) => entity['@id'] === './')
  if (!root) {
    throw new Error('The RO-Crate does not contain a root Dataset with @id "./".')
  }

  const updatedFields: string[] = []
  if (updateDescriptionEntities(root, graph, collectZenodoDescriptionTexts(zenodoMetadata))) {
    updatedFields.push('description')
  }
  for (const mapping of repositoryCrosswalk.crosswalks.canonicalToZenodo.mappings) {
    if (mapping.direction !== 'both' || mapping.mappingStatus === 'repositorySpecific') {
      continue
    }
    if (['access_right', 'description', 'imprint_publisher', 'notes', 'upload_type'].includes(mapping.target.field)) {
      continue
    }
    const remoteValue = zenodoMetadata[mapping.target.field]
    if (!hasMeaningfulValue(remoteValue)) {
      continue
    }
    const candidate = firstWritableCandidate(mapping)
    if (!candidate) {
      continue
    }
    let updated = false
    switch (mapping.target.field) {
      case 'creators':
        updated = updateCreatorEntities(root, graph, remoteValue)
        break
      case 'keywords':
        updated = updateKeywordEntities(nextCrate, root, graph, remoteValue)
        break
      default:
        if (candidate.entity === 'root') {
          updated = setRootValue(root, candidate, reverseScalarValue(remoteValue, mapping), mapping)
        }
        break
    }
    if (updated) {
      updatedFields.push(mapping.target.field)
    }
  }

  return { crate: nextCrate, updatedFields }
}

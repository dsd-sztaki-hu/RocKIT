// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

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

interface SchemaOrgSource {
  property?: string
  rootTypes?: string[]
  containerType?: string
  requiredContainerType?: string
  shape?: 'textList' | 'creators' | 'places' | 'organizationName'
  constant?: string
}

interface ZenodoMapping {
  id: string
  direction?: string
  mappingStatus: string
  schemaOrgSources?: SchemaOrgSource[]
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
        definitions?: Record<string, JsonObject>
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

const EMPTY = Symbol('empty-crosswalk-value')
type MappingValue = unknown | typeof EMPTY

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function resolveRepositoryCrosswalk(value: unknown): RepositoryCrosswalk {
  if (value === undefined) {
    throw new Error('Select a Zenodo-compatible metadata crosswalk for this repository.')
  }
  if (!isObject(value)) {
    throw new Error('The selected Zenodo crosswalk must be a JSON object.')
  }
  const repositories = isObject(value.repositories) ? value.repositories : undefined
  const zenodo = repositories && isObject(repositories.zenodo)
    ? repositories.zenodo
    : undefined
  const schema = zenodo && isObject(zenodo.schema) ? zenodo.schema : undefined
  const requirements = zenodo && isObject(zenodo.officialRequirements)
    ? zenodo.officialRequirements
    : undefined
  const crosswalks = isObject(value.crosswalks) ? value.crosswalks : undefined
  const canonicalToZenodo = crosswalks && isObject(crosswalks.canonicalToZenodo)
    ? crosswalks.canonicalToZenodo
    : undefined
  if (
    !schema ||
    !isObject(schema.properties) ||
    !requirements ||
    !Array.isArray(requirements.alwaysRequired) ||
    !isObject(requirements.conditionalRequired) ||
    !canonicalToZenodo ||
    !Array.isArray(canonicalToZenodo.mappings)
  ) {
    throw new Error(
      'The selected crosswalk does not contain the Zenodo schema, requirements, and canonicalToZenodo mappings.',
    )
  }
  return value as unknown as RepositoryCrosswalk
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
      .filter(
        (entry): entry is readonly [string, JsonObject] => typeof entry[0] === 'string',
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

const SCHEMA_IRI = /^https?:\/\/schema\.org\//
// RO-Crate's versioned context lists terms explicitly and has no Schema.org default vocabulary.
const CRATE_SCHEMA_TERMS = ['Dataset', 'Person', 'Organization', 'PropertyValue', 'author',
  'name', 'description', 'affiliation', 'identifier', 'propertyID', 'value', 'keywords', 'citation',
  'spatialCoverage', 'Place', 'City', 'State', 'Country', 'AdministrativeArea', 'isPartOf',
  'Periodical', 'PublicationVolume', 'PublicationIssue', 'ScholarlyArticle', 'Article',
  'volumeNumber', 'issueNumber', 'pagination', 'Chapter', 'Book', 'Report', 'isbn', 'publisher']

function schemaTerm(term: string, context: unknown[]): string | undefined {
  if (SCHEMA_IRI.test(term)) return term.replace(SCHEMA_IRI, '')
  const entries = context.flatMap(values)
  const definitions: JsonObject = Object.create(null) as JsonObject
  for (const entry of entries) {
    if (typeof entry === 'string' && /^https?:\/\/schema\.org\/?$/.test(entry)) {
      definitions['@vocab'] = 'https://schema.org/'
    } else if (typeof entry === 'string' && /^https?:\/\/w3id\.org\/ro\/crate\/1\.[12]\/context$/.test(entry)) {
      for (const name of CRATE_SCHEMA_TERMS) definitions[name] = 'http://schema.org/' + name
      if (entry.includes('/1.2/')) definitions.measurementMethod = 'http://schema.org/measurementMethod'
    } else if (isObject(entry)) {
      Object.assign(definitions, entry)
    } else {
      // An unknown remote context can redefine previously established terms.
      for (const key of Object.keys(definitions)) delete definitions[key]
    }
  }
  const definition = definitions[term]
  const id = isObject(definition) ? definition['@id'] : definition
  const mapped = typeof id === 'string' ? id : term
  if (SCHEMA_IRI.test(mapped)) return mapped.replace(SCHEMA_IRI, '')
  const colon = mapped.indexOf(':')
  const prefix = definitions[mapped.slice(0, colon)]
  const namespace = isObject(prefix) ? prefix['@id'] : prefix
  const iri = colon > 0 && typeof namespace === 'string'
    ? namespace + mapped.slice(colon + 1)
    : colon < 0 && (typeof id === 'string' || !(term in definitions)) && typeof definitions['@vocab'] === 'string'
      ? definitions['@vocab'] + mapped : undefined
  return iri && SCHEMA_IRI.test(iri) ? iri.replace(SCHEMA_IRI, '') : undefined
}

function schemaKey(entity: JsonObject, term: string, context: unknown[]): string | undefined {
  return Object.keys(entity).find((key) => schemaTerm(key, [...context, ...values(entity['@context']).filter(item => item !== undefined)]) === term)
}

function schemaValue(entity: JsonObject, term: string, context: unknown[]): unknown {
  const key = schemaKey(entity, term, context)
  return key === undefined ? undefined : entity[key]
}

function schemaTypes(entity: JsonObject, context: unknown[]): string[] {
  const localContext = [...context, ...values(entity['@context']).filter(item => item !== undefined)]
  return entityTypes(entity).flatMap((type) => schemaTerm(type, localContext) ?? [])
}

function schemaLinks(entity: JsonObject, term: string, graph: JsonObject[], context: unknown[]): JsonObject[] {
  const links = values(schemaValue(entity, term, context)).filter(isObject)
  return values(resolveReferences(links, graph)).filter(isObject)
}

function schemaOwner(source: SchemaOrgSource, root: JsonObject, graph: JsonObject[], context: unknown[]): JsonObject | undefined {
  const { rootTypes, containerType, requiredContainerType } = source
  if (rootTypes && !schemaTypes(root, context).some(type => rootTypes.includes(type))) return undefined
  if (requiredContainerType && !schemaContainer(root, requiredContainerType, graph, context)) return undefined
  return containerType ? schemaContainer(root, containerType, graph, context) : root
}

function schemaContainer(root: JsonObject, containerType: string, graph: JsonObject[], context: unknown[]): JsonObject | undefined {
  const queue = schemaLinks(root, 'isPartOf', graph, context)
  const seen = new Set<JsonObject>([root])
  const matches: JsonObject[] = []
  for (const entity of queue) {
    if (seen.has(entity)) continue
    seen.add(entity)
    const types = schemaTypes(entity, context)
    if (types.includes(containerType)) {
      matches.push(entity)
    } else if (types.some(type => ['PublicationIssue', 'PublicationVolume'].includes(type))) {
      queue.push(...schemaLinks(entity, 'isPartOf', graph, context))
    }
  }
  return matches.length === 1 ? matches[0] : undefined
}

function schemaText(value: unknown): string[] {
  return strings(values(value).filter(item => typeof item === 'string'))
}

function schemaOrcid(entity: JsonObject, graph: JsonObject[], context: unknown[]): string | undefined {
  const typedIds = schemaLinks(entity, 'identifier', graph, context)
    .filter(item => schemaTypes(item, context).includes('PropertyValue') &&
      schemaText(schemaValue(item, 'propertyID', context))[0]?.toLowerCase() === 'orcid')
    .flatMap(item => schemaText(schemaValue(item, 'value', context)))
  return typedIds
    .map(item => item.replace(/^https?:\/\/orcid\.org\//i, ''))
    .find(item => /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(item))
}

function schemaCreator(entity: JsonObject, graph: JsonObject[], context: unknown[]): JsonObject {
  const organization = schemaLinks(entity, 'affiliation', graph, context)
    .find(item => schemaTypes(item, context).includes('Organization'))
  return Object.fromEntries(Object.entries({
    name: schemaText(entity.authorName)[0] ?? schemaText(schemaValue(entity, 'name', context))[0],
    affiliation: schemaText(entity.authorAffiliation)[0] ??
      (organization && schemaText(schemaValue(organization, 'name', context))[0]),
    orcid: schemaText(entity.authorIdentifierScheme)[0]?.toLowerCase() === 'orcid'
      ? schemaText(entity.authorIdentifier)[0] ?? schemaOrcid(entity, graph, context)
      : schemaOrcid(entity, graph, context),
  }).filter(([, value]) => hasMeaningfulValue(value)))
}

function schemaOrganization(owner: JsonObject, property: string, graph: JsonObject[], context: unknown[]): JsonObject | undefined {
  const organizations = schemaLinks(owner, property, graph, context)
    .filter(entity => schemaTypes(entity, context).includes('Organization'))
  return organizations.length === 1 ? organizations[0] : undefined
}

function isSchemaCreator(entity: JsonObject, context: unknown[]): boolean {
  return schemaTypes(entity, context).some(type => ['Person', 'Organization'].includes(type))
}

function isSchemaPlace(entity: JsonObject, context: unknown[]): boolean {
  return schemaTypes(entity, context).some(type => ['Place', 'City', 'State', 'Country', 'AdministrativeArea'].includes(type))
}

function readSchemaOrgSource(source: SchemaOrgSource, owner: JsonObject, graph: JsonObject[], context: unknown[]): MappingValue {
  if (source.constant !== undefined) return source.constant
  if (!source.property) return EMPTY
  if (source.shape === 'organizationName') {
    const organization = schemaOrganization(owner, source.property, graph, context)
    return organization ? schemaText(schemaValue(organization, 'name', context))[0] ?? EMPTY : EMPTY
  }
  if (source.shape === 'creators') {
    const linked = schemaLinks(owner, source.property, graph, context)
    if (!linked.some(entity => isSchemaCreator(entity, context))) return EMPTY
    return linked
      .filter(entity => isSchemaCreator(entity, context) ||
        entityTypes(entity).includes('author'))
      .map(entity => schemaCreator(entity, graph, context))
      .filter(entity => !!entity.name)
  }
  if (source.shape === 'places') {
    return schemaLinks(owner, source.property, graph, context)
      .filter(entity => isSchemaPlace(entity, context))
      .map(entity => {
        const place = schemaText(schemaValue(entity, 'name', context))[0]
        const description = schemaText(schemaValue(entity, 'description', context))[0]
        return description ? { place, description } : { place }
      })
      .filter(entity => !!entity.place)
  }
  const text = schemaText(schemaValue(owner, source.property, context))
  return source.shape === 'textList' ? text : text[0] ?? EMPTY
}

function selectedSchemaOrgSource(mapping: ZenodoMapping, root: JsonObject, graph: JsonObject[], context: unknown[]) {
  for (const source of mapping.schemaOrgSources ?? []) {
    const owner = schemaOwner(source, root, graph, context)
    if (!owner) continue
    const value = readSchemaOrgSource(source, owner, graph, context)
    if (hasMeaningfulValue(value)) return { source, owner, value }
  }
  return undefined
}

function updateSchemaText(entity: JsonObject, term: string, value: unknown, context: unknown[]): boolean {
  const key = schemaKey(entity, term, context)
  const text = schemaText(value)
  if (!key || !text.length) return false
  entity[key] = Array.isArray(entity[key]) || text.length > 1 ? text : text[0]
  return true
}

function updateSchemaOrgSource(
  source: SchemaOrgSource,
  owner: JsonObject,
  graph: JsonObject[],
  context: unknown[],
  remoteValue: unknown,
): boolean {
  if (!source.property) return false
  if (source.shape === 'organizationName') {
    const organization = schemaOrganization(owner, source.property, graph, context)
    return !!organization && updateSchemaText(organization, 'name', remoteValue, context)
  }
  if (source.shape !== 'creators' && source.shape !== 'places') {
    return updateSchemaText(owner, source.property, remoteValue, context)
  }

  const linked = schemaLinks(owner, source.property, graph, context)
  let updated = false
  for (const row of values(remoteValue).filter(isObject)) {
    if (source.shape === 'places') {
      const place = schemaText(row.place)[0]
      const matches = linked.filter(entity => isSchemaPlace(entity, context) &&
        schemaText(schemaValue(entity, 'name', context))[0] === place)
      if (place && matches.length === 1) {
        updated = updateSchemaText(matches[0], 'description', row.description, context) || updated
      }
      continue
    }
    const name = schemaText(row.name)[0]
    const orcid = schemaText(row.orcid)[0]?.replace(/^https?:\/\/orcid\.org\//i, '')
    const matches = linked.filter(entity => {
      if (!isSchemaCreator(entity, context) && !entityTypes(entity).includes('author')) return false
      const creator = schemaCreator(entity, graph, context)
      return orcid && creator.orcid ? creator.orcid === orcid : !!name && creator.name === name
    })
    if (matches.length !== 1) continue
    const entity = matches[0]
    if (entityTypes(entity).includes('author') && !isSchemaCreator(entity, context)) {
      const [updatedName] = schemaText(row.name)
      const [affiliation] = schemaText(row.affiliation)
      if (updatedName && Object.prototype.hasOwnProperty.call(entity, 'authorName')) {
        entity.authorName = updatedName
        updated = true
      }
      if (affiliation && Object.prototype.hasOwnProperty.call(entity, 'authorAffiliation')) {
        entity.authorAffiliation = affiliation
        updated = true
      }
      continue
    }
    updated = updateSchemaText(entity, 'name', row.name, context) || updated
    const organizations = schemaLinks(entity, 'affiliation', graph, context)
      .filter(item => schemaTypes(item, context).includes('Organization'))
    if (organizations.length === 1) {
      updated = updateSchemaText(organizations[0], 'name', row.affiliation, context) || updated
    }
  }
  return updated
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
    candidate.property === '@type' && localName === 'upload_type' ? '@type' : localName

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

function shouldSkipExportSource(
  mapping: ZenodoMapping,
  candidate: SourceCandidate,
): boolean {
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
  return Array.isArray(value) ? (value.find(hasMeaningfulValue) ?? EMPTY) : value
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
  const aggregated = values(value).flatMap((item) => {
    if (!isObject(item)) {
      return strings(item).map((identifier) => ({
        identifier,
        relation: 'isRelatedTo',
      }))
    }
    const identifier = strings(
      item.otherIdValue ?? item.publicationIDNumber ?? item.identifier ?? item['@id'],
    )[0]
    if (!identifier) {
      return []
    }
    return [
      {
        identifier,
        relation:
          strings(item.relation ?? item.publicationRelationType)[0] ?? 'isRelatedTo',
      },
    ]
  })
  return aggregated.length ? aggregated : EMPTY
}

function mapVocabulary(value: MappingValue, operation: MappingOperation): MappingValue {
  const mappings = isObject(operation.values) ? operation.values : {}
  const mapped = values(value).flatMap((item) => {
    const source = strings(
      isObject(item) ? (item['@id'] ?? item.identifier ?? item.name) : item,
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
  const operation = mapping.transformations.find(
    (item) => item.operation === 'mapVocabulary',
  )
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
    candidates.find(
      (candidate) => candidate.entity !== 'root' && !!candidate.localName,
    ) ??
    candidates.find((candidate) => candidate.entity === 'root' && !!candidate.localName)
  )
}

function setRootValue(
  root: JsonObject,
  candidate: SourceCandidate,
  value: unknown,
  mapping: ZenodoMapping,
): boolean {
  if (!candidate.localName || !hasMeaningfulValue(value)) {
    return false
  }
  const nextValue = mapping.transformations.some(
    (operation) => operation.operation === 'mapVocabulary',
  )
    ? inverseVocabularyValue(value, mapping)
    : value
  root[candidate.localName] =
    candidate.localName === 'license' &&
    typeof nextValue === 'string' &&
    /^https?:\/\//i.test(nextValue)
      ? { '@id': nextValue }
      : nextValue
  return true
}

function zenodoDescriptionText(value: unknown): string[] {
  return values(value)
    .flatMap((item) => {
      if (isObject(item)) {
        return strings(
          item.description ?? item.text ?? item.value ?? item.title ?? item.name,
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
  return values(root.dsDescription).flatMap((item) =>
    isObject(item) ? strings(item['@id']) : strings(item),
  )
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

function normalizeComparableText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function uniqueEntities(entities: JsonObject[]): JsonObject[] {
  const result: JsonObject[] = []
  const ids = new Set<string>()
  for (const entity of entities) {
    const id = strings(entity['@id'])[0]
    if (id ? ids.has(id) : result.includes(entity)) {
      continue
    }
    if (id) {
      ids.add(id)
    }
    result.push(entity)
  }
  return result
}

function matchExistingEntities<T>(
  incoming: T[],
  existing: JsonObject[],
  matches: (incomingValue: T, entity: JsonObject) => boolean,
): Map<number, JsonObject> {
  const assignments = new Map<number, JsonObject>()
  const used = new Set<JsonObject>()

  incoming.forEach((incomingValue, index) => {
    const exact = existing.find(
      (entity) => !used.has(entity) && matches(incomingValue, entity),
    )
    if (exact) {
      assignments.set(index, exact)
      used.add(exact)
    }
  })

  const remainingExisting = existing.filter((entity) => !used.has(entity))
  incoming.forEach((_incomingValue, index) => {
    if (assignments.has(index)) {
      return
    }
    const fallback = remainingExisting.shift()
    if (fallback) {
      assignments.set(index, fallback)
      used.add(fallback)
    }
  })
  return assignments
}

function availableGeneratedEntityId(
  root: JsonObject,
  graph: JsonObject[],
  typeName: string,
  preferredIndex: number,
): string {
  let index = preferredIndex
  let id = generatedEntityId(root, typeName, index)
  while (graph.some((entity) => entity['@id'] === id)) {
    index += 1
    id = generatedEntityId(root, typeName, index)
  }
  return id
}

function generatedKeywordEntityId(
  root: JsonObject,
  keyword: string,
  index: number,
): string {
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

function updateDescriptionEntities(
  root: JsonObject,
  graph: JsonObject[],
  descriptions: string[],
): boolean {
  if (!descriptions.length) {
    return false
  }
  const referencedIds = rootDescriptionIds(root)
  const existingDescriptionEntities = uniqueEntities([
    ...referencedIds
      .map((id) => graph.find((entity) => entity['@id'] === id))
      .filter((entity): entity is JsonObject => !!entity),
    ...graph.filter((entity) => entityTypes(entity).includes('dsDescription')),
  ])
  const assignments = matchExistingEntities(
    descriptions,
    existingDescriptionEntities,
    (description, entity) =>
      normalizeComparableText(description) ===
      normalizeComparableText(
        strings(entity.dsDescriptionValue ?? entity.description ?? entity.name)[0] ?? '',
      ),
  )
  const refs: JsonObject[] = []
  descriptions.forEach((description, index) => {
    const id =
      strings(assignments.get(index)?.['@id'])[0] ??
      availableDescriptionEntityId(root, graph, index)
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

function availableDescriptionEntityId(
  root: JsonObject,
  graph: JsonObject[],
  preferredIndex: number,
): string {
  let index = preferredIndex
  let id = descriptionEntityId(root, index)
  while (graph.some((entity) => entity['@id'] === id)) {
    index += 1
    id = descriptionEntityId(root, index)
  }
  return id
}

function updateCreatorEntities(
  root: JsonObject,
  graph: JsonObject[],
  value: unknown,
): boolean {
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
  const existingRefs = values(root.author).flatMap((item) =>
    isObject(item) ? strings(item['@id']) : strings(item),
  )
  const existingAuthors = uniqueEntities([
    ...existingRefs
      .map((id) => graph.find((entity) => entity['@id'] === id))
      .filter((entity): entity is JsonObject => !!entity),
    ...graph.filter((entity) => entityTypes(entity).includes('author')),
  ])
  const assignments = matchExistingEntities(
    creators,
    existingAuthors,
    (creator, entity) => creatorMatchesEntity(creator, entity),
  )
  const refs: JsonObject[] = []
  creators.forEach((creator, index) => {
    const id =
      strings(assignments.get(index)?.['@id'])[0] ??
      availableGeneratedEntityId(root, graph, 'author', index)
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

function creatorMatchesEntity(
  creator: {
    name: string | undefined
    affiliation: string | undefined
    orcid: string | undefined
  },
  entity: JsonObject,
): boolean {
  const entityOrcid = strings(
    entity.authorIdentifier ?? entity.orcid ?? entity.identifier,
  )[0]
  if (creator.orcid && entityOrcid) {
    return normalizeComparableText(creator.orcid) === normalizeComparableText(entityOrcid)
  }
  const entityName = strings(entity.authorName ?? entity.name)[0]
  const entityAffiliation = strings(entity.authorAffiliation ?? entity.affiliation)[0]
  return (
    normalizeComparableText(creator.name ?? '') ===
      normalizeComparableText(entityName ?? '') &&
    normalizeComparableText(creator.affiliation ?? '') ===
      normalizeComparableText(entityAffiliation ?? '')
  )
}

function updateKeywordEntities(
  crate: JsonObject,
  root: JsonObject,
  graph: JsonObject[],
  value: unknown,
): boolean {
  const keywords = unique(strings(value).map(htmlToPlainText)).filter(
    (item): item is string => typeof item === 'string' && item.length > 0,
  )
  if (!keywords.length) {
    return false
  }
  ensureContextTerm(crate, 'keyword', 'https://dataverse.org/schema/citation/keyword')
  const existingKeywords = uniqueEntities([
    ...values(root.keyword)
      .flatMap((item) => (isObject(item) ? strings(item['@id']) : strings(item)))
      .map((id) => graph.find((entity) => entity['@id'] === id))
      .filter((entity): entity is JsonObject => !!entity),
    ...graph.filter((entity) => entityTypes(entity).includes('keyword')),
  ])
  const assignments = matchExistingEntities(
    keywords,
    existingKeywords,
    (keyword, entity) =>
      normalizeComparableText(keyword) ===
      normalizeComparableText(strings(entity.keywordValue ?? entity.name)[0] ?? ''),
  )
  const refs: JsonObject[] = []
  keywords.forEach((keyword, index) => {
    const id =
      strings(assignments.get(index)?.['@id'])[0] ??
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
  const mapped = mapping.transformations.some(
    (operation) => operation.operation === 'mapVocabulary',
  )
    ? inverseVocabularyValue(value, mapping)
    : value
  if (typeof mapped === 'string') {
    return htmlToPlainText(mapped)
  }
  if (Array.isArray(mapped)) {
    const decoded = mapped.map((item) =>
      typeof item === 'string' ? htmlToPlainText(item) : item,
    )
    return mapping.target.type === 'array' ? decoded : decoded[0]
  }
  return mapped
}

export function zenodoMetadataOptions(
  field: string,
  crosswalkDocument: unknown,
): ZenodoMetadataOption[] {
  const activeCrosswalk = resolveRepositoryCrosswalk(crosswalkDocument)
  const property = activeCrosswalk.repositories.zenodo.schema.properties[field]
  const schema = activeCrosswalk.repositories.zenodo.schema
  const direct = property && Array.isArray(property.enum) ? property.enum : []
  const references = Array.isArray(property?.oneOf) ? property.oneOf : []
  const referenced = references.flatMap(candidate => {
    if (!isObject(candidate) || typeof candidate.$ref !== 'string') return []
    const key = candidate.$ref.match(/^#\/definitions\/([a-zA-Z0-9_-]+)$/)?.[1]
    const definition = key ? schema.definitions?.[key] : undefined
    return definition && Array.isArray(definition.enum) ? definition.enum : []
  })
  const enumValues = [...new Set([...direct, ...referenced])]
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
      throw new Error(`Unsupported crosswalk operation '${operation.operation}'.`)
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
  crosswalkDocument: unknown,
): string[] {
  const activeCrosswalk = resolveRepositoryCrosswalk(crosswalkDocument)
  const requirements = activeCrosswalk.repositories.zenodo.officialRequirements
  const required = new Set(requirements.alwaysRequired)

  for (const [field, requirement] of Object.entries(requirements.conditionalRequired)) {
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
  crosswalkDocument: unknown,
): ZenodoCrosswalkResult {
  const activeCrosswalk = resolveRepositoryCrosswalk(crosswalkDocument)
  const graph = readGraph(crate)
  const root = graph.find((entity) => entity['@id'] === './')
  if (!root) {
    throw new Error('The RO-Crate does not contain a root Dataset with @id "./".')
  }

  const metadata: Record<string, unknown> = {}
  const diagnostics: ZenodoMappingDiagnostic[] = []
  const mappings = activeCrosswalk.crosswalks.canonicalToZenodo.mappings
  const context = crate['@context'] === undefined ? [] : [crate['@context']]

  for (const mapping of mappings) {
    const schemaSource = selectedSchemaOrgSource(mapping, root, graph, context)
    const executable =
      mapping.mappingStatus === 'mapped' ||
      (mapping.mappingStatus === 'needsReview' && mapping.target.required)
    if (!executable && !schemaSource) {
      diagnostics.push({
        mappingId: mapping.id,
        targetField: mapping.target.field,
        outcome: mapping.mappingStatus === 'needsReview' ? 'needsReview' : 'omitted',
        message: `Mapping status is ${mapping.mappingStatus}; field was not uploaded automatically.`,
      })
      continue
    }

    let value = executable ? selectSourceValue(mapping, root, graph) : EMPTY
    let defaulted = false
    for (const operation of executable ? mapping.transformations : []) {
      const before = value
      value = applyOperation(value, operation, graph)
      if (
        (operation.operation === 'defaultValue' ||
          operation.operation === 'deriveAccessRight') &&
        !hasMeaningfulValue(before) &&
        hasMeaningfulValue(value)
      ) {
        defaulted = true
      }
    }
    if (schemaSource && (!hasMeaningfulValue(value) || defaulted || schemaSource.source.shape === 'creators')) {
      value = schemaSource.value
      defaulted = false
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
  crosswalkDocument: unknown,
): ZenodoReverseCrosswalkResult {
  const activeCrosswalk = resolveRepositoryCrosswalk(crosswalkDocument)
  const nextCrate = JSON.parse(JSON.stringify(crate)) as Record<string, unknown>
  const graph = readMutableGraph(nextCrate)
  const root = graph.find((entity) => entity['@id'] === './')
  if (!root) {
    throw new Error('The RO-Crate does not contain a root Dataset with @id "./".')
  }

  const updatedFields: string[] = []
  const context = nextCrate['@context'] === undefined ? [] : [nextCrate['@context']]
  if (
    updateDescriptionEntities(root, graph, collectZenodoDescriptionTexts(zenodoMetadata))
  ) {
    updatedFields.push('description')
  }
  for (const mapping of activeCrosswalk.crosswalks.canonicalToZenodo.mappings) {
    if (mapping.direction !== 'both' ||
      (mapping.mappingStatus === 'repositorySpecific' && !mapping.schemaOrgSources?.length)) {
      continue
    }
    if (
      [
        'access_right',
        'access_conditions',
        'description',
        'embargo_date',
        'notes',
        'upload_type',
      ].includes(mapping.target.field)
    ) {
      continue
    }
    const remoteValue = zenodoMetadata[mapping.target.field]
    if (!hasMeaningfulValue(remoteValue)) {
      continue
    }
    const schemaSource = selectedSchemaOrgSource(mapping, root, graph, context)
    const nativeSource = mapping.mappingStatus === 'mapped' && hasMeaningfulValue(selectSourceValue(mapping, root, graph))
    if (schemaSource && (!nativeSource || schemaSource.source.shape === 'creators')) {
      if (updateSchemaOrgSource(schemaSource.source, schemaSource.owner, graph, context, remoteValue)) {
        updatedFields.push(mapping.target.field)
      }
      continue
    }
    if (mapping.schemaOrgSources?.length && mapping.mappingStatus !== 'mapped') continue
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
          updated = setRootValue(
            root,
            candidate,
            reverseScalarValue(remoteValue, mapping),
            mapping,
          )
        }
        break
    }
    if (updated) {
      updatedFields.push(mapping.target.field)
    }
  }

  return { crate: nextCrate, updatedFields }
}

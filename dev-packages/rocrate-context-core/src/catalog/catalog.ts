import { RO_CRATE_VERSION } from '../constants'
import { CrateContext } from '../context/crate-context'
import { SchemaQueryService } from '../graph/queries'
import { DEFAULT_REGISTERED_SCHEMAS } from '../registry/defaults'
import type { RegisteredSchema } from '../registry/types'
import type { CrateContextType } from '../types'

/**
 * Distilled type item for UI/agent consumption.
 */
export type CatalogTypeEntry = {
  id: string
  label: string
  comment?: string
}

export type CatalogPropertyEntry = {
  id: string
  label: string
  comment?: string
  range: string[]
}

export type TypeDetails = {
  id: string
  label: string
  comment?: string
  parentTypeIds: string[]
  parentTypes: Array<{ id: string; label: string }>
  propertyCount: number
}

export type PropertyDetails = {
  id: string
  label: string
  comment?: string
  domain: string[]
  range: string[]
}

/**
 * Converts schema comment variants to plain text.
 */
function toCommentText(value: unknown): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
  }
  if (typeof value === 'object' && value !== null) {
    const maybeValue = (value as Record<string, unknown>)['@value']
    if (typeof maybeValue === 'string') {
      const trimmed = maybeValue.trim()
      return trimmed === '' ? undefined : trimmed
    }
  }
  return undefined
}

/**
 * Derives a compact fallback label from a URI.
 */
function uriLabel(uri: string): string {
  const hashSplit = uri.split('#')
  const tail = hashSplit[hashSplit.length - 1]
  const slashSplit = tail.split('/')
  return slashSplit[slashSplit.length - 1] || uri
}

/**
 * Simple lexical score used to rank catalog suggestions.
 */
function scoreTextMatch(query: string, ...fields: Array<string | undefined>): number {
  const q = query.trim().toLowerCase()
  if (q === '') return 0
  let score = 0
  for (const field of fields) {
    if (!field) continue
    const f = field.toLowerCase()
    if (f === q) score += 100
    else if (f.startsWith(q)) score += 60
    else if (f.includes(q)) score += 30
  }
  return score
}

/**
 * High-level ontology catalog for type/property listing and suggestion.
 *
 * This wraps context resolution + schema query APIs into bounded, distilled
 * outputs suitable for both UI pickers and LLM agents.
 */
export class OntologyCatalog {
  private constructor(
    private readonly crateContext: CrateContext,
    private readonly queryService: SchemaQueryService,
  ) {}

  /**
   * Creates a catalog instance from crate context and optional schema registry.
   */
  static async create(options: {
    crateContext: CrateContextType
    registeredSchemas?: RegisteredSchema[]
    eagerLoadSchemas?: boolean
  }): Promise<OntologyCatalog> {
    const crateContext = new CrateContext()
    await crateContext.setup(options.crateContext)

    const schemas = options.registeredSchemas ?? DEFAULT_REGISTERED_SCHEMAS
    const queryService = new SchemaQueryService(schemas)
    queryService.updateRegisteredSchemas(
      schemas,
      crateContext.specification ?? RO_CRATE_VERSION.V1_1_3,
    )

    if (options.eagerLoadSchemas !== false) {
      await queryService.loadAllSchemas()
    }

    return new OntologyCatalog(crateContext, queryService)
  }

  /**
   * Resolves a human-friendly label for a type URI.
   */
  private typeLabel(typeId: string): string {
    return this.crateContext.reverse(typeId) ?? uriLabel(typeId)
  }

  /**
   * Resolves a human-friendly label for a property URI.
   */
  private propertyLabel(propertyId: string): string {
    return this.crateContext.reverse(propertyId) ?? uriLabel(propertyId)
  }

  /**
   * Lists known types with optional lexical filtering and pagination.
   */
  async listTypes(options?: {
    search?: string
    offset?: number
    limit?: number
  }): Promise<CatalogTypeEntry[]> {
    const search = options?.search?.trim() ?? ''
    const offset = Math.max(0, options?.offset ?? 0)
    const limit = Math.max(1, Math.min(1000, options?.limit ?? 200))

    const graphRows = this.queryService.getAllClasses().map((entry) => {
      const label = this.typeLabel(entry['@id'])
      const comment = toCommentText(entry.comment)
      const score = search ? scoreTextMatch(search, label, entry['@id'], comment) : 1
      return {
        id: entry['@id'],
        label,
        comment,
        score,
      }
    })

    const knownIds = new Set(graphRows.map((row) => row.id))
    const contextRows = this.crateContext
      .getAllClasses()
      .filter((id) => !knownIds.has(id))
      .map((id) => {
        const label = this.typeLabel(id)
        const score = search ? scoreTextMatch(search, label, id) : 1
        return {
          id,
          label,
          comment: undefined as string | undefined,
          score,
        }
      })

    const rows = [...graphRows, ...contextRows]

    const filtered = search ? rows.filter((row) => row.score > 0) : rows

    filtered.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.label.localeCompare(b.label)
    })

    return filtered.slice(offset, offset + limit).map((row) => ({
      id: row.id,
      label: row.label,
      comment: row.comment,
    }))
  }

  /**
   * Returns ranked type suggestions for free-text query.
   */
  async suggestTypes(query: string, options?: { limit?: number }): Promise<CatalogTypeEntry[]> {
    const limit = Math.max(1, Math.min(1000, options?.limit ?? 20))
    return this.listTypes({ search: query, offset: 0, limit })
  }

  /**
   * Returns detailed metadata for one type.
   */
  async getTypeDetails(typeId: string): Promise<TypeDetails> {
    const parentTypeIds = await this.queryService.getClassParents(typeId)
    const properties = await this.queryService.getPossibleEntityProperties([typeId])
    const comment = toCommentText(await this.queryService.getPropertyComment(typeId))

    return {
      id: typeId,
      label: this.typeLabel(typeId),
      comment,
      parentTypeIds,
      parentTypes: parentTypeIds.map((id) => ({ id, label: this.typeLabel(id) })),
      propertyCount: properties.length,
    }
  }

  /**
   * Lists properties available for a type with optional inheritance, filtering and pagination.
   */
  async listPropertiesForType(
    typeId: string,
    options?: { includeInherited?: boolean; search?: string; offset?: number; limit?: number },
  ): Promise<CatalogPropertyEntry[]> {
    const search = options?.search?.trim() ?? ''
    const includeInherited = options?.includeInherited !== false
    const offset = Math.max(0, options?.offset ?? 0)
    const limit = Math.max(1, Math.min(1000, options?.limit ?? 200))

    const rows = includeInherited
      ? await this.queryService.getPossibleEntityProperties([typeId])
      : (await this.queryService.getClassSpecificProperties(typeId)).map((node) => ({
          '@id': node['@id'],
          comment: node.comment,
          range: node.range
            ? (Array.isArray(node.range) ? node.range : [node.range]).map((r) => ({
                '@id': r['@id'],
              }))
            : [],
        }))

    const mapped = rows.map((entry) => {
      const label = this.propertyLabel(entry['@id'])
      const comment = toCommentText(entry.comment)
      const score = search ? scoreTextMatch(search, label, entry['@id'], comment) : 1
      return {
        id: entry['@id'],
        label,
        comment,
        range: entry.range.map((r) => r['@id']),
        score,
      }
    })

    const filtered = search ? mapped.filter((row) => row.score > 0) : mapped
    filtered.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.label.localeCompare(b.label)
    })

    return filtered.slice(offset, offset + limit).map((row) => ({
      id: row.id,
      label: row.label,
      comment: row.comment,
      range: row.range,
    }))
  }

  /**
   * Returns ranked property suggestions constrained by type context.
   */
  async suggestProperties(
    typeIds: string[],
    query: string,
    options?: { limit?: number },
  ): Promise<CatalogPropertyEntry[]> {
    const limit = Math.max(1, Math.min(1000, options?.limit ?? 20))

    const rows = await this.queryService.getPossibleEntityProperties(typeIds)
    const mapped = rows.map((entry) => {
      const label = this.propertyLabel(entry['@id'])
      const comment = toCommentText(entry.comment)
      return {
        id: entry['@id'],
        label,
        comment,
        range: entry.range.map((r) => r['@id']),
        score: scoreTextMatch(query, label, entry['@id'], comment),
      }
    })

    mapped.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.label.localeCompare(b.label)
    })

    return mapped
      .filter((row) => row.score > 0)
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        label: row.label,
        comment: row.comment,
        range: row.range,
      }))
  }

  /**
   * Returns detailed metadata for one property.
   */
  async getPropertyDetails(propertyId: string): Promise<PropertyDetails> {
    const comment = toCommentText(await this.queryService.getPropertyComment(propertyId))
    const domain = (await this.queryService.getPropertyDomain(propertyId)).map((d) => d['@id'])
    const range = (await this.queryService.getPropertyRange(propertyId)).map((r) => r['@id'])

    return {
      id: propertyId,
      label: this.propertyLabel(propertyId),
      comment,
      domain,
      range,
    }
  }
}

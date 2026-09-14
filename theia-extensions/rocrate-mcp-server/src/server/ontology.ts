// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { OntologyCatalog } from 'rocrate-context-core'
import type {
  CrateContextType,
  RegisteredSchema as CoreRegisteredSchema,
} from 'rocrate-context-core'
import type { AccessMode } from './types'

/**
 * Helper payload shape for crate access in local/remote tool modes.
 */
type LoadedCrate = {
  mode: AccessMode
  crate: Record<string, unknown>
  cratePath?: string
}

type SchemaRegistryEntry = {
  id: string
  displayName: string
  matchesUrls: string[]
  schemaUrl: string
  activeOnSpec: string[]
}

type OntologyCatalogInstance = Awaited<ReturnType<typeof OntologyCatalog.create>>

/**
 * Parses a boolean parameter with fallback.
 */
function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Parses and bounds integer-like number parameters.
 */
function parseNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.floor(value)))
}

/**
 * Parses a string parameter with fallback.
 */
function parseString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/**
 * Parses a string array parameter, trimming empty entries.
 */
function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter((item) => item !== '')
}

/**
 * Returns crate @context or throws when missing.
 */
function getCrateContext(crate: Record<string, unknown>): unknown {
  if (!Object.prototype.hasOwnProperty.call(crate, '@context')) {
    throw new Error('Crate is missing @context. Ontology tools require a crate context.')
  }
  return crate['@context']
}

const catalogCache = new Map<string, Promise<OntologyCatalogInstance>>()
const MAX_CATALOG_CACHE_SIZE = 16

function toCoreRegisteredSchemas(entries: SchemaRegistryEntry[]): CoreRegisteredSchema[] {
  return entries.map((entry) => ({
    ...entry,
    activeOnSpec: [...entry.activeOnSpec] as CoreRegisteredSchema['activeOnSpec'],
  }))
}

/**
 * Creates/returns cached ontology catalogs keyed by context + load strategy.
 */
async function getCatalog(
  crate: Record<string, unknown>,
  eagerLoadSchemas: boolean,
  registeredSchemas: SchemaRegistryEntry[],
) {
  const context = getCrateContext(crate)
  const cacheKey = JSON.stringify({ context, eagerLoadSchemas, registeredSchemas })

  if (!catalogCache.has(cacheKey)) {
    const catalogPromise = OntologyCatalog.create({
      crateContext: context as CrateContextType,
      registeredSchemas: toCoreRegisteredSchemas(registeredSchemas),
      eagerLoadSchemas,
    })
    catalogCache.set(cacheKey, catalogPromise)

    if (catalogCache.size > MAX_CATALOG_CACHE_SIZE) {
      const firstKey = catalogCache.keys().next().value
      if (typeof firstKey === 'string') {
        catalogCache.delete(firstKey)
      }
    }
  }

  return catalogCache.get(cacheKey)!
}

/**
 * Factory for ontology MCP tool handlers backed by `rocrate-context-core`.
 */
export function createOntologyHelpers() {
  /**
   * Executes one ontology query/suggestion tool.
   */
  async function runOntologyTool(
    toolName: string,
    loaded: LoadedCrate,
    params: Record<string, unknown>,
    registeredSchemas: SchemaRegistryEntry[],
  ): Promise<Record<string, unknown> | null> {
    if (
      ![
        'list_types',
        'suggest_types',
        'get_type_details',
        'list_properties_for_type',
        'suggest_properties',
        'get_property_details',
      ].includes(toolName)
    ) {
      return null
    }

    const eagerLoadSchemas = parseBoolean(params.eagerLoadSchemas, true)
    const catalog = await getCatalog(loaded.crate, eagerLoadSchemas, registeredSchemas)

    if (toolName === 'list_types') {
      const search = parseString(params.search)
      const offset = parseNumber(params.offset, 0, 0, 100000)
      const limit = parseNumber(params.limit, 200, 1, 1000)
      const items = await catalog.listTypes({ search, offset, limit })
      return {
        mode: loaded.mode,
        cratePath: loaded.cratePath,
        search,
        offset,
        limit,
        items,
      }
    }

    if (toolName === 'suggest_types') {
      const query = parseString(params.query).trim()
      if (query === '') {
        throw new Error('suggest_types requires non-empty query.')
      }
      const limit = parseNumber(params.limit, 20, 1, 1000)
      const items = await catalog.suggestTypes(query, { limit })
      return {
        mode: loaded.mode,
        cratePath: loaded.cratePath,
        query,
        limit,
        items,
      }
    }

    if (toolName === 'get_type_details') {
      const typeId = parseString(params.typeId).trim()
      if (typeId === '') {
        throw new Error('get_type_details requires typeId.')
      }
      const details = await catalog.getTypeDetails(typeId)
      return {
        mode: loaded.mode,
        cratePath: loaded.cratePath,
        details,
      }
    }

    if (toolName === 'list_properties_for_type') {
      const typeId = parseString(params.typeId).trim()
      if (typeId === '') {
        throw new Error('list_properties_for_type requires typeId.')
      }
      const includeInherited = parseBoolean(params.includeInherited, true)
      const search = parseString(params.search)
      const offset = parseNumber(params.offset, 0, 0, 100000)
      const limit = parseNumber(params.limit, 200, 1, 1000)
      const items = await catalog.listPropertiesForType(typeId, {
        includeInherited,
        search,
        offset,
        limit,
      })
      return {
        mode: loaded.mode,
        cratePath: loaded.cratePath,
        typeId,
        includeInherited,
        search,
        offset,
        limit,
        items,
      }
    }

    if (toolName === 'suggest_properties') {
      const typeIds = parseStringArray(params.typeIds)
      if (typeIds.length === 0) {
        throw new Error('suggest_properties requires non-empty typeIds array.')
      }
      const query = parseString(params.query).trim()
      if (query === '') {
        throw new Error('suggest_properties requires non-empty query.')
      }
      const limit = parseNumber(params.limit, 20, 1, 1000)
      const items = await catalog.suggestProperties(typeIds, query, { limit })
      return {
        mode: loaded.mode,
        cratePath: loaded.cratePath,
        typeIds,
        query,
        limit,
        items,
      }
    }

    if (toolName === 'get_property_details') {
      const propertyId = parseString(params.propertyId).trim()
      if (propertyId === '') {
        throw new Error('get_property_details requires propertyId.')
      }
      const details = await catalog.getPropertyDetails(propertyId)
      return {
        mode: loaded.mode,
        cratePath: loaded.cratePath,
        details,
      }
    }

    return null
  }

  return {
    runOntologyTool,
  }
}

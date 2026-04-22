import * as z from 'zod/mini'

/**
 * Minimal schema document validation shape accepted by the loader.
 */
export const schemaFileSchema = z.object({
  '@context': z.any(),
  '@graph': z.array(
    z.intersection(
      z.object({ '@id': z.string(), '@type': z.union([z.string(), z.array(z.string())]) }),
      z.record(z.string(), z.unknown())
    )
  )
})

/**
 * Parsed schema document representation used by resolver/graph modules.
 */
export type SchemaFile = z.infer<typeof schemaFileSchema>

/**
 * Runtime-agnostic fetch function contract for schema loading.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

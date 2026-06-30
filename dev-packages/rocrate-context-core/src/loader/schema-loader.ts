import { parseTtl } from '../vendor/ttl2jsonld'
import type { IReference } from '../types'
import { schemaFileSchema, type FetchLike, type SchemaFile } from './types'

/**
 * Loads ontology/schema documents and normalizes JSON-LD/Turtle into one schema format.
 */
export class SchemaLoader {
  /**
   * @param fetchImpl Runtime-specific fetch implementation (browser/node/test).
   */
  constructor(private fetchImpl: FetchLike = fetch as FetchLike) {}

  /**
   * Loads one schema resource from URL and parses it based on content type.
   */
  async load(url: string): Promise<SchemaFile> {
    const req = await this.fetchImpl(url, {
      headers: { Accept: 'text/turtle, application/ld+json, application/json, text/plain' }
    })
    const contentType = req.headers.get('Content-Type') || ''

    if (
      contentType.includes('application/ld+json') ||
      contentType.includes('application/json') ||
      contentType.startsWith('text/plain')
    ) {
      const data = await req.json()
      return schemaFileSchema.parse(data)
    }

    if (contentType.startsWith('text/turtle')) {
      const ttl = await req.text()
      const parsed = parseTtl(ttl) as
        | Array<Record<string, unknown>>
        | Record<string, unknown>
      const rawJson =
        '@graph' in parsed && Array.isArray(parsed['@graph'])
          ? (parsed as {
              '@graph': Array<Record<string, unknown>>
              '@context'?: unknown
            })
          : {
              '@context': Array.isArray(parsed) ? undefined : parsed['@context'],
              '@graph': Array.isArray(parsed)
                ? parsed
                : [parsed].filter((entry): entry is Record<string, unknown> => Boolean(entry))
            }

      // Rewrite rdf:type style definitions to @type style definitions.
      // Remove owl references, use rdf and rdfs equivalents.
      rawJson['@graph'] = rawJson['@graph'].map((e) => {
        if ('rdf:type' in e) {
          e['@type'] = (e['rdf:type'] as IReference)['@id']
          if (e['@type'] === 'owl:Class') {
            e['@type'] = 'rdfs:Class'
          }
          if (e['@type'] === 'owl:ObjectProperty') {
            e['@type'] = 'rdf:Property'
          }
        }
        return e
      })

      rawJson['@graph'] = rawJson['@graph'].filter((e) => '@type' in e)
      return schemaFileSchema.parse(rawJson)
    }

    throw new Error(`Invalid content type ${contentType}`)
  }
}

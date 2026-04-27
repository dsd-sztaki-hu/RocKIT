import type { RegisteredSchema } from '../registry/types'
import { RO_CRATE_VERSION } from '../constants'
import { SchemaLoader } from '../loader/schema-loader'
import type { SchemaFile } from '../loader/types'

export const DedupedSymbol = Symbol('return value for fetch operations that are deduped and therefore aborted')
export type DedupedSymbol = typeof DedupedSymbol

export class SchemaResolver {
  // SchemaResolver becomes ready with the first updateRegisteredSchemas call.
  private ready = false
  private waitingForReady: Promise<void> | null = null
  private runningFetches: Map<string, Promise<SchemaFile>> = new Map()
  private spec: RO_CRATE_VERSION | null = null

  constructor(
    private registeredSchemas: RegisteredSchema[],
    private loader: SchemaLoader = new SchemaLoader()
  ) {}

  /**
   * Attempts prefix-based schema autoload for a node IRI.
   */
  async autoload(nodeId: string, exclude: string[]) {
    const loadedSchemas: Map<string, { schema?: SchemaFile; error?: unknown }> = new Map()

    // Wait until the SchemaResolver becomes ready. Crucial to prevent startup race errors.
    await this.waitForReady()

    const matched = this.registeredSchemas.filter(
      (schema) =>
        schema.matchesUrls.some((prefix) => nodeId.startsWith(prefix)) &&
        (this.spec ? schema.activeOnSpec.includes(this.spec) : true)
    )

    for (const registeredSchema of matched) {
      if (exclude.includes(registeredSchema.id)) continue

      try {
        const schema = await this.fetchSchema(registeredSchema.schemaUrl)
        if (schema === DedupedSymbol) continue
        loadedSchemas.set(registeredSchema.id, { schema })
      } catch (e) {
        loadedSchemas.set(registeredSchema.id, { error: e })
      }
    }

    return loadedSchemas
  }

  /**
   * Waits until registry/spec setup is available.
   */
  private waitForReady(): Promise<void> {
    if (!this.ready) {
      if (!this.waitingForReady) {
        this.waitingForReady = new Promise((resolve, reject) => {
          const interval = setInterval(() => {
            if (this.ready) {
              clearInterval(interval)
              clearTimeout(timeout)
              resolve()
            }
          }, 50)

          const timeout = setTimeout(() => {
            clearInterval(interval)
            clearTimeout(timeout)
            reject(
              new Error(
                'SchemaResolver timed out while waiting to become ready: did not receive updateRegisteredSchemas within 2 seconds'
              )
            )
          }, 2000)
        })
      }

      return this.waitingForReady
    }

    return Promise.resolve()
  }

  /**
   * Updates active registered schemas and current specification.
   */
  updateRegisteredSchemas(state: RegisteredSchema[], spec: RO_CRATE_VERSION) {
    this.ready = true
    this.registeredSchemas = state
    this.spec = spec
  }

  /**
   * Loads one schema by registry id, bypassing autoload prefix checks.
   */
  async forceLoad(schemaId: string) {
    const schema = this.registeredSchemas.find((item) => item.id === schemaId)
    if (!schema) return
    const fetched = await this.fetchSchema(schema.schemaUrl)
    if (fetched === DedupedSymbol) return
    return fetched
  }

  /**
   * Returns load promises for all registered schemas not explicitly excluded.
   */
  loadAll(exclude: string[]) {
    const schemas = this.registeredSchemas
      .filter((schema) => !exclude.includes(schema.id))
      .filter((schema) => (this.spec ? schema.activeOnSpec.includes(this.spec) : true))

    return schemas.map((schema) => ({ schema, data: this.fetchSchema(schema.schemaUrl) }))
  }

  /**
   * Loads one schema URL with in-flight request de-duplication.
   */
  private async fetchSchema(url: string): Promise<SchemaFile | DedupedSymbol> {
    const existing = this.runningFetches.get(url)
    if (existing) {
      // After the existing fetch is done, return with DedupedSymbol.
      // The existing fetch will populate downstream state, so no duplicate fetch is needed.
      return existing.then(() => DedupedSymbol)
    }

    const promise = this.loader.load(url).finally(() => {
      this.runningFetches.delete(url)
    })

    this.runningFetches.set(url, promise)
    return promise
  }
}

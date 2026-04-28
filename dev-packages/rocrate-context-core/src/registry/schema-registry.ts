import type { RegisteredSchema } from './types'
import { DEFAULT_REGISTERED_SCHEMAS } from './defaults'

/**
 * Mutable in-memory registry of schema sources.
 * Persistence is intentionally delegated to host applications.
 */
export class SchemaRegistry {
  private schemas: RegisteredSchema[]

  /**
   * Creates a registry with either custom initial entries or library defaults.
   */
  constructor(initial?: RegisteredSchema[]) {
    this.schemas = initial ? [...initial] : [...DEFAULT_REGISTERED_SCHEMAS]
  }

  /**
   * Returns all registered schema entries.
   */
  list() {
    return [...this.schemas]
  }

  /**
   * Replaces the full registry content.
   */
  setAll(schemas: RegisteredSchema[]) {
    this.schemas = [...schemas]
  }

  /**
   * Adds a new entry or updates an existing one by `id`.
   */
  addOrUpdate(schema: RegisteredSchema) {
    const idx = this.schemas.findIndex((s) => s.id === schema.id)
    if (idx === -1) this.schemas.push(schema)
    else this.schemas[idx] = schema
  }

  /**
   * Removes one schema entry by `id`.
   */
  remove(id: string) {
    this.schemas = this.schemas.filter((s) => s.id !== id)
  }
}

import { RO_CRATE_VERSION } from '../constants'
import type { CrateContextType } from '../types'
import { getKnownContext, KNOWN_CONTEXTS } from './known-contexts'

/**
 * Provides an easy interface into the crate context for id resolution.
 * **Note**: When the context changes, for example when a new key-value pair is added, the context
 * should be reconstructed. This class does not update the crate data in any way.
 * @example resolve("Organization") -> "https://schema.org/Organization"
 */
export class CrateContext {
  private _context: Record<string, string> = {}
  private _customPairs: Record<string, string> = {}
  private _specification: RO_CRATE_VERSION | undefined = undefined
  private _usingFallback = false
  private raw?: CrateContextType

  get context() {
    return structuredClone(this._context)
  }

  get customPairs() {
    return structuredClone(this._customPairs)
  }

  get specification() {
    return structuredClone(this._specification)
  }

  get usingFallback() {
    return this._usingFallback
  }

  /**
   * Loads one known context variant and merges it into the effective context map.
   */
  private loadKnownContext(
    primary: ReturnType<typeof getKnownContext> | undefined,
    fallback: ReturnType<typeof getKnownContext>
  ) {
    if (!fallback) {
      throw new Error('No fallback context configured')
    }

    if (!primary) {
      this._usingFallback = true
    } else {
      this._usingFallback = false
    }

    const known = primary || fallback
    this._specification = known.version
    this._context = { ...this._context, ...known.context }
  }

  async setup(crateContext: CrateContextType) {
    this._context = {}
    this._customPairs = {}
    this._specification = undefined
    this._usingFallback = false
    this.raw = crateContext

    const content = Array.isArray(crateContext) ? crateContext : [crateContext]
    const fallback = KNOWN_CONTEXTS.find((c) => c.version === RO_CRATE_VERSION.V1_1_3)
    if (!fallback) {
      throw new Error('Missing known fallback context for RO-Crate v1.1.3')
    }

    for (const entry of content) {
      if (typeof entry === 'string') {
        this.loadKnownContext(getKnownContext(entry), fallback)
      } else {
        for (const [key, value] of Object.entries(entry)) {
          if (key === '@vocab') {
            this.loadKnownContext(getKnownContext(value), fallback)
          } else {
            this._context[key] = value
            this._customPairs[key] = value
          }
        }
      }
    }
  }

  isSameAs(crateContext: CrateContextType) {
    return JSON.stringify(this.raw) === JSON.stringify(crateContext)
  }

  /**
   * Resolves an entity type or property in the current context.
   * Returns null on failure.
   * @param id Entity type or property name (e.g. "Organization", "follows", ...)
   * @returns Full IRI for the specified ID.
   */
  resolve(id: string) {
    return id in this._context ? this._context[id] : null
  }

  /**
   * Reverse-resolves a full IRI back to a context term, if available.
   */
  reverse(uri: string) {
    for (const [key, value] of Object.entries(this._context)) {
      if (uri === value) {
        return key
      }
    }
    return null
  }

  /**
   * Returns class-like context entries (capitalized terms) as full type IRIs.
   */
  getAllClasses() {
    const result = new Set<string>()
    Object.entries(this._context)
      .filter(([key]) => key.match(/^[A-Z0-9]/))
      .forEach(([, url]) => {
        result.add(url)
      })

    return Array.from(result.values())
  }
}

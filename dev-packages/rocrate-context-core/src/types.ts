/**
 * JSON-LD reference object.
 */
export interface IReference {
  '@id': string
}

/**
 * One entry of RO-Crate @context.
 */
export type CrateContextEntry = string | Record<string, string>

/**
 * Complete RO-Crate @context shape accepted by the shared library.
 */
export type CrateContextType = CrateContextEntry | CrateContextEntry[]

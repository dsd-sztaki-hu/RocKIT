import { RO_CRATE_VERSION } from '../constants'

/**
 * Declarative schema source definition used by the resolver/autoload pipeline.
 */
export interface RegisteredSchema {
  id: string
  displayName: string
  matchesUrls: string[]
  schemaUrl: string
  activeOnSpec: RO_CRATE_VERSION[]
}

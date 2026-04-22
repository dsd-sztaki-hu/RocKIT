import context11 from '../assets/context-1.1.json'
import context12 from '../assets/context-1.2.json'
import { RO_CRATE_VERSION } from '../constants'

/**
 * A bundled, pre-resolved context descriptor used by the core context resolver.
 */
export interface KnownContext {
  '@id': string
  name: string
  version: RO_CRATE_VERSION
  context: Record<string, string>
}

/**
 * Built-in context variants shipped with the library for deterministic resolution.
 */
export const KNOWN_CONTEXTS: KnownContext[] = [
  {
    '@id': 'https://w3id.org/ro/crate/1.1/context',
    name: 'RO-Crate JSON-LD Context',
    version: RO_CRATE_VERSION.V1_1_3,
    context: context11['@context'] as Record<string, string>
  },
  {
    '@id': 'https://w3id.org/ro/crate/1.2/context',
    name: 'RO-Crate JSON-LD Context',
    version: RO_CRATE_VERSION.V1_2_0,
    context: context12['@context'] as Record<string, string>
  }
]

/**
 * Finds a known context by canonical URL.
 */
export function getKnownContext(id: string): KnownContext | undefined {
  return KNOWN_CONTEXTS.find((k) => k['@id'] === id)
}

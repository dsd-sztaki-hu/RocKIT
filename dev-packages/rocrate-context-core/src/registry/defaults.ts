import { RO_CRATE_VERSION } from '../constants'
import type { RegisteredSchema } from './types'

/**
 * Default schema registry entries ported from NovaCrate.
 */
export const DEFAULT_REGISTERED_SCHEMAS: RegisteredSchema[] = [
  {
    id: 'schema',
    displayName: 'Schema.org',
    matchesUrls: ['https://schema.org/'],
    schemaUrl: 'https://schema.org/version/latest/schemaorg-current-https.jsonld',
    activeOnSpec: [RO_CRATE_VERSION.V1_1_3, RO_CRATE_VERSION.V1_2_0]
  },
  {
    id: 'bioschemas_types',
    displayName: 'Bioschemas.org Types',
    matchesUrls: ['https://bioschemas.org/'],
    schemaUrl: 'https://bioschemas.org/types/bioschemas_types.jsonld',
    activeOnSpec: [RO_CRATE_VERSION.V1_1_3, RO_CRATE_VERSION.V1_2_0]
  },
  {
    id: 'dcmi',
    displayName: 'DCMI',
    matchesUrls: ['http://purl.org/dc/terms/'],
    schemaUrl:
      'https://www.dublincore.org/specifications/dublin-core/dcmi-terms/dublin_core_terms.ttl',
    activeOnSpec: [RO_CRATE_VERSION.V1_1_3, RO_CRATE_VERSION.V1_2_0]
  }
]

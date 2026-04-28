/*
 * Vendored from @frogcat/ttl2jsonld to keep this package buildable in
 * restricted/offline environments where dependency installation is unavailable.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ttl2jsonld = require('./ttl2jsonld.js') as {
  parse: (ttl: string) => unknown
}

/**
 * Parses Turtle text into JSON-LD-like graph payload.
 */
export const parseTtl = ttl2jsonld.parse

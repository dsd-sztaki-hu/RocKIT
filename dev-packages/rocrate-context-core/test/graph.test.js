const test = require('node:test')
const assert = require('node:assert/strict')

const {
  SchemaGraph,
  SchemaResolver,
  SchemaLoader,
  RO_CRATE_VERSION
} = require('../lib/index.js')

test('SchemaGraph resolves class properties from graph fixture', async () => {
  const resolver = new SchemaResolver([])
  const graph = new SchemaGraph(resolver)

  graph.addSchemaFromFile('fixture', {
    '@context': {
      schema: 'https://schema.org/',
      rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
      rdfs: 'http://www.w3.org/2000/01/rdf-schema#'
    },
    '@graph': [
      {
        '@id': 'schema:Thing',
        '@type': 'rdfs:Class'
      },
      {
        '@id': 'schema:Dataset',
        '@type': 'rdfs:Class',
        'rdfs:subClassOf': { '@id': 'schema:Thing' }
      },
      {
        '@id': 'schema:name',
        '@type': 'rdf:Property',
        'schema:domainIncludes': { '@id': 'schema:Thing' },
        'schema:rangeIncludes': { '@id': 'schema:Text' }
      }
    ]
  })

  const props = await graph.getClassProperties('https://schema.org/Dataset')
  assert.equal(props.length, 1)
  assert.equal(props[0]['@id'], 'https://schema.org/name')
})

test('SchemaLoader parses JSON-LD content with mock fetch', async () => {
  const loader = new SchemaLoader(async () =>
    new Response(
      JSON.stringify({
        '@context': { schema: 'https://schema.org/' },
        '@graph': [{ '@id': 'schema:Thing', '@type': 'rdfs:Class' }]
      }),
      {
        headers: { 'Content-Type': 'application/ld+json' }
      }
    )
  )

  const schema = await loader.load('https://example.org/schema.jsonld')
  assert.equal(schema['@graph'][0]['@id'], 'schema:Thing')
})

test('SchemaResolver forceLoad uses registered schemas and spec gating', async () => {
  const loader = new SchemaLoader(async () =>
    new Response(
      JSON.stringify({
        '@context': { schema: 'https://schema.org/' },
        '@graph': [{ '@id': 'schema:Thing', '@type': 'rdfs:Class' }]
      }),
      {
        headers: { 'Content-Type': 'application/ld+json' }
      }
    )
  )

  const resolver = new SchemaResolver(
    [
      {
        id: 'schema',
        displayName: 'Schema',
        matchesUrls: ['https://schema.org/'],
        schemaUrl: 'https://example.org/schema.jsonld',
        activeOnSpec: [RO_CRATE_VERSION.V1_1_3]
      }
    ],
    loader
  )

  resolver.updateRegisteredSchemas(
    [
      {
        id: 'schema',
        displayName: 'Schema',
        matchesUrls: ['https://schema.org/'],
        schemaUrl: 'https://example.org/schema.jsonld',
        activeOnSpec: [RO_CRATE_VERSION.V1_1_3]
      }
    ],
    RO_CRATE_VERSION.V1_1_3
  )

  const loaded = await resolver.forceLoad('schema')
  assert.ok(loaded)
  assert.equal(loaded['@graph'].length, 1)
})

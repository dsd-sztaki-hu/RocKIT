const test = require('node:test')
const assert = require('node:assert/strict')

const { OntologyCatalog } = require('../lib/index.js')

test('OntologyCatalog provides type and property suggestions', async () => {
  const catalog = await OntologyCatalog.create({
    crateContext: [
      'https://w3id.org/ro/crate/1.1/context',
      {
        schema: 'https://schema.org/',
        TheaterEvent: 'https://schema.org/TheaterEvent',
        MusicEvent: 'https://schema.org/MusicEvent',
        startDate: 'https://schema.org/startDate',
      },
    ],
    eagerLoadSchemas: false,
  })

  const typeSuggestions = await catalog.suggestTypes('theater', { limit: 10 })
  assert.ok(typeSuggestions.find((entry) => entry.id === 'https://schema.org/TheaterEvent'))

  const types = await catalog.listTypes({ search: 'music', limit: 20 })
  assert.ok(types.find((entry) => entry.id === 'https://schema.org/MusicEvent'))
})

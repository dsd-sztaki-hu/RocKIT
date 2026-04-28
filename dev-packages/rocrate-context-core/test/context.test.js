const test = require('node:test')
const assert = require('node:assert/strict')

const { CrateContext } = require('../lib/index.js')

test('CrateContext resolves known and custom terms', async () => {
  const ctx = new CrateContext()
  await ctx.setup([
    'https://w3id.org/ro/crate/1.1/context',
    {
      myTerm: 'https://example.org/myTerm',
      MyType: 'https://example.org/MyType'
    }
  ])

  assert.equal(ctx.resolve('myTerm'), 'https://example.org/myTerm')
  assert.equal(ctx.reverse('https://example.org/myTerm'), 'myTerm')
  assert.equal(ctx.resolve('Dataset'), 'https://schema.org/Dataset')

  const classes = ctx.getAllClasses()
  assert.ok(classes.includes('https://schema.org/Dataset'))
  assert.ok(classes.includes('https://example.org/MyType'))
})

test('CrateContext falls back for unknown context URL', async () => {
  const ctx = new CrateContext()
  await ctx.setup('https://example.org/unknown-context')

  assert.equal(ctx.usingFallback, true)
  assert.equal(ctx.specification, 'v1.1.3')
  assert.equal(ctx.resolve('Dataset'), 'https://schema.org/Dataset')
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const core = require('../lib/core')

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rocrate-mcp-core-test-'))
  const cratePath = path.join(tempRoot, 'ro-crate-metadata.json')

  writeJson(cratePath, {
    '@context': 'https://w3id.org/ro/crate/1.1/context',
    '@graph': [
      { '@id': './', '@type': 'Dataset', name: 'Test Root', hasPart: [] },
      {
        '@id': 'ro-crate-metadata.json',
        '@type': 'CreativeWork',
        name: 'RO-Crate Metadata',
        conformsTo: { '@id': 'https://w3id.org/ro/crate/1.1' },
        about: { '@id': './' },
      },
    ],
  })

  fs.mkdirSync(path.join(tempRoot, 'data'))
  fs.writeFileSync(path.join(tempRoot, 'data', 'example.txt'), 'hello\n', 'utf8')

  const crate = core.readCrateFromFile(cratePath)
  const delta = core.computeDelta(crate, tempRoot)
  assert.ok(delta.summary.newEntities >= 2, 'Expected at least two new entities')
  assert.ok(delta.summary.newHasPartEdges >= 2, 'Expected at least two new edges')

  const updated = core.applyChangeSet(crate, delta)
  const report = core.validateCrate(updated, { strict: true })
  assert.equal(report.summary.errors, 0, 'Expected no validation errors')

  const withDanglingReference = core.applyChangeSet(updated, {
    updateEntities: [{ '@id': './', merge: { author: [{ '@id': '#author-missing' }] } }],
  })
  const danglingReport = core.validateCrate(withDanglingReference, { strict: true })
  assert.ok(
    danglingReport.errors.some(
      (issue) =>
        issue.code === 'dangling_reference' &&
        typeof issue.message === 'string' &&
        issue.message.includes('#author-missing'),
    ),
    'Expected dangling local references to be reported as validation errors',
  )

  const withExtraField = core.applyChangeSet(updated, {
    updateEntities: [{ '@id': './', merge: { datePublished: '2026-01-01T00:00:00Z' } }],
  })
  const afterUnset = core.applyChangeSet(withExtraField, {
    updateEntities: [{ '@id': './', unset: ['datePublished'] }],
  })
  const unsetRoot = afterUnset['@graph'].find((entity) => entity['@id'] === './')
  assert.equal(
    Object.prototype.hasOwnProperty.call(unsetRoot, 'datePublished'),
    false,
    'Expected unset to remove field from target entity',
  )

  core.writeCrateAtomic(cratePath, updated)
  const reloaded = core.readCrateFromFile(cratePath)
  assert.ok(Array.isArray(reloaded['@graph']), 'Graph must be array after write/read')
  assert.ok(
    reloaded['@graph'].some((entity) => entity['@id'] === 'file://./data/example.txt'),
    'Expected file entity to be present',
  )

  console.log('rocrate-mcp core test passed')
}

main()

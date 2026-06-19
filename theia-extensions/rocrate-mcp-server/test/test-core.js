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

  const withMachineLikeNames = core.applyChangeSet(updated, {
    addEntities: [
      { '@id': '#author-hun-ren-arp-team', '@type': 'Organization', name: 'author-hun-ren-arp-team' },
      { '@id': '#source-service-map', '@type': 'CreativeWork', name: 'source-service-map' },
    ],
  })
  const machineLikeNamesReport = core.validateCrate(withMachineLikeNames, { strict: true })
  const machineLikeNameIssues = machineLikeNamesReport.errors.filter(
    (issue) => issue.code === 'machine_like_entity_name',
  )
  assert.equal(
    machineLikeNameIssues.length,
    2,
    'Expected strict validation to reject names derived from @id values',
  )

  const withInvalidFileName = core.applyChangeSet(updated, {
    addEntities: [
      {
        '@id': 'file://./dir1/img_excel_chart_intro_1.svg',
        '@type': 'File',
        name: 'Excel chart introduction SVG',
      },
    ],
  })
  const invalidFileNameReport = core.validateCrate(withInvalidFileName, { strict: true })
  assert.ok(
    invalidFileNameReport.errors.some(
      (issue) =>
        issue.code === 'file_entity_name_mismatch' &&
        issue.message.includes('img_excel_chart_intro_1.svg'),
    ),
    'Expected strict validation to require the final filename segment for File entity names',
  )

  const withHumanFriendlyNames = core.applyChangeSet(updated, {
    addEntities: [
      { '@id': '#author-hun-ren-arp-team', '@type': 'Organization', name: 'HUN-REN ARP team' },
      { '@id': '#source-service-map', '@type': 'CreativeWork', name: 'Source: ARP service map' },
      {
        '@id': 'file://./dir1/img_excel_chart_intro_1.svg',
        '@type': 'File',
        name: 'img_excel_chart_intro_1.svg',
      },
    ],
  })
  const humanFriendlyNamesReport = core.validateCrate(withHumanFriendlyNames, { strict: true })
  assert.equal(
    humanFriendlyNamesReport.errors.some(
      (issue) =>
        issue.code === 'machine_like_entity_name' ||
        issue.code === 'file_entity_name_mismatch',
    ),
    false,
    'Expected strict validation to accept human-friendly non-file names and filename-based File names',
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

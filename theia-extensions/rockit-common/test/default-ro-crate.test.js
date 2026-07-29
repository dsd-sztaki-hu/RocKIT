const assert = require('node:assert/strict')

const {
  createDefaultRoCrateWorkspace,
  withDefaultIgnoredEntries,
} = require('../lib/common/default-ro-crate')
const {
  findMissingRoCrateEntityNames,
  repairMissingRoCrateEntityNames,
} = require('../lib/common/ro-crate-entity-name')

async function main() {
  const files = new Map([
    ['data/example.txt', { content: 'hello\n', size: 6, mtimeMs: 1700000000000 }],
    ['data/nested/table.csv', { content: 'a,b\n1,2\n', size: 8, mtimeMs: 1700000001000 }],
    ['ro-crate-preview.html', { content: '<html></html>', size: 13, mtimeMs: 1700000002000 }],
    ['.hidden', { content: 'secret', size: 6, mtimeMs: 1700000003000 }],
  ])
  const directories = new Set(['data', 'data/nested', '.rockit'])

  const adapter = {
    rootName: 'sample-workspace',
    async listChildren(relativeDirectoryPath) {
      const prefix = relativeDirectoryPath ? `${relativeDirectoryPath}/` : ''
      const children = new Map()
      for (const directory of directories) {
        if (!directory.startsWith(prefix)) continue
        const remainder = directory.slice(prefix.length)
        if (!remainder || remainder.includes('/')) continue
        children.set(remainder, {
          name: remainder,
          relativePath: directory,
          kind: 'directory',
        })
      }
      for (const [filePath, file] of files) {
        if (!filePath.startsWith(prefix)) continue
        const remainder = filePath.slice(prefix.length)
        if (!remainder || remainder.includes('/')) continue
        children.set(remainder, {
          name: remainder,
          relativePath: filePath,
          kind: 'file',
          size: file.size,
          mtimeMs: file.mtimeMs,
        })
      }
      return Array.from(children.values()).sort((a, b) =>
        a.relativePath.localeCompare(b.relativePath),
      )
    },
    async readFileContent(relativeFilePath) {
      const file = files.get(relativeFilePath)
      assert.ok(file, `Expected test file: ${relativeFilePath}`)
      return file.content
    },
    hashContent(content) {
      return `hash:${content}`
    },
    async readTextFile(relativeFilePath) {
      assert.equal(relativeFilePath, '.rockit/ignored.txt')
      return 'custom.tmp\nRO-CRATE-METADATA.JSON\n'
    },
  }

  const result = await createDefaultRoCrateWorkspace(adapter, {
    datePublished: '2026-01-01T00:00:00.000Z',
    rootDatasetDescription: 'Localized workspace description',
  })
  const graph = result.crate['@graph']
  assert.ok(Array.isArray(graph), 'Expected @graph array')
  assert.ok(graph.some((entity) => entity['@id'] === './'), 'Expected root dataset')
  assert.equal(
    graph.find((entity) => entity['@id'] === './').description,
    'Localized workspace description',
  )
  assert.ok(graph.some((entity) => entity['@id'] === 'data/'), 'Expected data directory')
  assert.ok(
    graph.some((entity) => entity['@id'] === 'data/nested/'),
    'Expected nested directory',
  )
  const file = graph.find((entity) => entity['@id'] === 'data/example.txt')
  assert.equal(file['@type'], 'File')
  assert.equal(file.directoryLabel, 'data/')
  assert.equal(file.encodingFormat, 'text/plain')
  assert.equal(file.contentSize, '6')
  assert.equal(file.hash, 'hash:hello\n')
  assert.ok(!graph.some((entity) => entity['@id'] === '.hidden'), 'Root dotfiles are skipped')
  assert.ok(
    !graph.some((entity) => entity['@id'] === 'ro-crate-preview.html'),
    'Technical preview file is skipped',
  )
  assert.deepEqual(result.summary, {
    directoriesSeen: 2,
    filesSeen: 2,
    graphEntityCount: 6,
  })
  assert.ok(result.ignoredFile, 'Expected ignored file write plan')
  assert.equal(result.ignoredFile.filePath, '.rockit/ignored.txt')
  assert.ok(
    result.ignoredFile.entries.includes('custom.tmp'),
    'Existing ignored entries are preserved',
  )
  assert.equal(
    result.ignoredFile.entries.filter((entry) => entry === 'ro-crate-metadata.json').length,
    1,
    'Default entries are not duplicated case-insensitively',
  )

  const defaults = withDefaultIgnoredEntries(['custom.tmp'])
  assert.ok(defaults.includes('.rockit/'), 'Default ignored entries include .rockit/')
  assert.ok(defaults.includes('custom.tmp'), 'Custom entries survive normalization')

  const crateWithMissingNames = {
    '@graph': [
      { '@id': '#contact', '@type': 'Person' },
      { '@id': 'empty', '@type': 'Thing', name: '   ' },
      { '@id': 'present', '@type': 'Thing', name: 'Present' },
    ],
  }
  const missingNames = findMissingRoCrateEntityNames(crateWithMissingNames)
  assert.deepEqual(missingNames, [
    {
      graphIndex: 0,
      entityId: '#contact',
      entityType: 'Person',
      generatedName: 'contact',
    },
    {
      graphIndex: 1,
      entityId: 'empty',
      entityType: 'Thing',
      generatedName: 'empty',
    },
  ])
  const repairedCrate = repairMissingRoCrateEntityNames(
    crateWithMissingNames,
    missingNames,
  )
  assert.equal(repairedCrate['@graph'][0].name, 'contact')
  assert.equal(repairedCrate['@graph'][1].name, 'empty')
  assert.equal(repairedCrate['@graph'][2].name, 'Present')
  assert.equal(crateWithMissingNames['@graph'][0].name, undefined)

  console.log('rockit-common default RO-Crate test passed')
}

main()

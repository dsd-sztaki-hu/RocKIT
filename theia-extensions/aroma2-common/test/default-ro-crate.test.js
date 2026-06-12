const assert = require('node:assert/strict')

const {
  createDefaultRoCrateWorkspace,
  withDefaultIgnoredEntries,
} = require('../lib/common/default-ro-crate')

async function main() {
  const files = new Map([
    ['data/example.txt', { content: 'hello\n', size: 6, mtimeMs: 1700000000000 }],
    ['data/nested/table.csv', { content: 'a,b\n1,2\n', size: 8, mtimeMs: 1700000001000 }],
    ['ro-crate-preview.html', { content: '<html></html>', size: 13, mtimeMs: 1700000002000 }],
    ['.hidden', { content: 'secret', size: 6, mtimeMs: 1700000003000 }],
  ])
  const directories = new Set(['data', 'data/nested', '.aroma'])

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
      assert.equal(relativeFilePath, '.aroma/ignored.txt')
      return 'custom.tmp\nRO-CRATE-METADATA.JSON\n'
    },
  }

  const result = await createDefaultRoCrateWorkspace(adapter, {
    datePublished: '2026-01-01T00:00:00.000Z',
  })
  const graph = result.crate['@graph']
  assert.ok(Array.isArray(graph), 'Expected @graph array')
  assert.ok(graph.some((entity) => entity['@id'] === './'), 'Expected root dataset')
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
  assert.equal(result.ignoredFile.filePath, '.aroma/ignored.txt')
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
  assert.ok(defaults.includes('.aroma/'), 'Default ignored entries include .aroma/')
  assert.ok(defaults.includes('custom.tmp'), 'Custom entries survive normalization')

  console.log('aroma2-common default RO-Crate test passed')
}

main()

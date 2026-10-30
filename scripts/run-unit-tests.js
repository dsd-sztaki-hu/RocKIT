// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

// Resolve Windows .cmd shims as well as Unix executables without enabling a shell globally.
const { sync: spawnSync } = require('cross-spawn')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const coverage = process.argv.includes('--coverage')
const unexpected = process.argv.slice(2).filter(arg => arg !== '--coverage')
if (unexpected.length) {
  console.error(`Unknown test:unit option: ${unexpected.join(' ')}`)
  process.exit(1)
}

const suites = [
  { name: 'rocrate-context-core', workspace: 'rocrate-context-core' },
  { name: 'app-state', workspace: 'app-state', directory: 'theia-extensions/app-state', runner: 'jest' },
  { name: 'schema-validator', workspace: 'schema-validator', directory: 'theia-extensions/schema-validator', runner: 'jest' },
  { name: 'ro-crate-editor', workspace: 'ro-crate-editor', directory: 'theia-extensions/ro-crate-editor', runner: 'jest' },
  { name: 'property-selector', workspace: 'property-selector', directory: 'theia-extensions/property-selector', runner: 'jest' },
  { name: 'metadata-profile-manager', workspace: 'metadata-profile-manager', directory: 'theia-extensions/metadata-profile-manager', runner: 'jest' },
  { name: 'global-entity-library', workspace: 'global-entity-library', directory: 'theia-extensions/global-entity-library', runner: 'jest' },
  { name: 'data-repository-manager', workspace: 'data-repository-manager', directory: 'theia-extensions/data-repository-manager', runner: 'jest' },
  { name: 'arp-repository-provider', directory: 'repository-plugins/arp-repository-provider', runner: 'plugin-jest' },
  { name: 'dataverse-repository-provider', directory: 'repository-plugins/dataverse-repository-provider', runner: 'plugin-jest' },
  { name: 'zenodo-repository-provider', directory: 'repository-plugins/zenodo-repository-provider', runner: 'plugin-jest' },
  { name: 'cedar-template-converter', workspace: 'cedar-template-converter' },
  { name: 'rockit-common', workspace: 'rockit-common' },
  { name: '@theia/navigator', workspace: '@theia/navigator', directory: 'theia-extensions/file-explorer', runner: 'navigator' },
  { name: 'file-preview', workspace: 'file-preview', directory: 'theia-extensions/file-preview', runner: 'nyc' },
  { name: 'agent-launcher', workspace: 'agent-launcher', directory: 'theia-extensions/agent-launcher', runner: 'nyc' },
]
const nyc = path.join(root, 'node_modules/.bin/nyc')
const mocha = path.join(root, 'node_modules/.bin/mocha')
const nycOptions = [
  '--include=lib/**/*.js',
  '--exclude=lib/**/*spec.js',
  '--extension=.js',
  '--source-map=false',
  '--all=false',
  '--reporter=json-summary',
  '--reporter=html',
]

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.signal) {
    console.error(`${command} was stopped by ${result.signal}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status || 1)
}

function runWorkspace(suite) {
  if (suite.runner === 'plugin-jest') {
    const args = ['--cwd', path.join(root, suite.directory), 'test']
    if (coverage) args.push('--coverage')
    run('yarn', args)
    return
  }

  if (coverage && (suite.runner === 'navigator' || suite.runner === 'nyc')) {
    run('yarn', ['workspace', suite.workspace, 'compile'])
    const testPattern = suite.runner === 'navigator'
      ? './lib/browser/navigator-filter.spec.js'
      : './lib/**/*.*spec.js'
    const directory = path.join(root, suite.directory)
    run(nyc, [
      ...nycOptions,
      mocha,
      '--config', '../../configs/mocharc.yml',
      testPattern,
    ], directory)
    if (suite.name === 'agent-launcher') {
      run(nyc, ['--no-clean', ...nycOptions, 'node', 'test/test-mcp-config.js'], directory)
    }
    return
  }

  const script = suite.runner === 'navigator' ? 'test:unit' : 'test'
  const args = ['workspace', suite.workspace, script]
  if (suite.runner === 'jest') {
    args.push('--runInBand')
    if (coverage) {
      args.push('--coverage', '--coverageReporters=json-summary', '--coverageReporters=html')
    }
  }
  run('yarn', args)
}

function percent(summary, metric) {
  const count = summary.total?.[metric]?.total
  if (count === 0) return '—'
  const value = summary.total?.[metric]?.pct
  if (typeof value !== 'number') throw new Error(`Coverage summary has no ${metric} percentage`)
  return `${value.toFixed(1)}%`
}

function printCoverageTable() {
  const headers = ['Workspace', 'Statements', 'Branches', 'Functions', 'Lines']
  const rows = suites.map(suite => {
    if (!suite.runner) {
      return [suite.name, 'n/a', 'n/a', 'n/a', 'n/a']
    }
    const filename = path.join(root, suite.directory, 'coverage/coverage-summary.json')
    const summary = JSON.parse(readFileSync(filename, 'utf8'))
    return [
      suite.name,
      percent(summary, 'statements'),
      percent(summary, 'branches'),
      percent(summary, 'functions'),
      percent(summary, 'lines'),
    ]
  })
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map(row => row[index].length)))
  const format = row => row.map((cell, index) =>
    index === 0 ? cell.padEnd(widths[index]) : cell.padStart(widths[index])).join('  ')

  console.log('\nUnit coverage by workspace')
  console.log(format(headers))
  console.log(widths.map(width => '─'.repeat(width)).join('  '))
  rows.forEach(row => console.log(format(row)))
  console.log('\nn/a = test runner has no Istanbul coverage report; — = no tracked code for this metric.')
  console.log('Percentages describe files loaded by these unit tests, not the whole application.')
  console.log('HTML reports are in each measured workspace’s coverage directory.')
}

for (const suite of suites) runWorkspace(suite)
if (coverage) printCoverageTable()

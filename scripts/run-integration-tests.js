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
const unexpected = process.argv.slice(2).filter((arg) => arg !== '--coverage')
const coverageRoot = path.join(root, 'coverage/integration')
const nyc = path.join(root, 'node_modules/.bin/nyc')
const mocha = path.join(root, 'node_modules/.bin/mocha')
const metadataProfileRoot = path.join(root, 'theia-extensions/metadata-profile-core')
const navigatorRoot = path.join(root, 'theia-extensions/file-explorer')

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.signal) {
    console.error(`${command} was stopped by ${result.signal}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status || 1)
}

if (unexpected.length) {
  console.error(`Unknown test:integration option: ${unexpected.join(' ')}`)
  process.exit(1)
}

function percent(summary, metric) {
  const count = summary.total?.[metric]?.total
  if (count === 0) return '—'
  const value = summary.total?.[metric]?.pct
  if (typeof value !== 'number')
    throw new Error(`Coverage summary has no ${metric} percentage`)
  return `${value.toFixed(1)}%`
}

function printCoverageTable() {
  const headers = ['Integration suite', 'Statements', 'Branches', 'Functions', 'Lines']
  const reports = [
    {
      name: 'RO-Crate workflow',
      filename: path.join(coverageRoot, 'ro-crate/coverage-summary.json'),
    },
    {
      name: 'Metadata profiles',
      filename: path.join(coverageRoot, 'metadata-profile/coverage-summary.json'),
    },
    {
      name: 'Navigator disk diff',
      filename: path.join(coverageRoot, 'navigator-diff/coverage-summary.json'),
    },
  ]
  const rows = reports.map((report) => {
    const summary = JSON.parse(readFileSync(report.filename, 'utf8'))
    return [
      report.name,
      percent(summary, 'statements'),
      percent(summary, 'branches'),
      percent(summary, 'functions'),
      percent(summary, 'lines'),
    ]
  })
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  )
  const format = (row) =>
    row
      .map((cell, index) =>
        index === 0 ? cell.padEnd(widths[index]) : cell.padStart(widths[index]),
      )
      .join('  ')

  console.log('\nIntegration coverage by suite')
  console.log(format(headers))
  console.log(widths.map((width) => '─'.repeat(width)).join('  '))
  rows.forEach((row) => console.log(format(row)))
  console.log(
    '\nPercentages describe code loaded by each integration suite, not the whole application.',
  )
  console.log('HTML reports are in the suite directories under coverage/integration.')
}

run('yarn', ['workspace', 'rockit-common', 'build'])
run('yarn', ['workspace', 'app-state', 'build'])
run('yarn', ['workspace', 'save-ro-crate', 'build'])
run('yarn', ['workspace', 'cedar-template-converter', 'build'])
run('yarn', ['workspace', 'metadata-profile-core', 'build'])
run('yarn', ['workspace', 'schema-validator', 'build'])
run('yarn', ['workspace', '@theia/navigator', 'compile'])
const jestArgs = ['jest', '--config', 'configs/jest.integration.config.ts', '--runInBand']
if (coverage) {
  jestArgs.push(
    '--coverage',
    `--coverageDirectory=${path.join(coverageRoot, 'ro-crate')}`,
    '--coverageReporters=json-summary',
    '--coverageReporters=html',
  )
}
run('yarn', jestArgs)

if (coverage) {
  run(
    nyc,
    [
      `--cwd=${metadataProfileRoot}`,
      '--include=lib/**/*.js',
      '--extension=.js',
      '--source-map=false',
      '--all=false',
      '--reporter=json-summary',
      '--reporter=html',
      `--report-dir=${path.join(coverageRoot, 'metadata-profile')}`,
      'node',
      'test/test-core.js',
    ],
    metadataProfileRoot,
  )
  run(
    nyc,
    [
      `--cwd=${navigatorRoot}`,
      '--include=lib/**/*.js',
      '--exclude=lib/**/*spec.js',
      '--extension=.js',
      '--source-map=false',
      '--all=false',
      '--reporter=json-summary',
      '--reporter=html',
      `--report-dir=${path.join(coverageRoot, 'navigator-diff')}`,
      mocha,
      '--config',
      '../../configs/mocharc.yml',
      './lib/browser/navigator-diff.spec.js',
    ],
    navigatorRoot,
  )
} else {
  run('node', ['test/test-core.js'], metadataProfileRoot)
  run(
    mocha,
    ['--config', '../../configs/mocharc.yml', './lib/browser/navigator-diff.spec.js'],
    navigatorRoot,
  )
}

if (coverage) printCoverageTable()

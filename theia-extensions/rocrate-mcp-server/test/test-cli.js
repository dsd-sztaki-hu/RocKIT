// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const serverPath = path.resolve(__dirname, '../lib/server.js')
const packageJson = require('../package.json')

for (const flag of ['-v', '--version']) {
  const result = spawnSync(process.execPath, [serverPath, flag], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ROCRATE_DASHBOARD_ENABLED: 'true',
    },
  })

  assert.equal(result.status, 0, `${flag} should exit successfully: ${result.stderr}`)
  assert.equal(result.stderr, '', `${flag} should not start the server`)
  assert.match(result.stdout, new RegExp(`^rocrate-mcp-server ${packageJson.version}$`, 'm'))
  assert.match(result.stdout, new RegExp(`^package: ${packageJson.name}$`, 'm'))
  assert.match(result.stdout, /^build date: unknown$/m)
  assert.doesNotMatch(result.stdout, /started \(stdio\)|Dashboard server listening/)
}

console.log('rocrate-mcp CLI version test passed')

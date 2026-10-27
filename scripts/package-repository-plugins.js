#!/usr/bin/env node

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const repositoryRoot = path.resolve(__dirname, '..')
const rootManifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'))
const repositoryPlugins = rootManifest.rockitBundledPlugins || {}
const outputDirectory = path.join(repositoryRoot, 'dist', 'repository-plugins')

fs.mkdirSync(outputDirectory, { recursive: true })

for (const [expectedId, configuredSource] of Object.entries(repositoryPlugins)) {
  const source = path.resolve(repositoryRoot, configuredSource)
  const manifestPath = path.join(source, 'package.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Repository plugin manifest is missing: ${manifestPath}`)
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const actualId = `${manifest.publisher}.${manifest.name}`
  if (actualId !== expectedId) {
    throw new Error(`Configured plugin id '${expectedId}' does not match manifest id '${actualId}'.`)
  }

  const output = path.join(outputDirectory, `${actualId}-${manifest.version}.vsix`)
  for (const file of fs.readdirSync(outputDirectory)) {
    if (file.startsWith(`${actualId}-`) && file.endsWith('.vsix') && file !== path.basename(output)) {
      fs.rmSync(path.join(outputDirectory, file), { force: true })
    }
  }
  const yarnArguments = ['run', 'package:vsix', '--out', output]
  const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'yarn'
  const commandArguments = process.platform === 'win32'
    ? ['/d', '/c', 'yarn.cmd', ...yarnArguments]
    : yarnArguments
  const result = spawnSync(command, commandArguments, {
    cwd: source,
    encoding: 'utf8',
    stdio: 'inherit',
  })

  if (result.error || result.status !== 0) {
    throw result.error || new Error(`Failed to package repository plugin '${actualId}'.`)
  }
}

console.log(`Packaged ${Object.keys(repositoryPlugins).length} repository plugins in ${outputDirectory}.`)

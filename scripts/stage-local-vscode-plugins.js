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
const pluginsRoot = path.resolve(repositoryRoot, rootManifest.theiaPluginsDir || 'plugins')
const bundledPlugins = rootManifest.rockitBundledPlugins || {}

function buildPlugin(source, manifest) {
  if (!manifest.scripts?.build) {
    return
  }

  const result = spawnSync(manifest.scripts.build, {
    cwd: source,
    encoding: 'utf8',
    shell: true,
    stdio: 'pipe',
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    if (result.error) {
      process.stderr.write(`${result.error.message}\n`)
    }
    throw new Error(`Failed to build bundled VS Code plugin at ${source}.`)
  }
}

function copyPlugin(source, target, manifest) {
  const includedEntries = new Set([
    'package.json',
    ...(manifest.files || []).map(entry => entry.split(/[\\/]/)[0]),
  ])
  fs.rmSync(target, { recursive: true, force: true })
  fs.cpSync(source, target, {
    recursive: true,
    filter: (entry) => {
      const relative = path.relative(source, entry)
      if (!relative) {
        return true
      }
      const firstSegment = relative.split(path.sep)[0]
      return includedEntries.has(firstSegment)
    },
  })
}

function removeStalePluginCopies(expectedId, extensionName) {
  for (const entry of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== expectedId && entry.name.endsWith(`.${extensionName}`)) {
      fs.rmSync(path.join(pluginsRoot, entry.name), { recursive: true, force: true })
    }
  }
}

fs.mkdirSync(pluginsRoot, { recursive: true })
for (const [expectedId, configuredSource] of Object.entries(bundledPlugins)) {
  if (typeof configuredSource !== 'string') {
    throw new Error(`Bundled plugin '${expectedId}' must be configured with a source directory.`)
  }

  const source = path.resolve(repositoryRoot, configuredSource)
  const manifestPath = path.join(source, 'package.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Bundled plugin manifest is missing: ${manifestPath}`)
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const actualId = `${manifest.publisher}.${manifest.name}`
  if (actualId !== expectedId) {
    throw new Error(`Configured plugin id '${expectedId}' does not match manifest id '${actualId}'.`)
  }

  buildPlugin(source, manifest)
  removeStalePluginCopies(expectedId, manifest.name)
  copyPlugin(source, path.join(pluginsRoot, expectedId), manifest)
  console.log(`Staged bundled VS Code plugin ${expectedId}.`)
}

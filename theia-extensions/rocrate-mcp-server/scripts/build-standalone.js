#!/usr/bin/env node

// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

const fs = require('node:fs')
const path = require('node:path')
const esbuild = require('esbuild')

const packageRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(packageRoot, '..', '..')
const outRoot = path.join(packageRoot, 'dist', 'npm')
const outLib = path.join(outRoot, 'lib')
const outNodeModules = path.join(outRoot, 'node_modules')
const cedarWorkspace = path.join(repoRoot, 'theia-extensions', 'cedar-to-rocrate')

function removeIfExists(target) {
  fs.rmSync(target, { recursive: true, force: true })
}

function copyRecursive(source, target, filter = () => true) {
  const stat = fs.statSync(source)
  if (!filter(source, stat)) {
    return
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true })
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(target, entry), filter)
    }
    return
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

async function main() {
  removeIfExists(outRoot)
  fs.mkdirSync(outLib, { recursive: true })

  await esbuild.build({
    entryPoints: {
      server: path.join(packageRoot, 'src', 'server.ts'),
      shutdown: path.join(packageRoot, 'src', 'cli', 'shutdown.ts'),
    },
    outdir: outLib,
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    sourcemap: true,
    define: {
      'process.env.ROCRATE_MCP_RELEASE_BUILD': JSON.stringify('true'),
    },
    external: [
      // Optional native module used only for secure provider credentials.
      'keytar',
      // Loaded dynamically as ESM; vendor it beside the bundled CommonJS server.
      'cedar-template-converter',
    ],
  })

  fs.chmodSync(path.join(outLib, 'server.js'), 0o755)
  fs.chmodSync(path.join(outLib, 'shutdown.js'), 0o755)

  copyRecursive(
    path.join(packageRoot, 'src', 'dashboard', 'static'),
    path.join(outLib, 'dashboard', 'static'),
  )

  const cedarPackage = readJson(path.join(cedarWorkspace, 'package.json'))
  const cedarTarget = path.join(outNodeModules, 'cedar-template-converter')
  fs.mkdirSync(cedarTarget, { recursive: true })
  fs.writeFileSync(
    path.join(cedarTarget, 'package.json'),
    `${JSON.stringify(
      {
        name: cedarPackage.name,
        version: cedarPackage.version,
        type: cedarPackage.type,
        main: cedarPackage.main,
        license: cedarPackage.license,
        author: cedarPackage.author,
        contributors: cedarPackage.contributors,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  copyRecursive(
    path.join(cedarWorkspace, 'dist'),
    path.join(cedarTarget, 'dist'),
    (source) => {
      const name = path.basename(source)
      return !name.includes('.test.')
    },
  )
  fs.copyFileSync(
    path.join(cedarWorkspace, 'LICENSE.md'),
    path.join(cedarTarget, 'LICENSE.md'),
  )

  const packageJson = readJson(path.join(packageRoot, 'package.json'))
  const buildDate = process.env.ROCRATE_MCP_BUILD_DATE || new Date().toISOString()
  fs.writeFileSync(
    path.join(outRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: packageJson.name,
        version: packageJson.version,
        buildDate,
        description: packageJson.description,
        license: packageJson.license,
        author: packageJson.author,
        contributors: packageJson.contributors,
        main: 'lib/server.js',
        bin: {
          'rocrate-mcp-server': 'lib/server.js',
        },
        scripts: {
          preinstall: 'node lib/shutdown.js',
        },
        dependencies: {
          [cedarPackage.name]: cedarPackage.version,
        },
        files: ['lib', 'node_modules/cedar-template-converter', 'LICENSE.md'],
        bundledDependencies: ['cedar-template-converter'],
        engines: packageJson.engines,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  fs.copyFileSync(
    path.join(packageRoot, 'README_PUBLIC.md'),
    path.join(outRoot, 'README.md'),
  )
  fs.copyFileSync(path.join(repoRoot, 'LICENSE.md'), path.join(outRoot, 'LICENSE.md'))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

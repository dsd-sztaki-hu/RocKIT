#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
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
    entryPoints: [path.join(packageRoot, 'src', 'server.ts')],
    outfile: path.join(outLib, 'server.js'),
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    sourcemap: true,
    external: [
      // Optional native module used only for secure provider credentials.
      'keytar',
      // Loaded dynamically as ESM; vendor it beside the bundled CommonJS server.
      'cedar-template-converter',
    ],
  })

  fs.chmodSync(path.join(outLib, 'server.js'), 0o755)

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
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  copyRecursive(path.join(cedarWorkspace, 'dist'), path.join(cedarTarget, 'dist'), (source) => {
    const name = path.basename(source)
    return !name.includes('.test.')
  })

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
        main: 'lib/server.js',
        bin: {
          'rocrate-mcp-server': 'lib/server.js',
        },
        files: ['lib', 'node_modules/cedar-template-converter'],
        bundledDependencies: ['cedar-template-converter'],
        engines: packageJson.engines,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

// Prepares node_modules for a SINGLE-ARCH mac DMG build. We no longer build --universal;
// use `dist:mac:arm64` / `dist:mac:x64`. Usage: node fetch-darwin-native.js <arm64|x64>
//
// yarn 1.x only lays down the HOST-arch variant of each prebuilt native package, so to
// build the other arch on this machine we fetch it from the npm registry. To keep each DMG
// lean — otherwise BOTH arches' ~207 MB `claude` binary get packed into every build — we
// also remove the non-target arch's runtime prebuilts after ensuring the target is present.
//
// Only RUNTIME prebuilt families (which ship in the app) are arch-managed. Build-tooling
// prebuilts (esbuild/rollup/@tailwindcss/...) stay at host arch because they execute during
// the build itself. The bundled ripgrep executable is made universal for both arches.

const fs = require('fs')
const https = require('https')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const workspaceRoot = path.resolve(__dirname, '..')
const nodeModules = path.join(workspaceRoot, 'node_modules')
const registry = (process.env.npm_config_registry || 'https://registry.npmjs.org').replace(/\/$/, '')
const ARCHES = ['arm64', 'x64']

// [packageName, scopeDir] for runtime prebuilt families that ship and have both darwin arches.
const RUNTIME_FAMILIES = [
  ['@anthropic-ai/claude-agent-sdk', '@anthropic-ai'],
  ['@msgpackr-extract/msgpackr-extract', '@msgpackr-extract'],
  ['@parcel/watcher', '@parcel'],
].map(([name, scope]) => ({
  name,
  parent: path.join(nodeModules, scope),
  leaf: name.split('/').pop(),
}))

function log(message) {
  console.log(`[fetch-darwin-native] ${message}`)
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const get = (current) => {
      https
        .get(current, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume()
            get(res.headers.location)
            return
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} fetching ${current}`))
            return
          }
          res.pipe(file)
          file.on('finish', () => file.close(resolve))
        })
        .on('error', reject)
    }
    get(url)
  })
}

function findFile(rootDir, name) {
  for (const entry of fs.readdirSync(rootDir)) {
    const full = path.join(rootDir, entry)
    if (fs.statSync(full).isDirectory()) {
      const found = findFile(full, name)
      if (found) return found
    } else if (entry === name) {
      return full
    }
  }
  return null
}

function lipoArchs(file) {
  try {
    const out = execFileSync('lipo', ['-archs', file], { encoding: 'utf8' }).trim()
    return new Set(out.split(/\s+/).filter(Boolean))
  } catch {
    return new Set()
  }
}

function variantVersion(name, arch) {
  const pkg = readJson(path.join(nodeModules, name, 'package.json'))
  const v = (pkg.optionalDependencies || {})[`${name}-darwin-${arch}`]
  if (!v) throw new Error(`${name}-darwin-${arch} not declared in ${name} optionalDependencies`)
  return v
}

// Ensure the TARGET-arch variant is present, then remove the OTHER arch's variant so the
// build ships only the target arch's binary.
async function ensureRuntimeFamily(family, target) {
  const other = target === 'arm64' ? 'x64' : 'arm64'
  const targetDir = path.join(family.parent, `${family.leaf}-darwin-${target}`)
  const otherDir = path.join(family.parent, `${family.leaf}-darwin-${other}`)

  if (!fs.existsSync(path.join(targetDir, 'package.json'))) {
    const version = variantVersion(family.name, target)
    const variantName = `${family.name}-darwin-${target}`
    const tarballUrl = `${registry}/${variantName}/-/${family.leaf}-darwin-${target}-${version}.tgz`
    const tmpFile = path.join(os.tmpdir(), `${family.leaf}-darwin-${target}-${version}.tgz`)
    log(`downloading ${variantName}@${version}`)
    await download(tarballUrl, tmpFile)
    fs.mkdirSync(targetDir, { recursive: true })
    execFileSync('tar', ['-xzf', tmpFile, '--strip-components', '1', '-C', targetDir], {
      stdio: 'inherit',
    })
    fs.unlinkSync(tmpFile)
    log(`installed ${variantName}@${version}`)
  }

  if (fs.existsSync(otherDir)) {
    fs.rmSync(otherDir, { recursive: true, force: true })
    log(`removed non-target ${family.name}-darwin-${other} (lean build)`)
  }
}

// Theia's esbuild bundle carries a copy of ripgrep under lib/backend/native.
// Make that executable universal as well as the host package's source binary.
async function ensureRipgrepUniversal() {
  const rgPackage = readJson(path.join(nodeModules, '@vscode', 'ripgrep', 'package.json'))
  const binaries = []
  for (const arch of ARCHES) {
    const name = `@vscode/ripgrep-darwin-${arch}`
    const packageDir = path.join(nodeModules, name)
    const binary = path.join(packageDir, 'bin', 'rg')
    if (!fs.existsSync(binary)) {
      const version = rgPackage.optionalDependencies[name]
      if (!version) throw new Error(`${name} is not declared by @vscode/ripgrep`)
      const archive = path.join(os.tmpdir(), `ripgrep-darwin-${arch}-${version}.tgz`)
      await download(`${registry}/${name}/-/ripgrep-darwin-${arch}-${version}.tgz`, archive)
      fs.mkdirSync(packageDir, { recursive: true })
      execFileSync('tar', ['-xzf', archive, '--strip-components', '1', '-C', packageDir], { stdio: 'inherit' })
      fs.unlinkSync(archive)
    }
    binaries.push(binary)
  }
  const hostBinary = binaries[ARCHES.indexOf(process.arch)]
  const archs = lipoArchs(hostBinary)
  if (!archs.has('x86_64') || !archs.has('arm64')) {
    const fatDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rockit-rg-'))
    const fatBinary = path.join(fatDir, 'rg')
    execFileSync('lipo', ['-create', ...binaries, '-output', fatBinary], { stdio: 'inherit' })
    fs.copyFileSync(fatBinary, hostBinary)
    fs.unlinkSync(fatBinary)
    fs.rmdirSync(fatDir)
  }
  const stagedBinary = path.join(workspaceRoot, 'electron-app', 'lib', 'backend', 'native', 'rg')
  fs.mkdirSync(path.dirname(stagedBinary), { recursive: true })
  fs.copyFileSync(hostBinary, stagedBinary)
  fs.chmodSync(stagedBinary, 0o755)
  log('staged universal ripgrep in the esbuild backend')
}

function stageNodePtyPrebuilds(target) {
  const dist = `darwin-${target}`
  const source = path.join(nodeModules, 'node-pty', 'prebuilds', dist)
  const destination = path.join(workspaceRoot, 'electron-app', 'lib', 'prebuilds', dist)
  fs.cpSync(source, destination, { recursive: true })
  log(`staged node-pty prebuilds for ${dist}`)
}

async function main() {
  const target = process.argv[2]
  if (!ARCHES.includes(target)) {
    throw new Error(`usage: node fetch-darwin-native.js <${ARCHES.join('|')}>`)
  }

  log(`preparing node_modules for darwin-${target} build`)
  for (const family of RUNTIME_FAMILIES) {
    try {
      await ensureRuntimeFamily(family, target)
    } catch (err) {
      log(`warning: ${family.name}: ${err.message}`)
    }
  }

  await ensureRipgrepUniversal()

  stageNodePtyPrebuilds(target)
  log('done')
}

main().catch((err) => {
  console.error(`[fetch-darwin-native] ${err.message}`)
  process.exit(1)
})

#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')
const electronPackagePath = require.resolve('electron/package.json', {
  paths: [projectRoot],
})
const electronPackageRoot = path.dirname(electronPackagePath)
const electronPackage = require(electronPackagePath)
const ffmpegPackagePath = require.resolve('@theia/ffmpeg/package.json', {
  paths: [projectRoot],
})
const ffmpegPackageRoot = path.dirname(ffmpegPackagePath)
const nodeGypPackageRoot = path.dirname(
  require.resolve('node-gyp/package.json', {
    paths: [projectRoot],
  }),
)
const ripgrepPackagePath = require.resolve('@vscode/ripgrep/package.json', {
  paths: [projectRoot],
})
const ripgrepPackageRoot = path.dirname(ripgrepPackagePath)
const ripgrepExecutable = process.platform === 'win32' ? 'rg.exe' : 'rg'
const ripgrepBinaryPath = path.join(ripgrepPackageRoot, 'bin', ripgrepExecutable)

const getPlatformExecutable = (platform) => {
  switch (platform) {
    case 'darwin':
    case 'mas':
      return 'Electron.app/Contents/MacOS/Electron'
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron'
    case 'win32':
      return 'electron.exe'
    default:
      throw new Error(`Electron builds are not available for platform: ${platform}`)
  }
}

const platform = process.env.npm_config_platform || process.platform
const executable = getPlatformExecutable(platform)
const distPath = path.join(electronPackageRoot, 'dist')

const hasExpectedRuntime = () => {
  try {
    const installedVersion = fs
      .readFileSync(path.join(distPath, 'version'), 'utf8')
      .trim()
      .replace(/^v/, '')
    const installedExecutable = fs
      .readFileSync(path.join(electronPackageRoot, 'path.txt'), 'utf8')
      .trim()

    return (
      installedVersion === electronPackage.version &&
      installedExecutable === executable &&
      fs.existsSync(path.join(distPath, executable))
    )
  } catch {
    return false
  }
}

const ensureElectronRuntime = () => {
  if (hasExpectedRuntime()) {
    return
  }

  console.log(
    `Electron ${electronPackage.version} runtime is missing or incomplete; installing it now...`,
  )

  const installResult = spawnSync(
    process.execPath,
    [path.join(electronPackageRoot, 'install.js')],
    {
      cwd: electronPackageRoot,
      env: process.env,
      stdio: 'inherit',
    },
  )

  if (installResult.error) {
    throw new Error(
      `Failed to run the Electron installer: ${installResult.error.message}`,
    )
  }

  if (installResult.status !== 0 || !hasExpectedRuntime()) {
    throw new Error(
      'Electron runtime installation did not complete. Check network access and ensure ELECTRON_SKIP_BINARY_DOWNLOAD is not set.',
    )
  }

  console.log(`Electron ${electronPackage.version} runtime is ready.`)
}

const hasRipgrepBinary = () => {
  try {
    const stats = fs.statSync(ripgrepBinaryPath)
    return stats.isFile() && stats.size > 0
  } catch {
    return false
  }
}

const ensureRipgrepBinary = () => {
  if (hasRipgrepBinary()) {
    return
  }

  console.log('@vscode/ripgrep binary is missing; installing it now...')
  const installResult = spawnSync(
    process.execPath,
    [path.join(ripgrepPackageRoot, 'lib', 'postinstall.js'), '--force'],
    {
      cwd: ripgrepPackageRoot,
      env: process.env,
      stdio: 'inherit',
    },
  )

  if (installResult.error) {
    throw new Error(
      `Failed to run the @vscode/ripgrep installer: ${installResult.error.message}`,
    )
  }

  if (installResult.status !== 0 || !hasRipgrepBinary()) {
    throw new Error(
      'The @vscode/ripgrep binary could not be installed. Check network access and proxy settings.',
    )
  }

  console.log('@vscode/ripgrep binary is ready.')
}

const canLoadFfmpegAddon = () => {
  try {
    const ffmpeg = require(path.join(ffmpegPackageRoot, 'lib', 'ffmpeg.js'))
    ffmpeg._loadFfmpegNativeAddon()
    return true
  } catch {
    return false
  }
}

const ensureFfmpegAddon = () => {
  if (canLoadFfmpegAddon()) {
    return
  }

  console.log(
    'Theia FFmpeg native helper is missing or incompatible; rebuilding it now...',
  )

  const rebuildResult = spawnSync(
    process.execPath,
    [path.join(nodeGypPackageRoot, 'bin', 'node-gyp.js'), 'rebuild'],
    {
      cwd: ffmpegPackageRoot,
      env: process.env,
      stdio: 'inherit',
    },
  )

  if (rebuildResult.error) {
    throw new Error(
      `Failed to run node-gyp for @theia/ffmpeg: ${rebuildResult.error.message}`,
    )
  }

  if (rebuildResult.status !== 0 || !canLoadFfmpegAddon()) {
    throw new Error(
      'Theia FFmpeg native helper could not be built. Check the native build prerequisites for your platform.',
    )
  }

  console.log('Theia FFmpeg native helper is ready.')
}

try {
  ensureRipgrepBinary()
  ensureElectronRuntime()
  ensureFfmpegAddon()
} catch (error) {
  console.error(error.message)
  process.exit(1)
}

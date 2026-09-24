// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')

const packageRoot = path.resolve(__dirname, '..')
const standaloneRoot = path.join(packageRoot, 'dist', 'npm')
const packageJsonPath = path.join(standaloneRoot, 'package.json')

assert.ok(
  fs.existsSync(packageJsonPath),
  'Build the standalone package before running this test',
)

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
assert.equal(packageJson.license, 'Apache-2.0')
assert.equal(packageJson.author?.name, 'SZTAKI, Department of Distributed Systems')
assert.equal(packageJson.author?.url, 'https://dsd.sztaki.hu')
const balazsContributor = packageJson.contributors?.find(
  (contributor) => contributor.name === 'Balazs E. Pataki',
)
assert.equal(balazsContributor?.email, 'pataki@sztaki.hu')
assert.ok(
  fs.existsSync(path.join(standaloneRoot, 'LICENSE.md')),
  'The standalone package must include the Apache license text',
)
assert.equal(
  packageJson.dependencies?.['cedar-template-converter'],
  '1.0.0',
  'The standalone package must declare its vendored converter dependency',
)
assert.deepEqual(packageJson.bundledDependencies, ['cedar-template-converter'])
assert.equal(packageJson.scripts?.preinstall, 'node lib/shutdown.js')

const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'rocrate-mcp-standalone-package-'),
)
const npmEnvironment = {
  ...process.env,
  NPM_CONFIG_AUDIT: 'false',
  NPM_CONFIG_CACHE: path.join(temporaryRoot, 'npm-cache'),
  NPM_CONFIG_FUND: 'false',
  NPM_CONFIG_LOGS_DIR: path.join(temporaryRoot, 'npm-logs'),
}

function waitForOutput(child, pattern) {
  return new Promise((resolve, reject) => {
    let output = ''
    const onData = (chunk) => {
      output += chunk.toString('utf8')
      if (output.includes(pattern)) {
        cleanup()
        resolve()
      }
    }
    const onExit = (code, signal) => {
      cleanup()
      reject(
        new Error(
          `Daemon exited before output: code=${code} signal=${signal}\n${output}`,
        ),
      )
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for daemon output: ${pattern}\n${output}`))
    }, 5000)
    const cleanup = () => {
      clearTimeout(timer)
      child.stderr.off('data', onData)
      child.off('exit', onExit)
    }
    child.stderr.on('data', onData)
    child.once('exit', onExit)
  })
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(child.exitCode)
  }
  return new Promise((resolve) => child.once('exit', (code) => resolve(code)))
}

async function run() {
  let daemon
  try {
    const packOutput = execFileSync(
      'npm',
      ['pack', '--json', '--pack-destination', temporaryRoot, standaloneRoot],
      {
        cwd: packageRoot,
        encoding: 'utf8',
        env: npmEnvironment,
      },
    )
    const packReport = JSON.parse(packOutput)[0]
    assert.ok(
      packReport.bundled.includes('cedar-template-converter'),
      'The npm tarball must contain the bundled converter',
    )
    assert.ok(
      packReport.files.some(
        (file) =>
          file.path === 'node_modules/cedar-template-converter/dist/cedar-converter.js',
      ),
      'The npm tarball must include the converter implementation',
    )
    assert.ok(
      packReport.files.some((file) => file.path === 'LICENSE.md'),
      'The npm tarball must include the Apache license text',
    )

    const tarballPath = path.join(temporaryRoot, packReport.filename)
    const installRoot = path.join(temporaryRoot, 'install')
    fs.mkdirSync(installRoot)
    const socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\rocrate-mcp-standalone-package-${process.pid}`
        : path.join(temporaryRoot, 'rocrate-mcp-server.sock')
    daemon = spawn(
      process.execPath,
      [path.join(standaloneRoot, 'lib', 'server.js'), '--listen', socketPath],
      {
        env: {
          ...process.env,
          ROCRATE_DASHBOARD_ENABLED: 'false',
          ROCKIT_ROCRATE_MCP_SOCKET_PATH: socketPath,
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    )
    await waitForOutput(daemon, `listening on ${socketPath}`)
    execFileSync('npm', ['install', '--offline', '--prefix', installRoot, tarballPath], {
      cwd: packageRoot,
      encoding: 'utf8',
      env: {
        ...npmEnvironment,
        ROCKIT_ROCRATE_MCP_SOCKET_PATH: socketPath,
      },
    })
    assert.equal(await waitForExit(daemon), 0)

    const installedPackageRoot = path.join(
      installRoot,
      'node_modules',
      '@arpproject',
      'rocrate-mcp-server',
    )
    const resolvedConverterPath = execFileSync(
      process.execPath,
      [
        '-e',
        `process.stdout.write(require.resolve('cedar-template-converter', { paths: [${JSON.stringify(path.join(installedPackageRoot, 'lib'))}] }))`,
      ],
      {
        cwd: packageRoot,
        encoding: 'utf8',
        env: npmEnvironment,
      },
    )
    assert.match(
      resolvedConverterPath,
      /node_modules[\\/]cedar-template-converter[\\/]dist[\\/]cedar-converter\.js$/,
      'A clean offline install must resolve the bundled converter from the MCP package',
    )
  } finally {
    if (daemon && daemon.exitCode === null && daemon.signalCode === null) {
      daemon.kill()
      await waitForExit(daemon)
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

run()
  .then(() => console.log('standalone package lifecycle test passed'))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })

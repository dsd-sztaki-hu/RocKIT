// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { type ChildProcess, execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { ElectronApplication, Page, TestInfo, Video } from '@playwright/test'
import { _electron } from 'playwright'
import { RocKitPageObjects } from '../page-objects'
import { expect, test as workspaceTest } from './test-workspace'

const repositoryRoot = path.resolve(__dirname, '..', '..')
const rockitRuntimeFixtureDirectory = path.resolve(
  __dirname,
  '..',
  'fixtures',
  'rockit-runtime',
)
const electronMainPath = path.join(
  repositoryRoot,
  'electron-app',
  'lib',
  'backend',
  'electron-main.js',
)

const gracefulShutdownTimeout = 15_000
const forcedShutdownTimeout = 5_000

export interface ElectronRuntimePaths {
  electronUserData: string
  home: string
  plugins: string
  rockitRoot: string
}

export interface ElectronDiagnostics {
  blockedExternalRequests: string[]
  mainProcessConsole: string[]
  rendererConsole: string[]
  rendererErrors: string[]
}

export interface ElectronMainProcessInteractions {
  openDialogs: Array<{
    properties?: string[]
    returnedPaths: string[]
    title?: string
  }>
  openExternal: string[]
  saveDialogs: Array<{
    defaultPath?: string
    title?: string
  }>
  showItemInFolder: string[]
}

export interface ElectronRuntime {
  application: ElectronApplication
  diagnostics: ElectronDiagnostics
  page: Page
  paths: ElectronRuntimePaths
  readMainProcessInteractions: () => Promise<ElectronMainProcessInteractions>
  restartWithFreshState: () => Promise<RocKitPageObjects>
  restartWithPersistedState: () => Promise<RocKitPageObjects>
}

interface ElectronFixtures {
  appPage: Page
  electronApp: ElectronApplication
  electronDiagnostics: ElectronDiagnostics
  electronRuntime: ElectronRuntime
  rockit: RocKitPageObjects
}

interface ElectronOptions {
  electronExternalChangeAction: '' | 'auto' | 'off' | 'prompt'
  electronOpenDialogDirectoryName: string
  electronSaveDialogFileName: string
  rockitRuntimeFixtureName: string
}

const stringEnvironment = (environment: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )

const isLocalApplicationUrl = (url: string): boolean => {
  if (/^(blob|data|devtools|file):/.test(url)) {
    return true
  }

  try {
    const hostname = new URL(url).hostname
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

const withTimeout = async <T>(
  promise: Promise<T>,
  timeout: number,
  message: string,
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeout)
      }),
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

const processHasExited = (child: ChildProcess): boolean => {
  return child.exitCode !== null || child.signalCode !== null
}

const descendantProcessIds = (parentPid: number | undefined): number[] => {
  if (!parentPid || process.platform === 'win32') {
    return []
  }

  try {
    const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], {
      encoding: 'utf8',
    })
    const childrenByParent = new Map<number, number[]>()
    for (const row of rows.split('\n')) {
      const [pidText, parentText] = row.trim().split(/\s+/)
      const pid = Number(pidText)
      const owner = Number(parentText)
      if (!Number.isInteger(pid) || !Number.isInteger(owner)) {
        continue
      }
      childrenByParent.set(owner, [...(childrenByParent.get(owner) ?? []), pid])
    }

    const descendants: number[] = []
    const visit = (pid: number): void => {
      for (const childPid of childrenByParent.get(pid) ?? []) {
        visit(childPid)
        descendants.push(childPid)
      }
    }
    visit(parentPid)
    return descendants
  } catch {
    return []
  }
}

const terminateSurvivingProcesses = (processIds: number[]): void => {
  for (const pid of processIds) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        throw error
      }
    }
  }
}

const waitForProcessExit = async (
  child: ChildProcess,
  timeout: number,
): Promise<void> => {
  if (processHasExited(child)) {
    return
  }

  await withTimeout(
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    timeout,
    `Electron did not exit within ${timeout} ms`,
  )
}

const closeElectronApplication = async (
  application: ElectronApplication,
): Promise<void> => {
  let child: ChildProcess
  try {
    child = application.process()
  } catch {
    return
  }
  if (processHasExited(child)) {
    return
  }

  const descendants = descendantProcessIds(child.pid)

  try {
    await withTimeout(
      Promise.all([
        application.close(),
        ...application.windows().map((page) =>
          // Test workspaces are disposable. Discard only during shutdown,
          // after persistence assertions and failure artifacts have completed.
          page.getByRole('button', { name: "Don't Save", exact: true })
            .click({ timeout: gracefulShutdownTimeout }).catch(() => undefined),
        ),
      ]),
      gracefulShutdownTimeout,
      `Electron did not close within ${gracefulShutdownTimeout} ms`,
    )
  } catch {
    if (!processHasExited(child)) {
      child.kill('SIGTERM')
      try {
        await waitForProcessExit(child, forcedShutdownTimeout)
      } catch {
        if (!processHasExited(child)) {
          child.kill('SIGKILL')
          await waitForProcessExit(child, forcedShutdownTimeout)
        }
      }
    }
  } finally {
    terminateSurvivingProcesses(descendants)
  }
}

const mockNativeBoundaries = async (
  application: ElectronApplication,
  openDialogPath?: string,
  saveDialogPath?: string,
): Promise<void> => {
  await application.evaluate(
    ({ dialog, shell }, configuredPaths) => {
      const interactions: ElectronMainProcessInteractions = {
        openDialogs: [],
        openExternal: [],
        saveDialogs: [],
        showItemInFolder: [],
      }
      ;(
        globalThis as typeof globalThis & {
          __rockitE2EInteractions?: ElectronMainProcessInteractions
        }
      ).__rockitE2EInteractions = interactions

      const recordOpenDialog = (args: unknown[]): void => {
        const options = args.at(-1) as
          | { properties?: string[]; title?: string }
          | undefined
        interactions.openDialogs.push({
          properties: options?.properties,
          returnedPaths: configuredPaths.openDialogPath
            ? [configuredPaths.openDialogPath]
            : [],
          title: options?.title,
        })
      }

      const recordSaveDialog = (args: unknown[]): void => {
        const options = args.at(-1) as
          | { defaultPath?: string; title?: string }
          | undefined
        interactions.saveDialogs.push({
          defaultPath: options?.defaultPath,
          title: options?.title,
        })
      }

      Object.assign(dialog, {
        showMessageBox: async () => ({ checkboxChecked: false, response: 0 }),
        showMessageBoxSync: () => 0,
        showOpenDialog: async (...args: unknown[]) => {
          recordOpenDialog(args)
          return configuredPaths.openDialogPath
            ? { canceled: false, filePaths: [configuredPaths.openDialogPath] }
            : { canceled: true, filePaths: [] }
        },
        showOpenDialogSync: (...args: unknown[]) => {
          recordOpenDialog(args)
          return configuredPaths.openDialogPath
            ? [configuredPaths.openDialogPath]
            : undefined
        },
        showSaveDialog: async (...args: unknown[]) => {
          recordSaveDialog(args)
          return configuredPaths.saveDialogPath
            ? { canceled: false, filePath: configuredPaths.saveDialogPath }
            : { canceled: true, filePath: '' }
        },
        showSaveDialogSync: (...args: unknown[]) => {
          recordSaveDialog(args)
          return configuredPaths.saveDialogPath ?? undefined
        },
      })
      Object.assign(shell, {
        openExternal: async (location: string) => {
          interactions.openExternal.push(location)
        },
        showItemInFolder: (filePath: string) => {
          interactions.showItemInFolder.push(filePath)
        },
      })
    },
    {
      openDialogPath: openDialogPath ?? null,
      saveDialogPath: saveDialogPath ?? null,
    },
  )
}

const readMainProcessInteractions = async (
  application: ElectronApplication,
): Promise<ElectronMainProcessInteractions> =>
  application.evaluate(() => {
    const interactions = (
      globalThis as typeof globalThis & {
        __rockitE2EInteractions?: ElectronMainProcessInteractions
      }
    ).__rockitE2EInteractions
    return (
      interactions ?? {
        openDialogs: [],
        openExternal: [],
        saveDialogs: [],
        showItemInFolder: [],
      }
    )
  })

const observePage = (
  page: Page,
  diagnostics: ElectronDiagnostics,
  observedPages: WeakSet<Page>,
): void => {
  if (observedPages.has(page)) {
    return
  }
  observedPages.add(page)

  page.on('console', (message) => {
    const rendered = `[${message.type()}] ${message.text()}`
    diagnostics.rendererConsole.push(rendered)
    if (message.type() === 'error') {
      diagnostics.rendererErrors.push(`console: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => {
    diagnostics.rendererErrors.push(`pageerror: ${error.stack ?? error.message}`)
  })
  page.on('crash', () => {
    diagnostics.rendererErrors.push('crash: renderer process crashed')
  })
}

interface ElectronSession {
  application: ElectronApplication
  artifactDirectory: string
  page: Page
  paths: ElectronRuntimePaths
}

interface ElectronSessionOptions {
  artifactDirectory: string
  diagnostics: ElectronDiagnostics
  observedPages: WeakSet<Page>
  openDialogPath?: string
  paths: ElectronRuntimePaths
  saveDialogPath?: string
  testWorkspacePath: string
}

const prepareRuntimePaths = async (
  runtimeRoot: string,
  sessionNumber: number,
  fixtureName: string,
  externalChangeAction: ElectronOptions['electronExternalChangeAction'],
): Promise<ElectronRuntimePaths> => {
  const sessionRoot = path.join(runtimeRoot, `session-${sessionNumber}`)
  const paths: ElectronRuntimePaths = {
    electronUserData: path.join(sessionRoot, 'electron-user-data'),
    home: path.join(sessionRoot, 'home'),
    plugins: path.join(sessionRoot, 'plugins'),
    rockitRoot: path.join(sessionRoot, 'rockit-root'),
  }

  await Promise.all([
    mkdir(paths.electronUserData, { recursive: true }),
    mkdir(paths.home, { recursive: true }),
    mkdir(paths.plugins, { recursive: true }),
    mkdir(paths.rockitRoot, { recursive: true }),
  ])

  // Only load plugins declared by this checkout. The shared download directory
  // can retain incompatible plugins after switching branches.
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
  ) as { theiaPlugins: Record<string, string>; theiaPluginsDir: string }
  await Promise.all(Object.keys(packageJson.theiaPlugins).map(async (pluginId) => {
    const source = path.join(repositoryRoot, packageJson.theiaPluginsDir, pluginId)
    if (!(await stat(source).catch(() => undefined))?.isDirectory()) {
      throw new Error(`Missing E2E plugin ${pluginId}. Run yarn download:plugins first.`)
    }
    await cp(source, path.join(paths.plugins, pluginId), { recursive: true })
  }))

  if (process.platform === 'win32') {
    // Electron needs these redirected system folders during early startup,
    // before Theia handles the --electronUserData argument.
    await Promise.all([
      mkdir(path.join(paths.home, 'AppData', 'Roaming'), { recursive: true }),
      mkdir(path.join(paths.home, 'AppData', 'Local'), { recursive: true }),
    ])
  }

  if (fixtureName) {
    const fixturePath = path.resolve(rockitRuntimeFixtureDirectory, fixtureName)
    const relativePath = path.relative(rockitRuntimeFixtureDirectory, fixturePath)
    const fixtureStats = await stat(fixturePath).catch(() => undefined)

    if (
      relativePath.startsWith('..') ||
      path.isAbsolute(relativePath) ||
      !fixtureStats?.isDirectory()
    ) {
      throw new Error(
        `RocKIT runtime fixture must be a directory inside ${rockitRuntimeFixtureDirectory}: ${fixtureName}`,
      )
    }

    await cp(fixturePath, paths.rockitRoot, { recursive: true })
  }

  await writeFile(
    path.join(paths.rockitRoot, 'settings.json'),
    `${JSON.stringify(
      {
        'rockit.splash.showAtStartup': false,
        'rockit.updates.notifyAtStartup': false,
        // Match Electron's initial style so Theia does not edit settings.json
        // during startup and leave that preference change on its undo stack.
        'window.titleBarStyle': process.platform === 'win32' ? 'custom' : 'native',
        ...(externalChangeAction
          ? { 'rockit.roCrate.externalChangeAction': externalChangeAction }
          : {}),
      },
      null,
      2,
    )}\n`,
  )

  return paths
}

const launchEnvironment = (paths: ElectronRuntimePaths): Record<string, string> => {
  const environment = stringEnvironment({
    ...process.env,
    APPDATA: path.join(paths.home, 'AppData', 'Roaming'),
    HOME: paths.home,
    LOCALAPPDATA: path.join(paths.home, 'AppData', 'Local'),
    ROCKIT_ROOT_PATH: paths.rockitRoot,
    THEIA_CONFIG_DIR: paths.rockitRoot,
    USERPROFILE: paths.home,
    XDG_CACHE_HOME: path.join(paths.home, '.cache'),
    XDG_CONFIG_HOME: path.join(paths.home, '.config'),
    XDG_DATA_HOME: path.join(paths.home, '.local', 'share'),
  })
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.THEIA_DEFAULT_PLUGINS
  delete environment.THEIA_PLUGINS
  return environment
}

const launchElectronSession = async ({
  artifactDirectory,
  diagnostics,
  observedPages,
  openDialogPath,
  paths,
  saveDialogPath,
  testWorkspacePath,
}: ElectronSessionOptions): Promise<ElectronSession> => {
  const videoDirectory = path.join(artifactDirectory, 'videos')
  await mkdir(videoDirectory, { recursive: true })

  let application: ElectronApplication | undefined
  try {
    application = await _electron.launch({
      args: [
        electronMainPath,
        testWorkspacePath,
        `--electronUserData=${paths.electronUserData}`,
        `--plugins=local-dir:${paths.plugins}`,
      ],
      artifactsDir: artifactDirectory,
      cwd: repositoryRoot,
      env: launchEnvironment(paths),
      recordVideo: { dir: videoDirectory },
      timeout: 30_000,
      tracesDir: artifactDirectory,
    })

    application.on('console', (message) => {
      diagnostics.mainProcessConsole.push(`[${message.type()}] ${message.text()}`)
    })
    application.on('window', (page) => observePage(page, diagnostics, observedPages))

    await application.context().route('**/*', async (route) => {
      const url = route.request().url()
      if (isLocalApplicationUrl(url)) {
        await route.continue()
        return
      }

      diagnostics.blockedExternalRequests.push(url)
      await route.abort('blockedbyclient')
    })
    await application.context().tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    })
    await mockNativeBoundaries(application, openDialogPath, saveDialogPath)

    const page = await application.firstWindow({ timeout: 30_000 })
    observePage(page, diagnostics, observedPages)
    page.setDefaultNavigationTimeout(30_000)
    page.setDefaultTimeout(15_000)

    return { application, artifactDirectory, page, paths }
  } catch (error) {
    if (application) {
      await closeElectronApplication(application).catch(() => undefined)
    }
    throw error
  }
}

const attachFailureArtifacts = async (
  runtime: ElectronRuntime,
  testInfo: TestInfo,
  artifactDirectory: string,
  failed: boolean,
): Promise<Video[]> => {
  if (!failed) {
    await runtime.application.context().tracing.stop()
    return []
  }

  const videos = Array.from(
    new Set(
      [runtime.page, ...runtime.application.windows()]
        .map((page) => page.video())
        .filter((video): video is Video => video !== null),
    ),
  )

  const screenshotPath = path.join(artifactDirectory, 'electron-window.png')
  if (!runtime.page.isClosed()) {
    await runtime.page.screenshot({ path: screenshotPath }).catch(() => undefined)
    await testInfo
      .attach('electron-window', { contentType: 'image/png', path: screenshotPath })
      .catch(() => undefined)
  }

  const tracePath = path.join(artifactDirectory, 'electron-trace.zip')
  await runtime.application.context().tracing.stop({ path: tracePath })
  await testInfo.attach('electron-trace', { path: tracePath })

  const diagnostics = `${JSON.stringify(runtime.diagnostics, null, 2)}\n`
  await testInfo.attach('electron-diagnostics', {
    body: Buffer.from(diagnostics),
    contentType: 'application/json',
  })

  return videos
}

const attachVideos = async (videos: Video[], testInfo: TestInfo): Promise<void> => {
  for (const [index, video] of videos.entries()) {
    const videoPath = await video.path()
    await testInfo.attach(`electron-video-${index + 1}`, {
      contentType: 'video/webm',
      path: videoPath,
    })
  }
}

export const test = workspaceTest.extend<ElectronOptions & ElectronFixtures>({
  electronExternalChangeAction: ['', { option: true }],
  electronOpenDialogDirectoryName: ['', { option: true }],
  electronSaveDialogFileName: ['', { option: true }],
  rockitRuntimeFixtureName: ['', { option: true }],

  electronRuntime: async (
    {
      electronExternalChangeAction,
      electronOpenDialogDirectoryName,
      electronSaveDialogFileName,
      rockitRuntimeFixtureName,
      testWorkspace,
    },
    use,
    testInfo,
  ) => {
    const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'rockit-e2e-runtime-'))
    const diagnostics: ElectronDiagnostics = {
      blockedExternalRequests: [],
      mainProcessConsole: [],
      rendererConsole: [],
      rendererErrors: [],
    }
    const observedPages = new WeakSet<Page>()
    let sessionNumber = 0
    let currentSession: ElectronSession | undefined
    let runtime: ElectronRuntime | undefined
    let primaryError: unknown

    if (
      electronSaveDialogFileName &&
      (path.basename(electronSaveDialogFileName) !== electronSaveDialogFileName ||
        electronSaveDialogFileName === '.' ||
        electronSaveDialogFileName === '..')
    ) {
      throw new Error(
        `Electron save-dialog fixture must be a plain file name: ${electronSaveDialogFileName}`,
      )
    }

    if (
      electronOpenDialogDirectoryName &&
      (path.basename(electronOpenDialogDirectoryName) !==
        electronOpenDialogDirectoryName ||
        electronOpenDialogDirectoryName === '.' ||
        electronOpenDialogDirectoryName === '..')
    ) {
      throw new Error(
        `Electron open-dialog fixture must be a plain directory name: ${electronOpenDialogDirectoryName}`,
      )
    }

    const startSession = async (
      persistedPaths?: ElectronRuntimePaths,
    ): Promise<ElectronSession> => {
      sessionNumber += 1
      const paths =
        persistedPaths ??
        (await prepareRuntimePaths(
          runtimeRoot,
          sessionNumber,
          rockitRuntimeFixtureName,
          electronExternalChangeAction,
        ))
      return launchElectronSession({
        artifactDirectory: testInfo.outputPath('electron', `session-${sessionNumber}`),
        diagnostics,
        observedPages,
        openDialogPath: electronOpenDialogDirectoryName
          ? path.join(paths.home, electronOpenDialogDirectoryName)
          : undefined,
        paths,
        saveDialogPath: electronSaveDialogFileName
          ? path.join(paths.home, electronSaveDialogFileName)
          : undefined,
        testWorkspacePath: testWorkspace.path,
      })
    }

    try {
      currentSession = await startSession()
      runtime = {
        application: currentSession.application,
        diagnostics,
        page: currentSession.page,
        paths: currentSession.paths,
        readMainProcessInteractions: async () => {
          if (!runtime) {
            throw new Error('Cannot read Electron interactions before launch')
          }
          return readMainProcessInteractions(runtime.application)
        },
        restartWithFreshState: async () => {
          if (!runtime || !currentSession) {
            throw new Error('Cannot restart Electron before its first session is ready')
          }

          await currentSession.application.context().tracing.stop()
          await closeElectronApplication(currentSession.application)
          currentSession = undefined

          const nextSession = await startSession()
          currentSession = nextSession
          runtime.application = nextSession.application
          runtime.page = nextSession.page
          runtime.paths = nextSession.paths

          return new RocKitPageObjects(nextSession.page, testWorkspace.path)
        },
        restartWithPersistedState: async () => {
          if (!runtime || !currentSession) {
            throw new Error('Cannot restart Electron before its first session is ready')
          }

          const persistedPaths = currentSession.paths
          await currentSession.application.context().tracing.stop()
          await closeElectronApplication(currentSession.application)
          currentSession = undefined

          const nextSession = await startSession(persistedPaths)
          currentSession = nextSession
          runtime.application = nextSession.application
          runtime.page = nextSession.page
          runtime.paths = nextSession.paths

          return new RocKitPageObjects(nextSession.page, testWorkspace.path)
        },
      }
      await use(runtime)
    } catch (error) {
      primaryError = error
    }

    let teardownError: unknown
    let videos: Video[] = []
    const failed =
      primaryError !== undefined || testInfo.status !== testInfo.expectedStatus

    if (runtime && currentSession) {
      await attachFailureArtifacts(
        runtime,
        testInfo,
        currentSession.artifactDirectory,
        failed,
      ).then(
        (capturedVideos) => {
          videos = capturedVideos
        },
        (error) => {
          teardownError = error
        },
      )
    }

    if (currentSession) {
      await closeElectronApplication(currentSession.application).catch((error) => {
        teardownError ??= error
      })
    }

    await attachVideos(videos, testInfo).catch((error) => {
      teardownError ??= error
    })
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 200 }).catch((error) => {
      teardownError ??= error
    })

    if (primaryError) {
      throw primaryError
    }
    if (teardownError) {
      throw teardownError
    }
  },

  electronApp: async ({ electronRuntime }, use) => {
    await use(electronRuntime.application)
  },

  appPage: async ({ electronRuntime }, use) => {
    await use(electronRuntime.page)
  },

  electronDiagnostics: async ({ electronRuntime }, use) => {
    await use(electronRuntime.diagnostics)
  },

  rockit: async ({ appPage, testWorkspace }, use) => {
    await use(new RocKitPageObjects(appPage, testWorkspace.path))
  },
})

export { expect }

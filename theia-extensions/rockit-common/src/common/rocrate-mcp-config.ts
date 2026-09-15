// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import * as path from 'path'

export type RocrateMcpConfigOptions = {
  appProjectPath?: string
  homeDir?: string
  platform?: NodeJS.Platform
  resourcesPath?: string
  serverPathOverride?: string
  socketPathOverride?: string
  username?: string
}

export function resolveAppProjectPathFromLocation(
  pathname: string | undefined,
  platform: NodeJS.Platform = getDefaultPlatform(),
): string | undefined {
  if (!pathname) {
    return undefined
  }

  let current = decodeURIComponent(pathname)
  if (platform === 'win32' && /^\/[a-zA-Z]:/.test(current)) {
    current = current.slice(1)
  }

  const separator = platform === 'win32' ? '\\' : '/'
  const parts = current.split(/[\\/]/).filter((part) => part.length > 0)
  while (parts.length > 0) {
    const candidate =
      platform === 'win32'
        ? parts.join(separator)
        : `${separator}${parts.join(separator)}`
    if (candidate.endsWith('electron-app') || candidate.endsWith('browser-app')) {
      return candidate
    }
    if (candidate.endsWith('aroma-2')) {
      return candidate
    }
    parts.pop()
  }

  return undefined
}

export function getRocrateMcpServerPathCandidates(
  options: RocrateMcpConfigOptions = {},
): string[] {
  const fsPath = getPathForPlatform(options.platform ?? getDefaultPlatform())
  const candidates: string[] = []
  const resourcesPath =
    options.resourcesPath ??
    resolveResourcesPathFromAsarAppProjectPath(options.appProjectPath, fsPath)

  if (options.serverPathOverride) {
    candidates.push(options.serverPathOverride)
  }

  if (options.appProjectPath && !isAsarAppProjectPath(options.appProjectPath)) {
    if (
      options.appProjectPath.endsWith('electron-app') ||
      options.appProjectPath.endsWith('browser-app')
    ) {
      candidates.push(
        fsPath.resolve(
          options.appProjectPath,
          '..',
          'theia-extensions',
          'rocrate-mcp-server',
          'lib',
          'server.js',
        ),
      )
    } else {
      candidates.push(
        fsPath.resolve(
          options.appProjectPath,
          'theia-extensions',
          'rocrate-mcp-server',
          'lib',
          'server.js',
        ),
      )
    }
  }

  if (resourcesPath) {
    candidates.push(
      fsPath.resolve(
        resourcesPath,
        'rocrate-mcp-server',
        'lib',
        'server.js',
      ),
    )

    // The MCP server is launched by an external process (plain Node, or Electron run
    // as Node), which cannot read files packed inside app.asar — asar is an
    // Electron-only virtual filesystem. rocrate-mcp-server is unpacked (see
    // electron-app `build.asarUnpack`), so prefer the app.asar.unpacked candidate;
    // keep app.asar as a fallback (it only resolves under Electron's file service).
    candidates.push(
      fsPath.resolve(
        resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'rocrate-mcp-server',
        'lib',
        'server.js',
      ),
    )
    candidates.push(
      fsPath.resolve(
        resourcesPath,
        'app.asar',
        'node_modules',
        'rocrate-mcp-server',
        'lib',
        'server.js',
      ),
    )
    candidates.push(
      fsPath.resolve(
        resourcesPath,
        'app',
        'theia-extensions',
        'rocrate-mcp-server',
        'lib',
        'server.js',
      ),
    )
    candidates.push(
      fsPath.resolve(
        resourcesPath,
        'theia-extensions',
        'rocrate-mcp-server',
        'lib',
        'server.js',
      ),
    )
  }

  return [...new Set(candidates.filter((candidate) => fsPath.isAbsolute(candidate)))]
}

export function resolveRocrateMcpSocketPath(
  options: RocrateMcpConfigOptions = {},
): string {
  if (options.socketPathOverride) {
    return options.socketPathOverride
  }

  const platform = options.platform ?? getDefaultPlatform()
  if (platform === 'win32') {
    const user = options.username ?? 'user'
    return `\\\\.\\pipe\\rockit-rocrate-mcp-${user}`
  }

  const fsPath = getPathForPlatform(platform)
  const homeDir = options.homeDir
  const base = homeDir ? fsPath.join(homeDir, '.rockit') : fsPath.join('/tmp', 'rockit')
  return fsPath.join(base, 'rocrate-mcp-server.sock')
}

export function resolveRocrateMcpPidPath(
  options: RocrateMcpConfigOptions = {},
): string {
  const platform = options.platform ?? getDefaultPlatform()
  const homeDir = options.homeDir
  const env =
    typeof process === 'undefined'
      ? {}
      : (process.env as Record<string, string | undefined>)
  const fsPath = getPathForPlatform(platform)
  const base =
    platform === 'win32'
      ? fsPath.join(
          env.LOCALAPPDATA || env.TEMP || homeDir || 'C:\\Temp',
          'RocKIT',
        )
      : homeDir
        ? fsPath.join(homeDir, '.rockit')
        : fsPath.join('/tmp', 'rockit')
  return fsPath.join(base, 'rocrate-mcp-server.pid')
}

export const ROCRATE_MCP_SHUTDOWN_CONTROL_MESSAGE = 'ROCKIT_ROCRATE_MCP_SHUTDOWN\n'

function getDefaultPlatform(): NodeJS.Platform {
  return (
    typeof process !== 'undefined' && process.platform
      ? process.platform
      : 'darwin'
  )
}

type PlatformPath = Pick<typeof path.posix, 'resolve' | 'isAbsolute' | 'join'>

const browserWindowsPath: PlatformPath = {
  resolve: (...segments: string[]) => normalizeWindowsPath(segments),
  join: (...segments: string[]) => normalizeWindowsPath(segments),
  isAbsolute: (value: string) =>
    /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value),
}

function normalizeWindowsPath(segments: string[]): string {
  const combined = segments
    .filter((segment) => segment.length > 0)
    .join('\\')
    .replace(/\//g, '\\')
  const drive = /^([a-zA-Z]:)\\?/.exec(combined)
  const unc = /^(\\\\[^\\]+\\[^\\]+)\\?/.exec(combined)
  const root = drive ? `${drive[1]}\\` : unc ? `${unc[1]}\\` : ''
  const remainder = combined.slice((drive ?? unc)?.[0].length ?? 0)
  const parts: string[] = []

  for (const part of remainder.split('\\')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
    } else {
      parts.push(part)
    }
  }

  return `${root}${parts.join('\\')}`
}

function getPathForPlatform(platform: NodeJS.Platform): PlatformPath {
  if (platform !== 'win32') {
    return path.posix
  }
  return (path.win32 as typeof path.win32 | null) ?? browserWindowsPath
}

function isAsarAppProjectPath(value: string | undefined): boolean {
  return !!value && /(^|[\\/])app\.asar([\\/]|$)/.test(value)
}

function resolveResourcesPathFromAsarAppProjectPath(
  appProjectPath: string | undefined,
  fsPath: PlatformPath,
): string | undefined {
  if (!isAsarAppProjectPath(appProjectPath)) {
    return undefined
  }
  const marker = /[\\/]app\.asar(?:[\\/].*)?$/
  const resourcesPath = appProjectPath?.replace(marker, '')
  return resourcesPath && fsPath.isAbsolute(resourcesPath) ? resourcesPath : undefined
}

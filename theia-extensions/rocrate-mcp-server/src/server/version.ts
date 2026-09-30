// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import * as fs from 'node:fs'
import * as path from 'node:path'

export type BuildInfo = {
  name: string
  version: string
  buildDate?: string
}

type PackageMetadata = {
  name?: unknown
  version?: unknown
  buildDate?: unknown
}

const FALLBACK_NAME = 'rocrate-mcp-server'
const FALLBACK_VERSION = 'unknown'

let cachedBuildInfo: BuildInfo | undefined

function readPackageMetadata(): PackageMetadata | undefined {
  const packagePaths = [
    // Standalone package: dist/npm/lib/server.js -> dist/npm/package.json.
    path.resolve(__dirname, '..', 'package.json'),
    // Workspace build: lib/server/version.js -> package root/package.json.
    path.resolve(__dirname, '..', '..', 'package.json'),
  ]

  for (const packagePath of packagePaths) {
    try {
      if (!fs.existsSync(packagePath)) {
        continue
      }
      const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as unknown
      if (parsed && typeof parsed === 'object') {
        return parsed as PackageMetadata
      }
    } catch {
      // Try the next package location when metadata is unavailable.
    }
  }

  return undefined
}

export function getBuildInfo(): BuildInfo {
  if (cachedBuildInfo) {
    return cachedBuildInfo
  }

  const metadata = readPackageMetadata()
  const name = typeof metadata?.name === 'string' ? metadata.name : FALLBACK_NAME
  const version = typeof metadata?.version === 'string' ? metadata.version : FALLBACK_VERSION
  const buildDate =
    typeof metadata?.buildDate === 'string' && metadata.buildDate.trim() !== ''
      ? metadata.buildDate
      : undefined

  cachedBuildInfo = { name, version, buildDate }
  return cachedBuildInfo
}

export function getServerUserAgent(): string {
  return `rocrate-mcp-server/${getBuildInfo().version}`
}

export function isVersionRequest(args: readonly string[]): boolean {
  return args.includes('-v') || args.includes('--version')
}

export function formatVersionInfo(info: BuildInfo): string {
  return [
    `rocrate-mcp-server ${info.version}`,
    `package: ${info.name}`,
    `build date: ${info.buildDate ?? 'unknown'}`,
  ].join('\n')
}

export function formatStartupVersion(info: BuildInfo): string {
  return `rocrate-mcp-server: version ${info.version} (built ${info.buildDate ?? 'unknown'})`
}

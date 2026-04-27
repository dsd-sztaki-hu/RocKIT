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
  platform: NodeJS.Platform = process.platform,
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
  const candidates: string[] = []

  if (options.serverPathOverride) {
    candidates.push(options.serverPathOverride)
  }

  if (options.appProjectPath) {
    if (
      options.appProjectPath.endsWith('electron-app') ||
      options.appProjectPath.endsWith('browser-app')
    ) {
      candidates.push(
        path.resolve(
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
        path.resolve(
          options.appProjectPath,
          'theia-extensions',
          'rocrate-mcp-server',
          'lib',
          'server.js',
        ),
      )
    }
  }

  if (options.resourcesPath) {
    candidates.push(
      path.resolve(
        options.resourcesPath,
        'app',
        'theia-extensions',
        'rocrate-mcp-server',
        'lib',
        'server.js',
      ),
    )
    candidates.push(
      path.resolve(
        options.resourcesPath,
        'theia-extensions',
        'rocrate-mcp-server',
        'lib',
        'server.js',
      ),
    )
  }

  return [...new Set(candidates.filter((candidate) => path.isAbsolute(candidate)))]
}

export function resolveRocrateMcpSocketPath(
  options: RocrateMcpConfigOptions = {},
): string {
  if (options.socketPathOverride) {
    return options.socketPathOverride
  }

  const platform = options.platform ?? process.platform
  if (platform === 'win32') {
    const user = options.username ?? 'user'
    return `\\\\.\\pipe\\aroma-rocrate-mcp-${user}`
  }

  const homeDir = options.homeDir
  const base = homeDir ? path.join(homeDir, '.aroma') : path.join('/tmp', 'aroma')
  return path.join(base, 'rocrate-mcp-server.sock')
}

export function resolveRocrateMcpPidPath(
  options: RocrateMcpConfigOptions = {},
): string {
  const platform = options.platform ?? process.platform
  const homeDir = options.homeDir
  const env =
    typeof process === 'undefined'
      ? {}
      : (process.env as Record<string, string | undefined>)
  const base =
    platform === 'win32'
      ? path.join(
          env.LOCALAPPDATA || env.TEMP || homeDir || 'C:\\Temp',
          'AROMA',
        )
      : homeDir
        ? path.join(homeDir, '.aroma')
        : path.join('/tmp', 'aroma')
  return path.join(base, 'rocrate-mcp-server.pid')
}

export const ROCRATE_MCP_SHUTDOWN_CONTROL_MESSAGE = 'AROMA_ROCRATE_MCP_SHUTDOWN\n'

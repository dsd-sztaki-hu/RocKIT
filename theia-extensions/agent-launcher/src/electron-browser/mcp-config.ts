// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

export type McpConfigKind = 'toml' | 'json'

export type ParsedMcpServer = {
  name: string
  command?: string
  args: string[]
  env?: Record<string, string>
  signature: string
  configPath?: string
}

export type McpKeepSetting = {
  agentId: string
  configPath: string
  kind: McpConfigKind
  serverName: string
  signature: string
}

export function parseMcpServerEntries(
  content: string,
  kind: McpConfigKind,
  agentId?: string,
): ParsedMcpServer[] {
  return kind === 'toml'
    ? parseTomlMcpServerEntries(content)
    : parseJsonMcpServerEntries(content, agentId)
}

export function mcpServerMatches(
  server: ParsedMcpServer,
  command: string,
  args: readonly string[],
): boolean {
  if (server.command !== command || server.args.length !== args.length) {
    return false
  }
  return server.args.every((arg, index) => arg === args[index])
}

export function mcpServerUsesSocket(
  server: ParsedMcpServer,
  socketPath: string,
  windows: boolean,
): boolean {
  const configuredSocket = getConnectSocketPath(server.args)
  if (!configuredSocket) {
    return false
  }
  return (
    normalizeSocketPath(configuredSocket, windows) ===
    normalizeSocketPath(socketPath, windows)
  )
}

export function chooseMcpServerName(
  existingNames: Iterable<string>,
  preferredName = 'rockitmcp',
): string {
  const occupiedNames = new Set(existingNames)
  if (!occupiedNames.has(preferredName)) {
    return preferredName
  }

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${preferredName}${suffix}`
    if (!occupiedNames.has(candidate)) {
      return candidate
    }
  }
}

export function hasRememberedMcpSetting(
  storedSettings: readonly McpKeepSetting[],
  currentSetting: McpKeepSetting,
): boolean {
  return storedSettings.some(
    (stored) =>
      stored.agentId === currentSetting.agentId &&
      stored.configPath === currentSetting.configPath &&
      stored.kind === currentSetting.kind &&
      stored.serverName === currentSetting.serverName &&
      stored.signature === currentSetting.signature,
  )
}

export function rememberMcpKeepSetting(
  storedSettings: readonly McpKeepSetting[],
  setting: McpKeepSetting,
): McpKeepSetting[] {
  return [
    ...storedSettings.filter(
      (stored) =>
        stored.agentId !== setting.agentId ||
        stored.configPath !== setting.configPath ||
        stored.kind !== setting.kind ||
        stored.serverName !== setting.serverName,
    ),
    setting,
  ]
}

export function forgetMcpKeepSetting(
  storedSettings: readonly McpKeepSetting[],
  setting: Pick<McpKeepSetting, 'agentId' | 'configPath' | 'kind' | 'serverName'>,
): McpKeepSetting[] {
  return storedSettings.filter(
    (stored) =>
      stored.agentId !== setting.agentId ||
      stored.configPath !== setting.configPath ||
      stored.kind !== setting.kind ||
      stored.serverName !== setting.serverName,
  )
}

function parseTomlMcpServerEntries(content: string): ParsedMcpServer[] {
  const sectionPattern =
    /^[ \t]*\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\][ \t]*\r?$/gm
  const entries: ParsedMcpServer[] = []
  let sectionMatch: RegExpExecArray | null

  while ((sectionMatch = sectionPattern.exec(content)) !== null) {
    const sectionStart = sectionMatch.index
    const sectionEnd = findNextTomlSection(content, sectionStart + sectionMatch[0].length)
    const body = content.slice(sectionStart + sectionMatch[0].length, sectionEnd)
    const command = parseTomlBasicString(readTomlAssignment(body, 'command'))
    const args = parseTomlStringArray(readTomlAssignment(body, 'args'))
    if (!command || !args) {
      continue
    }
    entries.push({
      name: sectionMatch[1] ?? sectionMatch[2],
      command,
      args,
      env: parseTomlInlineTable(readTomlAssignment(body, 'env')),
      signature: body.trim(),
    })
  }

  return entries
}

function findNextTomlSection(content: string, offset: number): number {
  const sectionPattern = /^[ \t]*\[[^\]]+\][ \t]*\r?$/gm
  sectionPattern.lastIndex = offset
  return sectionPattern.exec(content)?.index ?? content.length
}

function readTomlAssignment(body: string, key: string): string | undefined {
  const assignment = new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*(.+)$`, 'm').exec(body)
  return assignment?.[1]?.trim()
}

function parseTomlBasicString(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  const token = /^("(?:\\.|[^"\\])*")/.exec(value)?.[1]
  if (!token) {
    return undefined
  }
  try {
    const parsed = JSON.parse(token)
    return typeof parsed === 'string' ? parsed : undefined
  } catch {
    return undefined
  }
}

function parseTomlStringArray(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined
  }
  const openingBracket = value.indexOf('[')
  const closingBracket = value.lastIndexOf(']')
  if (openingBracket < 0 || closingBracket < openingBracket) {
    return undefined
  }

  const tokens =
    value.slice(openingBracket + 1, closingBracket).match(/"(?:\\.|[^"\\])*"/g) ?? []
  const parsed: string[] = []
  for (const token of tokens) {
    try {
      const item = JSON.parse(token)
      if (typeof item !== 'string') {
        return undefined
      }
      parsed.push(item)
    } catch {
      return undefined
    }
  }
  return parsed
}

function parseTomlInlineTable(
  value: string | undefined,
): Record<string, string> | undefined {
  if (!value) {
    return undefined
  }
  const openingBrace = value.indexOf('{')
  const closingBrace = value.lastIndexOf('}')
  if (openingBrace < 0 || closingBrace < openingBrace) {
    return undefined
  }

  const result: Record<string, string> = {}
  const pairPattern = /([A-Za-z0-9_-]+)[ \t]*=[ \t]*("(?:\\.|[^"\\])*")/g
  const table = value.slice(openingBrace + 1, closingBrace)
  let pairMatch: RegExpExecArray | null
  while ((pairMatch = pairPattern.exec(table)) !== null) {
    const parsed = parseTomlBasicString(pairMatch[2])
    if (parsed !== undefined) {
      result[pairMatch[1]] = parsed
    }
  }
  return result
}

function parseJsonMcpServerEntries(content: string, agentId?: string): ParsedMcpServer[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return []
  }
  if (!isRecord(parsed)) {
    return []
  }

  const containers = getJsonMcpContainers(parsed, agentId)
  const entries: ParsedMcpServer[] = []
  const seenContainers = new Set<Record<string, unknown>>()
  for (const container of containers) {
    if (!isRecord(container) || seenContainers.has(container)) {
      continue
    }
    seenContainers.add(container)
    for (const [name, value] of Object.entries(container)) {
      const server = parseJsonMcpServer(name, value)
      if (server) {
        entries.push(server)
      }
    }
  }
  return entries
}

function getJsonMcpContainers(
  parsed: Record<string, unknown>,
  agentId?: string,
): unknown[] {
  if (agentId === 'opencode') {
    return [parsed.mcp]
  }
  if (agentId === 'claude') {
    const mcp = isRecord(parsed.mcp) ? parsed.mcp : undefined
    return [parsed.mcpServers, mcp?.servers, parsed.servers]
  }
  return [parsed.mcpServers]
}

function parseJsonMcpServer(name: string, value: unknown): ParsedMcpServer | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  let command: string | undefined
  let args: string[] = []
  if (Array.isArray(value.command)) {
    const commandArray = value.command.filter(
      (item): item is string => typeof item === 'string',
    )
    command = commandArray[0]
    args = commandArray.slice(1)
  } else if (typeof value.command === 'string') {
    command = value.command
    if (Array.isArray(value.args)) {
      args = value.args.filter((item): item is string => typeof item === 'string')
    }
  }
  if (!command) {
    return undefined
  }

  return {
    name,
    command,
    args,
    env: parseStringRecord(value.env) ?? parseStringRecord(value.environment),
    signature: stableJsonStringify(value),
  }
}

function parseStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      result[key] = item
    }
  }
  return result
}

function getConnectSocketPath(args: readonly string[]): string | undefined {
  const flagIndex = args.indexOf('--connect')
  if (flagIndex >= 0) {
    const value = args[flagIndex + 1]
    if (value?.trim()) {
      return value.trim()
    }
  }
  const inlineFlag = args.find((arg) => arg.startsWith('--connect='))
  return inlineFlag?.slice('--connect='.length).trim() || undefined
}

function normalizeSocketPath(value: string, windows: boolean): string {
  const normalized = value.trim().replace(/[\\/]+/g, windows ? '\\' : '/')
  return windows ? normalized.toLowerCase() : normalized
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

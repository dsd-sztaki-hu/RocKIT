import * as mime from 'mime-types'
import {
  DEFAULT_IGNORED_ENTRIES,
  ROCKIT_IGNORE_DIR,
  ROCKIT_IGNORE_FILE,
  RO_CRATE_APPROVAL_FILE_NAME,
  RO_CRATE_METADATA_FILE,
  RO_CRATE_PREVIEW_FILE,
} from './ro-crate-technical-files'

export type DefaultRoCrateFileContent = string | Uint8Array

export interface DefaultRoCrateDirectoryEntry {
  name: string
  relativePath: string
  kind: 'file' | 'directory'
  size?: number
  mtimeMs?: number
}

export interface DefaultRoCrateWorkspaceAdapter {
  rootName: string
  listChildren(relativeDirectoryPath: string): Promise<DefaultRoCrateDirectoryEntry[]>
  readFileContent?(relativeFilePath: string): Promise<DefaultRoCrateFileContent>
  hashContent?(content: DefaultRoCrateFileContent): string
  onFileScanned?(): void
  readTextFile?(relativeFilePath: string): Promise<string | undefined>
}

export interface DefaultRoCrateWorkspaceOptions {
  datePublished?: string
  existingIgnoredEntries?: readonly string[]
  writeIgnoredFile?: boolean
  rootDatasetDescription?: string
}

export interface DefaultRoCrateIgnoredFilePlan {
  directoryPath: string
  filePath: string
  entries: string[]
  payload: string
}

export interface DefaultRoCrateScanSummary {
  directoriesSeen: number
  filesSeen: number
  graphEntityCount: number
}

export interface DefaultRoCrateWorkspaceResult {
  crate: Record<string, unknown>
  ignoredFile?: DefaultRoCrateIgnoredFilePlan
  summary: DefaultRoCrateScanSummary
}

interface BuildEntityContext {
  graph: Record<string, unknown>[]
  directoriesSeen: number
  filesSeen: number
}

export async function createDefaultRoCrateWorkspace(
  adapter: DefaultRoCrateWorkspaceAdapter,
  options: DefaultRoCrateWorkspaceOptions = {},
): Promise<DefaultRoCrateWorkspaceResult> {
  const graph: Record<string, unknown>[] = []
  const rootHasPart: Array<{ '@id': string }> = []
  const context: BuildEntityContext = {
    graph,
    directoriesSeen: 0,
    filesSeen: 0,
  }

  graph.push({
    '@id': './',
    '@type': 'Dataset',
    name: humanizeDatasetName(adapter.rootName) || 'Root Dataset',
    description:
      options.rootDatasetDescription ?? `RO-Crate for the workspace: ${adapter.rootName}`,
    datePublished: options.datePublished ?? new Date().toISOString(),
    hasPart: rootHasPart,
  })

  graph.push({
    '@id': RO_CRATE_METADATA_FILE,
    '@type': 'CreativeWork',
    conformsTo: { '@id': 'https://w3id.org/ro/crate/1.1' },
    about: { '@id': './' },
    directoryLabel: '',
    name: RO_CRATE_METADATA_FILE,
  })

  const rootChildren = await adapter.listChildren('')
  for (const child of rootChildren) {
    const normalized = normalizeRelativePathForId(child.relativePath)
    if (!shouldIncludeDefaultRoCratePath(normalized, true)) {
      continue
    }
    await scanEntry(adapter, normalized, child, context, rootHasPart)
  }

  const crate = {
    '@context': [
      'https://w3id.org/ro/crate/1.1/context',
      {
        directoryLabel: 'https://dataverse.org/schema/file/directoryLabel',
        hash: 'https://dataverse.org/schema/file/hash',
      },
    ],
    '@graph': graph,
  }

  const ignoredFile =
    options.writeIgnoredFile === false
      ? undefined
      : await buildDefaultIgnoredFilePlan(adapter, options.existingIgnoredEntries)

  return {
    crate,
    ignoredFile,
    summary: {
      directoriesSeen: context.directoriesSeen,
      filesSeen: context.filesSeen,
      graphEntityCount: graph.length,
    },
  }
}

export async function buildDefaultIgnoredFilePlan(
  adapter: Pick<DefaultRoCrateWorkspaceAdapter, 'readTextFile'>,
  existingIgnoredEntries?: readonly string[],
): Promise<DefaultRoCrateIgnoredFilePlan> {
  const existing =
    existingIgnoredEntries ??
    (adapter.readTextFile
      ? parseIgnoredEntries((await adapter.readTextFile(`${ROCKIT_IGNORE_DIR}/${ROCKIT_IGNORE_FILE}`)) ?? '')
      : [])
  const entries = withDefaultIgnoredEntries(existing)
  return {
    directoryPath: ROCKIT_IGNORE_DIR,
    filePath: `${ROCKIT_IGNORE_DIR}/${ROCKIT_IGNORE_FILE}`,
    entries,
    payload: entries.length ? `${entries.join('\n')}\n` : '',
  }
}

export function parseIgnoredEntries(value: string): string[] {
  return value
    .split(/\r?\n/g)
    .map((line) => normalizeIgnoredEntry(line))
    .filter((line): line is string => Boolean(line))
}

export function normalizeIgnoredEntry(value: string): string | undefined {
  const trimmed = (value || '').trim()
  if (!trimmed || trimmed.startsWith('#')) {
    return undefined
  }

  const negated = trimmed.startsWith('!')
  let normalized = negated ? trimmed.slice(1) : trimmed
  normalized = normalized.replace(/\\/g, '/')
  normalized = normalized.replace(/^\.\//, '')
  normalized = normalized.replace(/^\/+/, '')
  normalized = normalized.replace(/\/{2,}/g, '/')

  const isDirectory = normalized.endsWith('/')
  if (isDirectory) {
    normalized = normalized.replace(/\/+$/, '')
  }
  if (!normalized) {
    return undefined
  }

  return `${negated ? '!' : ''}${normalized}${isDirectory ? '/' : ''}`.toLowerCase()
}

export function withDefaultIgnoredEntries(entries: readonly string[]): string[] {
  const normalizedEntries = entries
    .map((entry) => normalizeIgnoredEntry(entry))
    .filter((entry): entry is string => Boolean(entry))
  const defaults = DEFAULT_IGNORED_ENTRIES.map((entry) =>
    normalizeIgnoredEntry(entry),
  ).filter((entry): entry is string => Boolean(entry))
  const existingPositive = new Set(
    normalizedEntries.filter((entry) => !entry.startsWith('!')),
  )
  const missingDefaults = defaults.filter((entry) => !existingPositive.has(entry))
  if (!missingDefaults.length) {
    return normalizedEntries
  }
  return [...missingDefaults, ...normalizedEntries]
}

export function shouldIncludeDefaultRoCratePath(
  relativePath: string,
  isRootEntry = false,
): boolean {
  const normalized = normalizeRelativePathForId(relativePath)
  if (!normalized) {
    return false
  }
  if (isRootEntry) {
    const rootName = normalized.split('/')[0]
    if (rootName.startsWith('.')) {
      return false
    }
    if (
      rootName === RO_CRATE_METADATA_FILE ||
      rootName === RO_CRATE_PREVIEW_FILE ||
      rootName === RO_CRATE_APPROVAL_FILE_NAME ||
      rootName === 'AGENTS.md' ||
      rootName === 'CLAUDE.md' ||
      rootName === ROCKIT_IGNORE_DIR
    ) {
      return false
    }
  }
  return true
}

async function scanEntry(
  adapter: DefaultRoCrateWorkspaceAdapter,
  relativePath: string,
  entry: DefaultRoCrateDirectoryEntry,
  context: BuildEntityContext,
  parentHasPart: Array<{ '@id': string }>,
): Promise<void> {
  const { directoryLabel, name } = splitDirectoryInfo(relativePath)
  if (!name) {
    return
  }

  if (entry.kind === 'directory') {
    const entityId = buildEntityId(directoryLabel, name, true)
    if (!entityId) {
      return
    }
    const hasPart: Array<{ '@id': string }> = []
    const dirEntity = {
      '@id': entityId,
      '@type': 'Dataset',
      name: humanizeDatasetName(name),
      directoryLabel,
      hasPart,
    }
    context.graph.push(dirEntity)
    context.directoriesSeen += 1
    parentHasPart.push({ '@id': entityId })

    const children = await adapter.listChildren(relativePath)
    for (const child of children) {
      const childPath = normalizeRelativePathForId(child.relativePath)
      if (!shouldIncludeDefaultRoCratePath(childPath, false)) {
        continue
      }
      await scanEntry(adapter, childPath, child, context, hasPart)
    }
    return
  }

  const entityId = buildEntityId(directoryLabel, name, false)
  if (!entityId) {
    return
  }
  const hash = adapter.readFileContent && adapter.hashContent
    ? adapter.hashContent(await adapter.readFileContent(relativePath))
    : undefined
  const fileEntity: Record<string, unknown> = {
    '@id': entityId,
    '@type': 'File',
    name,
    directoryLabel,
    encodingFormat: mime.lookup(name) || 'application/octet-stream',
    contentSize: typeof entry.size === 'number' ? `${entry.size}` : undefined,
    dateModified:
      typeof entry.mtimeMs === 'number' ? new Date(entry.mtimeMs).toISOString() : undefined,
    ...(hash ? { hash } : {}),
  }
  adapter.onFileScanned?.()
  context.graph.push(fileEntity)
  context.filesSeen += 1
  parentHasPart.push({ '@id': entityId })
}

function splitDirectoryInfo(relativePath: string): { directoryLabel: string; name: string } {
  const normalized = normalizeRelativePathForId(relativePath)
  if (!normalized) {
    return { directoryLabel: '', name: '' }
  }
  const lastSlashIndex = normalized.lastIndexOf('/')
  if (lastSlashIndex === -1) {
    return { directoryLabel: '', name: normalized }
  }
  return {
    directoryLabel: normalized.slice(0, lastSlashIndex + 1),
    name: normalized.slice(lastSlashIndex + 1),
  }
}

function buildEntityId(
  directoryLabel: string,
  name: string,
  isDirectory: boolean,
): string | undefined {
  if (!name) {
    return undefined
  }
  let combined = `${directoryLabel}${name}`
  combined = normalizeRelativePathForId(combined)
  if (!combined) {
    return undefined
  }
  if (isDirectory && !combined.endsWith('/')) {
    combined = `${combined}/`
  }
  return combined
}

function normalizeRelativePathForId(inputPath: string): string {
  let normalized = (inputPath || '').replace(/\\/g, '/').trim()
  normalized = normalized.replace(/^\.\//, '')
  normalized = normalized.replace(/^\/+/, '')
  normalized = normalized.replace(/\/{2,}/g, '/')
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

function humanizeDatasetName(value: string): string {
  return (value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

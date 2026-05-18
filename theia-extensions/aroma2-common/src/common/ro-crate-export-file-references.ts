export type RoCrateExportFileSourceKind = 'workspace' | 'local'

export interface RoCrateExportFileSource {
  kind: RoCrateExportFileSourceKind
  value: string
}

export interface RoCrateExportFileReference {
  entityId: string
  entryPath: string
  sources: RoCrateExportFileSource[]
}

export interface CollectRoCrateExportFileReferencesOptions {
  includeMetadataFile?: boolean
}

const METADATA_FILE = 'ro-crate-metadata.json'

export function collectRoCrateExportFileReferences(
  crateOrGraph: unknown,
  options: CollectRoCrateExportFileReferencesOptions = {},
): RoCrateExportFileReference[] {
  const graph = Array.isArray(crateOrGraph)
    ? crateOrGraph
    : Array.isArray((crateOrGraph as { '@graph'?: unknown })?.['@graph'])
      ? (crateOrGraph as { '@graph': unknown[] })['@graph']
      : []

  const includeMetadataFile = options.includeMetadataFile === true
  const references: RoCrateExportFileReference[] = []

  for (const entry of graph) {
    if (!isRecord(entry) || !isFileEntity(entry)) {
      continue
    }

    const entityId = firstString(entry['@id'])
    const entryPath = deriveEntryPath(entry, entityId)
    if (!entryPath || (!includeMetadataFile && entryPath === METADATA_FILE)) {
      continue
    }

    const sources = collectSources(entry, entityId, entryPath)
    if (!sources.length) {
      continue
    }

    references.push({
      entityId: entityId || entryPath,
      entryPath,
      sources,
    })
  }

  return references
}

export function isLocalFileReference(value: string): boolean {
  const trimmed = value.trim()
  return (
    /^file:\/\//i.test(trimmed) ||
    /^[a-zA-Z]:[\\/]/.test(trimmed) ||
    /^[/\\]{2}[^/\\]/.test(trimmed) ||
    /^\/[^/]/.test(trimmed)
  )
}

export function isWorkspaceFileReference(value: string): boolean {
  const normalized = normalizePath(value)
  return Boolean(
      normalized &&
      normalized !== './' &&
      normalized !== '.' &&
      !isLocalFileReference(normalized) &&
      !hasUriScheme(normalized),
  )
}

export function normalizeRoCratePackagePath(value: string): string | undefined {
  let normalized = normalizePath(value)
  if (!normalized || normalized === '.' || normalized === './') {
    return undefined
  }
  normalized = normalized.replace(/^\.\/+/, '').replace(/^\/+/, '')
  normalized = normalized.replace(/\/+$/, '')
  if (!normalized || normalized.split('/').includes('..')) {
    return undefined
  }
  return normalized
}

function collectSources(
  entry: Record<string, unknown>,
  entityId: string,
  entryPath: string,
): RoCrateExportFileSource[] {
  const values = [
    entryPath,
    entityId,
    ...allStrings(entry.contentUrl),
    ...allStrings(entry.url),
    ...allStrings(entry.sameAs),
  ]

  const seen = new Set<string>()
  const sources: RoCrateExportFileSource[] = []

  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || trimmed === './' || trimmed === '.') {
      continue
    }

    const kind = getSourceKind(trimmed)
    if (!kind) {
      continue
    }

    const key = `${kind}:${trimmed}`
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    sources.push({ kind, value: kind === 'workspace' ? normalizePath(trimmed) : trimmed })
  }

  return sources
}

function getSourceKind(value: string): RoCrateExportFileSourceKind | undefined {
  if (isLocalFileReference(value)) {
    return 'local'
  }
  if (isWorkspaceFileReference(value)) {
    return 'workspace'
  }
  return undefined
}

function deriveEntryPath(entry: Record<string, unknown>, entityId: string): string | undefined {
  const relativeEntityId = isWorkspaceFileReference(entityId)
    ? normalizeRoCratePackagePath(entityId)
    : undefined
  if (relativeEntityId) {
    return relativeEntityId
  }

  const directoryLabel = firstString(entry.directoryLabel)
  const inferredDirectory = inferDirectoryFromReverseHasPart(entry)
  const directory = directoryLabel || inferredDirectory || ''
  const name = firstString(entry.name) || basenameFromReference(entityId)
  return normalizeRoCratePackagePath(joinPosix(directory, name))
}

function inferDirectoryFromReverseHasPart(entry: Record<string, unknown>): string {
  const reverse = entry['@reverse']
  if (!isRecord(reverse)) {
    return ''
  }
  const hasPart = reverse.hasPart
  const hasPartId = isRecord(hasPart) ? firstString(hasPart['@id']) : firstString(hasPart)
  if (!hasPartId || hasPartId === './' || hasPartId === '.') {
    return ''
  }
  const normalized = normalizePath(hasPartId)
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
}

function basenameFromReference(value: string): string {
  if (!value) {
    return ''
  }
  try {
    const parsed = new URL(value)
    const path = decodeURIComponent(parsed.pathname)
    return path.split('/').filter(Boolean).pop() || ''
  } catch {
    const normalized = normalizePath(value)
    return normalized.split('/').filter(Boolean).pop() || ''
  }
}

function isFileEntity(entry: Record<string, unknown>): boolean {
  return allStrings(entry['@type']).some((type) => type === 'File' || type.endsWith(':File'))
}

function allStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => allStrings(item))
  }
  if (isRecord(value)) {
    const id = firstString(value['@id'])
    return id ? [id] : []
  }
  return []
}

function firstString(value: unknown): string {
  return allStrings(value)[0] || ''
}

function hasUriScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
}

function joinPosix(dir: string, file: string): string {
  const d = normalizePath(dir).replace(/^\/+/, '').replace(/\/+$/, '')
  const f = normalizePath(file).replace(/^\/+/, '')
  return d ? `${d}/${f}` : f
}

function normalizePath(value: string): string {
  return (value || '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

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

export interface ResolvedRoCrateExportFileSource<TResolvedSource> {
  source: RoCrateExportFileSource
  value: TResolvedSource
}

export interface LocalizeExternalRoCrateFileReferencesOptions<TResolvedSource> {
  existingEntryPaths?: Iterable<string>
  importedResourcesDirectoryName?: string
  resolveLocalSource: (
    sources: readonly RoCrateExportFileSource[],
    reference: RoCrateExportFileReference,
  ) => Promise<ResolvedRoCrateExportFileSource<TResolvedSource> | undefined>
}

export interface LocalizedExternalRoCrateFileReference<TResolvedSource> {
  reference: RoCrateExportFileReference
  importedPath: string
  source: RoCrateExportFileSource
  resolvedSource: TResolvedSource
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

export async function localizeExternalRoCrateFileReferences<TResolvedSource>(
  crateOrGraph: unknown,
  options: LocalizeExternalRoCrateFileReferencesOptions<TResolvedSource>,
): Promise<LocalizedExternalRoCrateFileReference<TResolvedSource>[]> {
  const graph = Array.isArray(crateOrGraph)
    ? crateOrGraph
    : Array.isArray((crateOrGraph as { '@graph'?: unknown })?.['@graph'])
      ? (crateOrGraph as { '@graph': unknown[] })['@graph']
      : []
  const references = collectRoCrateExportFileReferences(graph)
    .map((reference) => ({
      reference,
      localSources: reference.sources.filter(
        (source): source is RoCrateExportFileSource => source.kind === 'local',
      ),
    }))
    .filter((item) => item.localSources.length > 0)

  const usedEntryPaths = new Set(
    [
      ...Array.from(options.existingEntryPaths ?? []),
      ...collectRoCrateExportFileReferences(graph).map((reference) => reference.entryPath),
    ].map((path) => path.toLowerCase()),
  )
  const importedSourcePaths = new Map<string, string>()
  const localized: LocalizedExternalRoCrateFileReference<TResolvedSource>[] = []
  const importedResourcesPrefix = `${options.importedResourcesDirectoryName || 'imported_resources'}/`

  for (const { reference, localSources } of references) {
    const resolved = await options.resolveLocalSource(localSources, reference)
    if (!resolved) {
      continue
    }

    const sourceKey = normalizeImportedSourceKey(resolved.source.value)
    let importedPath = importedSourcePaths.get(sourceKey)
    if (!importedPath) {
      importedPath = createUniqueImportedResourceEntryPath(
        importedResourcesPrefix,
        reference.entryPath,
        resolved.source.value,
        usedEntryPaths,
      )
      importedSourcePaths.set(sourceKey, importedPath)
      usedEntryPaths.add(importedPath.toLowerCase())
    }

    rewriteEntityIdReferences(graph, reference.entityId, importedPath)
    localized.push({
      reference,
      importedPath,
      source: resolved.source,
      resolvedSource: resolved.value,
    })
  }

  return localized
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

function createUniqueImportedResourceEntryPath(
  importedResourcesPrefix: string,
  entryPath: string,
  sourceValue: string,
  usedEntryPaths: Set<string>,
): string {
  const rawName = getImportedResourceFileName(entryPath, sourceValue)
  const { baseName, extension } = splitFileName(rawName)

  for (let index = 0; index < 10000; index += 1) {
    const candidateName = index === 0 ? `${baseName}${extension}` : `${baseName}_${index}${extension}`
    const candidatePath = `${importedResourcesPrefix}${candidateName}`
    if (!usedEntryPaths.has(candidatePath.toLowerCase())) {
      return candidatePath
    }
  }

  return `${importedResourcesPrefix}${baseName}_${Date.now()}${extension}`
}

function getImportedResourceFileName(entryPath: string, sourceValue: string): string {
  const candidate = entryPath || sourceValue
  const normalized = candidate.replace(/\\/g, '/').replace(/\/+$/, '')
  const fileName = normalized.split('/').filter(Boolean).pop() || 'imported_resource'
  const sanitized = Array.from(fileName)
    .map((char) => (isSafeFileNameCharacter(char) ? char : '_'))
    .join('')
  return sanitized || 'imported_resource'
}

function isSafeFileNameCharacter(char: string): boolean {
  return char.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(char)
}

function splitFileName(fileName: string): { baseName: string; extension: string } {
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    return { baseName: fileName, extension: '' }
  }
  return {
    baseName: fileName.slice(0, lastDot),
    extension: fileName.slice(lastDot),
  }
}

function normalizeImportedSourceKey(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function rewriteEntityIdReferences(value: unknown, oldId: string, newId: string): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      rewriteEntityIdReferences(item, oldId, newId)
    }
    return
  }
  if (!isRecord(value)) {
    return
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === '@id' && child === oldId) {
      value[key] = newId
      continue
    }
    rewriteEntityIdReferences(child, oldId, newId)
  }
}

function normalizePath(value: string): string {
  return (value || '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

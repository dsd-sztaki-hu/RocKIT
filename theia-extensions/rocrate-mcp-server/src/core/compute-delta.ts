// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import * as fs from 'node:fs'
import * as path from 'node:path'

import { type RoCrate, type RoCrateDelta, type RoCrateEntity, type RoCrateReference } from './types'

type ComputeDeltaOptions = {
  includeHidden?: boolean
}

function normalizePath(inputPath: string): string {
  let value = inputPath.split('\\').join('/').trim()
  while (value.startsWith('/')) {
    value = value.slice(1)
  }
  if (value.startsWith('./')) {
    value = value.slice(2)
  }
  value = value.replace(/\/{2,}/g, '/')
  return value
}

function canonicalId(entityId: string): string {
  if (entityId === './' || entityId === '.') {
    return 'dir:./'
  }
  let normalized = entityId
  if (normalized.startsWith('file://./')) {
    normalized = normalized.slice('file://./'.length)
  } else if (normalized.startsWith('./')) {
    normalized = normalized.slice(2)
  }
  normalized = normalizePath(normalized)
  if (normalized.endsWith('/')) {
    return `dir:${normalized}`
  }
  return `file:${normalized}`
}

function datasetIdFromRelativePath(relativeDirectory: string): string {
  const normalized = normalizePath(relativeDirectory)
  if (!normalized) {
    return './'
  }
  return normalized.endsWith('/') ? `file://./${normalized}` : `file://./${normalized}/`
}

function fileIdFromRelativePath(relativeFile: string): string {
  return `file://./${normalizePath(relativeFile)}`
}

function extractHasPartIds(entity: RoCrateEntity): Set<string> {
  const raw = entity.hasPart
  const values: RoCrateReference[] = Array.isArray(raw)
    ? raw.filter(
        (item): item is RoCrateReference =>
          Boolean(item) && typeof item === 'object' && typeof item['@id'] === 'string',
      )
    : raw && typeof raw === 'object' && typeof raw['@id'] === 'string'
      ? [raw]
      : []
  return new Set<string>(values.map((item) => item['@id']))
}

function rootEntityName(rootPath: string): string {
  const base = path.basename(rootPath)
  return base || 'Root'
}

function collectWorkspaceEntries(
  rootPath: string,
  includeHidden: boolean,
): { directories: string[]; files: string[] } {
  const directories: string[] = []
  const files: string[] = []

  const ignoredRootFiles = new Set([
    'ro-crate-metadata.json',
    'ro-crate-preview.html',
    'ro-crate-approval.json',
    '.rockit/ro-crate-approval.json',
  ])

  function walk(currentPath: string): void {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!includeHidden && entry.name.startsWith('.')) {
        continue
      }

      const absoluteChild = path.join(currentPath, entry.name)
      const relativeChild = normalizePath(path.relative(rootPath, absoluteChild))
      if (!relativeChild) {
        continue
      }
      if (relativeChild === '.rockit' || relativeChild.startsWith('.rockit/')) {
        continue
      }
      if (ignoredRootFiles.has(relativeChild)) {
        continue
      }
      if (entry.isDirectory()) {
        directories.push(`${relativeChild}/`)
        walk(absoluteChild)
      } else if (entry.isFile()) {
        files.push(relativeChild)
      }
    }
  }

  walk(rootPath)
  directories.sort()
  files.sort()
  return { directories, files }
}

function mimeTypeFromFilename(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.csv')) return 'text/csv'
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.zip')) return 'application/zip'
  return 'application/octet-stream'
}

function directoryName(relativeDirectory: string): string {
  const trimmed = relativeDirectory.endsWith('/')
    ? relativeDirectory.slice(0, -1)
    : relativeDirectory
  if (!trimmed) {
    return 'Root'
  }
  const segments = trimmed.split('/')
  return segments[segments.length - 1]
}

function buildTargetEntities(
  rootPath: string,
  directories: string[],
  files: string[],
): {
  entitiesByCanonicalId: Map<string, RoCrateEntity>
  edges: Array<{ dataset: string; child: string }>
} {
  const entitiesByCanonicalId = new Map<string, RoCrateEntity>()
  const edges: Array<{ dataset: string; child: string }> = []

  const rootDataset: RoCrateEntity = {
    '@id': './',
    '@type': 'Dataset',
    name: rootEntityName(rootPath),
  }
  entitiesByCanonicalId.set(canonicalId('./'), rootDataset)

  const metadataEntity: RoCrateEntity = {
    '@id': 'ro-crate-metadata.json',
    '@type': 'CreativeWork',
    name: 'ro-crate-metadata.json',
    conformsTo: { '@id': 'https://w3id.org/ro/crate/1.1' },
    about: { '@id': './' },
  }
  entitiesByCanonicalId.set(canonicalId('ro-crate-metadata.json'), metadataEntity)

  for (const relativeDirectory of directories) {
    const datasetId = datasetIdFromRelativePath(relativeDirectory)
    entitiesByCanonicalId.set(canonicalId(datasetId), {
      '@id': datasetId,
      '@type': 'Dataset',
      name: directoryName(relativeDirectory),
    })
    const parentPath = normalizePath(path.dirname(relativeDirectory))
    const parentId =
      parentPath === '' || parentPath === '.'
        ? './'
        : datasetIdFromRelativePath(`${parentPath}/`)
    edges.push({ dataset: parentId, child: datasetId })
  }

  for (const relativeFile of files) {
    const fileId = fileIdFromRelativePath(relativeFile)
    const absoluteFile = path.join(rootPath, relativeFile)
    const stat = fs.statSync(absoluteFile)
    entitiesByCanonicalId.set(canonicalId(fileId), {
      '@id': fileId,
      '@type': 'File',
      name: path.basename(relativeFile),
      encodingFormat: mimeTypeFromFilename(relativeFile),
      contentSize: stat.size,
    })
    const parentPath = normalizePath(path.dirname(relativeFile))
    const parentId =
      parentPath === '' || parentPath === '.'
        ? './'
        : datasetIdFromRelativePath(`${parentPath}/`)
    edges.push({ dataset: parentId, child: fileId })
  }

  return { entitiesByCanonicalId, edges }
}

export function computeDelta(
  crate: RoCrate,
  rootPath: string,
  options: ComputeDeltaOptions = {},
): RoCrateDelta {
  const includeHidden = options.includeHidden ?? false
  const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []

  const existingByCanonicalId = new Map<string, RoCrateEntity>()
  const canonicalToRawId = new Map<string, string>()
  for (const entity of graph) {
    if (typeof entity?.['@id'] !== 'string') {
      continue
    }
    const canonical = canonicalId(entity['@id'])
    existingByCanonicalId.set(canonical, entity)
    if (!canonicalToRawId.has(canonical)) {
      canonicalToRawId.set(canonical, entity['@id'])
    }
  }

  const { directories, files } = collectWorkspaceEntries(rootPath, includeHidden)
  const { entitiesByCanonicalId, edges } = buildTargetEntities(rootPath, directories, files)

  const addEntities: RoCrateEntity[] = []
  for (const [canonical, entity] of entitiesByCanonicalId) {
    if (existingByCanonicalId.has(canonical)) {
      continue
    }
    addEntities.push(entity)
    if (typeof entity['@id'] === 'string') {
      canonicalToRawId.set(canonical, entity['@id'])
    }
  }

  const existingEdges = new Set<string>()
  for (const [canonicalParent, entity] of existingByCanonicalId) {
    const parentRawId = canonicalToRawId.get(canonicalParent) ?? entity['@id']
    if (typeof parentRawId !== 'string') {
      continue
    }
    for (const childRawId of extractHasPartIds(entity)) {
      const key = `${canonicalId(parentRawId)}->${canonicalId(childRawId)}`
      existingEdges.add(key)
    }
  }

  const addHasPart: Array<{ dataset: string; child: string }> = []
  for (const edge of edges) {
    const parentCanonical = canonicalId(edge.dataset)
    const childCanonical = canonicalId(edge.child)
    const key = `${parentCanonical}->${childCanonical}`
    if (existingEdges.has(key)) {
      continue
    }
    addHasPart.push({
      dataset: canonicalToRawId.get(parentCanonical) ?? edge.dataset,
      child: canonicalToRawId.get(childCanonical) ?? edge.child,
    })
  }

  return {
    summary: {
      newEntities: addEntities.length,
      newHasPartEdges: addHasPart.length,
      directoriesSeen: directories.length,
      filesSeen: files.length,
    },
    addEntities,
    addHasPart,
  }
}

import type { Command } from '@theia/core/lib/common/command'

export const OpenRoCrateEntityForResourceCommand: Command = {
  id: 'rockit.roCrateEditor.openEntityForResource',
}

export function normalizeRoCrateEntityPath(
  value: string | undefined,
): string | undefined {
  let normalized = value?.trim().replace(/\\/g, '/')
  if (!normalized) {
    return undefined
  }
  if (normalized.startsWith('file://./')) {
    normalized = normalized.slice('file://./'.length)
  } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalized)) {
    return undefined
  }
  normalized = normalized.replace(/^\.\//, '').replace(/^\/+/, '')
  try {
    normalized = decodeURIComponent(normalized)
  } catch {
    // Retain the original path when an entity ID contains a literal percent.
  }
  return normalized || undefined
}

export function findRoCrateEntityIdForPath(
  graph: unknown,
  resourcePath: string | undefined,
): string | undefined {
  const targetPath = normalizeRoCrateEntityPath(resourcePath)
  if (!targetPath || !Array.isArray(graph)) {
    return undefined
  }

  for (const entity of graph) {
    if (!entity || typeof entity !== 'object') {
      continue
    }
    const entityId = (entity as Record<string, unknown>)['@id']
    if (
      typeof entityId === 'string' &&
      normalizeRoCrateEntityPath(entityId) === targetPath
    ) {
      return entityId
    }
  }
  return undefined
}

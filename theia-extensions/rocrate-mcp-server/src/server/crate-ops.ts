import * as fs from 'node:fs'
import * as path from 'node:path'
import type { RoCrate, RoCrateChangeSet, RoCrateEntity } from '../core/types'
import type { AccessMode, ResponseMode } from './types'

type CrateOpsDeps = {
  changeSetAllowedKeys: Set<string>
  resolveCratePath: () => string
  readCrateFromFile: (cratePath: string) => RoCrate
  normalizeCrate: (crate: RoCrate) => RoCrate
  uniqueStrings: (values: string[]) => string[]
  entityTypes: (entity: RoCrateEntity) => string[]
  extractConformsToUrls: (value: unknown) => string[]
}

/**
 * Handles create crate ops helpers.
 */
export function createCrateOpsHelpers(deps: CrateOpsDeps) {
  /**
   * Handles ensure crate path.
   */
  function ensureCratePath(inputPath?: unknown): string {
    if (typeof inputPath === 'string' && inputPath.trim() !== '') {
      const resolved = path.resolve(inputPath)
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        const metadataPath = path.join(resolved, 'ro-crate-metadata.json')
        if (!fs.existsSync(metadataPath)) {
          throw new Error(
            `cratePath points to a directory but ro-crate-metadata.json was not found: ${metadataPath}`,
          )
        }
        return metadataPath
      }
      return resolved
    }
    return deps.resolveCratePath()
  }

  /**
   * Handles parse access mode.
   */
  function parseAccessMode(params: Record<string, unknown>): AccessMode {
    if (params.mode === 'remote') {
      return 'remote'
    }
    if (params.mode === 'local') {
      return 'local'
    }
    return process.env.ROCRATE_MCP_DEFAULT_MODE === 'remote' ? 'remote' : 'local'
  }

  /**
   * Handles parse response mode.
   */
  function parseResponseMode(
    params: Record<string, unknown>,
    defaultMode: ResponseMode = 'summary',
  ): ResponseMode {
    if (params.responseMode === 'full') {
      return 'full'
    }
    if (params.responseMode === 'summary') {
      return 'summary'
    }
    return defaultMode
  }

  /**
   * Handles as ro crate.
   */
  function asRoCrate(value: unknown): RoCrate {
    return deps.normalizeCrate(value as RoCrate)
  }

  /**
   * Loads a crate from tool params in either local or remote mode.
   *
   * - `remote`: expects `params.crate` and normalizes it.
   * - `local`: resolves `cratePath` (or default path) and reads metadata from disk.
   */
  function loadCrateFromParams(params: Record<string, unknown>): {
    mode: AccessMode
    crate: RoCrate
    cratePath?: string
  } {
    const mode = parseAccessMode(params)
    if (mode === 'remote') {
      const crateParam = params.crate
      if (!crateParam || typeof crateParam !== 'object' || Array.isArray(crateParam)) {
        throw new Error('remote mode requires crate object.')
      }
      return { mode, crate: asRoCrate(crateParam) }
    }
    const cratePath = ensureCratePath(params.cratePath)
    const crate = deps.readCrateFromFile(cratePath)
    return { mode, crate, cratePath }
  }

  /**
   * Validates `apply_changes` payload shape against supported canonical keys.
   */
  function normalizeChangeSet(input: unknown): RoCrateChangeSet {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('apply_changes requires changeSet object.')
    }
    const raw = input as Record<string, unknown>
    const normalized: Record<string, unknown> = { ...raw }

    const unknownKeys = Object.keys(normalized).filter(
      (key) => !deps.changeSetAllowedKeys.has(key),
    )
    if (unknownKeys.length > 0) {
      throw new Error(
        `apply_changes changeSet has unsupported keys: ${unknownKeys.join(
          ', ',
        )}. Supported keys: ${Array.from(deps.changeSetAllowedKeys).join(', ')}`,
      )
    }

    return normalized as RoCrateChangeSet
  }

  /**
   * Handles read profile url list.
   */
  function readProfileUrlList(value: unknown): string[] {
    const urls: string[] = []
    if (!Array.isArray(value)) {
      return urls
    }
    for (const item of value) {
      if (typeof item !== 'string') {
        continue
      }
      const trimmed = item.trim()
      if (trimmed !== '') {
        urls.push(trimmed)
      }
    }
    return deps.uniqueStrings(urls)
  }

  /**
   * Parses and validates profile `conformsTo` update operations.
   *
   * Enforces mutually exclusive usage:
   * - either `set`
   * - or any combination of `add`/`remove`
   */
  function readProfileConformsToUpdateOps(params: Record<string, unknown>): {
    add: string[]
    remove: string[]
    set?: string[]
  } {
    const add = readProfileUrlList(params.add)
    const remove = readProfileUrlList(params.remove)
    const setList = readProfileUrlList(params.set)
    const set = setList.length > 0 ? setList : undefined
    if (set && (add.length > 0 || remove.length > 0)) {
      throw new Error('update_profile_conforms_to does not allow set together with add/remove.')
    }
    if (!set && add.length === 0 && remove.length === 0) {
      throw new Error('update_profile_conforms_to requires at least one operation: add, remove, or set.')
    }
    return { add, remove, set }
  }

  /**
   * Applies `conformsTo` updates on one Dataset/File entity and reports the diff.
   *
   * Throws when the target entity does not exist or is not `Dataset`/`File`.
   * Returns previous, added, removed, and final URL lists.
   */
  function updateProfileConformsTo(
    crate: RoCrate,
    entityId: string,
    ops: { add: string[]; remove: string[]; set?: string[] },
  ): {
    previousUrls: string[]
    addedUrls: string[]
    removedUrls: string[]
    finalUrls: string[]
  } {
    const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
    const target = graph.find(
      (entity) =>
        !!entity &&
        typeof entity === 'object' &&
        !Array.isArray(entity) &&
        entity['@id'] === entityId,
    )
    if (!target) {
      throw new Error(`Entity not found for conformsTo update: ${entityId}`)
    }
    const types = deps.entityTypes(target)
    if (!types.includes('Dataset') && !types.includes('File')) {
      throw new Error(
        `update_profile_conforms_to target must be Dataset or File: ${entityId}`,
      )
    }

    const previousUrls = deps.extractConformsToUrls(target.conformsTo)
    const finalUrls = ops.set
      ? deps.uniqueStrings(ops.set)
      : deps.uniqueStrings(
          previousUrls
            .filter((url) => !ops.remove.includes(url))
            .concat(ops.add),
        )
    const previousSet = new Set(previousUrls)
    const finalSet = new Set(finalUrls)
    const addedUrls = finalUrls.filter((url) => !previousSet.has(url))
    const removedUrls = previousUrls.filter((url) => !finalSet.has(url))
    if (finalUrls.length === 0) {
      delete target.conformsTo
    } else {
      target.conformsTo = finalUrls.map((url) => ({ '@id': url }))
    }
    return { previousUrls, addedUrls, removedUrls, finalUrls }
  }

  /**
   * Detects which Dataset/File entities have profile-related changes in a change set.
   *
   * Used to scope profile re-validation after `apply_changes`.
   * Considers:
   * - root `setRootFields.conformsTo`
   * - entity updates touching `merge.conformsTo` or `unset: ['conformsTo']`
   * - added entities that declare `conformsTo`
   */
  function detectProfileChangeTargets(
    baseCrate: RoCrate,
    changeSet: RoCrateChangeSet,
  ): string[] {
    const targets = new Set<string>()
    const graph = Array.isArray(baseCrate['@graph']) ? baseCrate['@graph'] : []
    const graphById = new Map<string, RoCrateEntity>()
    for (const entity of graph) {
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
        continue
      }
      const entityId = typeof entity['@id'] === 'string' ? entity['@id'] : undefined
      if (entityId) {
        graphById.set(entityId, entity)
      }
    }

    const hasDatasetOrFileType = (value: unknown): boolean => {
      if (typeof value === 'string') {
        return value === 'Dataset' || value === 'File'
      }
      if (Array.isArray(value)) {
        return value.some((item) => item === 'Dataset' || item === 'File')
      }
      return false
    }

    const setRootFields =
      changeSet.setRootFields &&
      typeof changeSet.setRootFields === 'object' &&
      !Array.isArray(changeSet.setRootFields)
        ? (changeSet.setRootFields as Record<string, unknown>)
        : undefined
    if (setRootFields && Object.prototype.hasOwnProperty.call(setRootFields, 'conformsTo')) {
      targets.add('./')
    }

    const updates = Array.isArray(changeSet.updateEntities) ? changeSet.updateEntities : []
    for (const update of updates) {
      if (!update || typeof update !== 'object' || Array.isArray(update)) {
        continue
      }
      const entityId = typeof update['@id'] === 'string' ? update['@id'] : undefined
      if (!entityId) {
        continue
      }
      const merge =
        update.merge && typeof update.merge === 'object' && !Array.isArray(update.merge)
          ? (update.merge as Record<string, unknown>)
          : undefined
      const unset = Array.isArray(update.unset)
        ? update.unset.filter((item): item is string => typeof item === 'string')
        : []
      const touchesConformsTo = Boolean(
        (merge && Object.prototype.hasOwnProperty.call(merge, 'conformsTo')) ||
          unset.includes('conformsTo'),
      )
      if (!touchesConformsTo) {
        continue
      }

      const existing = graphById.get(entityId)
      const mergedType = merge ? merge['@type'] : undefined
      const existingType = existing ? existing['@type'] : undefined
      if (hasDatasetOrFileType(mergedType) || hasDatasetOrFileType(existingType)) {
        targets.add(entityId)
      }
    }

    const additions = Array.isArray(changeSet.addEntities) ? changeSet.addEntities : []
    for (const entity of additions) {
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
        continue
      }
      const entityId = typeof entity['@id'] === 'string' ? entity['@id'] : undefined
      if (!entityId) {
        continue
      }
      if (!Object.prototype.hasOwnProperty.call(entity, 'conformsTo')) {
        continue
      }
      if (hasDatasetOrFileType(entity['@type'])) {
        targets.add(entityId)
      }
    }

    return Array.from(targets).sort((a, b) => a.localeCompare(b))
  }

  return {
    ensureCratePath,
    parseAccessMode,
    parseResponseMode,
    asRoCrate,
    loadCrateFromParams,
    normalizeChangeSet,
    readProfileUrlList,
    readProfileConformsToUpdateOps,
    updateProfileConformsTo,
    detectProfileChangeTargets,
  }
}

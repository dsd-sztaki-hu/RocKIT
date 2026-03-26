import { inject, injectable } from '@theia/core/shared/inversify'
import URI from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { FileSearchService } from '@theia/file-search/lib/common/file-search-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateIgnoredFilesService } from './ro-crate-ignored-files-service'

export interface RoCrateWorkspaceResource {
  /**
   * Workspace-relative path (for example: `dir/file.txt` or `dir/subdir`).
   */
  path: string
  /**
   * `true` when the resource points to a folder (`Dataset` scope), `false` for files.
   */
  isDirectory: boolean
  /**
   * Optional concrete URI of the resource.
   * Used when available to improve recursive scans for directory include.
   */
  uri?: URI
}

export interface IncludeResourcesResult {
  /**
   * Whether `appState.roCrate` was available and processed.
   * `false` means only ignored.txt state was updated.
   */
  metadataLoaded: boolean
  /**
   * Number of newly created `File` entities.
   */
  addedFiles: number
  /**
   * Number of newly created `Dataset` entities.
   */
  addedDatasets: number
  /**
   * Number of `hasPart` links that were added.
   */
  linkedReferences: number
}

export interface OmitResourcesResult {
  /**
   * Whether `appState.roCrate` was available and processed.
   * `false` means only ignored.txt state was updated.
   */
  metadataLoaded: boolean
  /**
   * Number of RO-Crate entities that match the omitted resources.
   */
  pairedDescriptionCount: number
  /**
   * Number of paired entities actually removed from `@graph`.
   */
  removedDescriptionCount: number
}

export interface SyncIgnoredDescriptionsResult {
  /**
   * Whether `appState.roCrate` was available and processed.
   */
  metadataLoaded: boolean
  /**
   * Number of RO-Crate entities currently matched by ignored rules.
   */
  matchedDescriptionCount: number
  /**
   * Number of matched entities removed from `@graph`.
   */
  removedDescriptionCount: number
}

/**
 * Shared, path-based include/omit operations for RO-Crate metadata + ignored.txt.
 *
 * This service is intended for reuse from multiple frontend components.
 * It updates ignored rules through {@link RoCrateIgnoredFilesService} and,
 * when metadata is loaded, updates `appState.roCrate` in-place.
 */
@injectable()
export class RoCrateDescriptionOperationsService {
  @inject(AppStateService)
  protected readonly appStateService: AppStateService

  @inject(WorkspaceService)
  protected readonly workspaceService: WorkspaceService

  @inject(FileSearchService)
  protected readonly fileSearchService: FileSearchService

  @inject(FileService)
  protected readonly fileService: FileService

  @inject(RoCrateIgnoredFilesService)
  protected readonly roCrateIgnoredFilesService: RoCrateIgnoredFilesService

  /**
   * Includes resources back into RO-Crate:
   * 1. Removes omit effect for selected resources in ignored.txt (via include/negation semantics)
   * 2. Recreates missing `Dataset`/`File` entities
   * 3. Rebuilds missing `hasPart` links
   *
   * Returns counters for what changed so callers can decide UI messaging.
   */
  async includeResources(
    resources: readonly RoCrateWorkspaceResource[],
  ): Promise<IncludeResourcesResult> {
    const normalizedResources = this.normalizeResources(resources)
    if (!normalizedResources.length) {
      return {
        metadataLoaded: false,
        addedFiles: 0,
        addedDatasets: 0,
        linkedReferences: 0,
      }
    }

    const ignoreEntries = normalizedResources.map((resource) =>
      resource.isDirectory ? `${resource.path}/` : resource.path,
    )
    await this.roCrateIgnoredFilesService.removeIgnoredPaths(ignoreEntries)

    const crate = this.appStateService.roCrate
    if (!crate || !Array.isArray(crate['@graph'])) {
      return {
        metadataLoaded: false,
        addedFiles: 0,
        addedDatasets: 0,
        linkedReferences: 0,
      }
    }

    const graph = this.cloneValue(crate['@graph']) as Record<string, any>[]
    const rootEntity = graph.find(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        typeof entry['@id'] === 'string' &&
        entry['@id'] === './',
    ) as Record<string, any> | undefined

    const inclusionPaths = await this.collectInclusionPaths(normalizedResources)
    const filePaths = [...inclusionPaths.filePaths]
    const directoryPaths = [...inclusionPaths.directoryPaths].sort((left, right) => {
      const depthDiff = this.countPathSegments(left) - this.countPathSegments(right)
      return depthDiff !== 0 ? depthDiff : left.localeCompare(right)
    })

    const datasetEntitiesByPath = new Map<string, Record<string, any>>()
    const fileEntityPaths = new Set<string>()
    for (const entry of graph) {
      if (!entry || typeof entry !== 'object') {
        continue
      }
      const entryId = typeof entry['@id'] === 'string' ? entry['@id'] : ''
      if (!entryId || entryId === './') {
        continue
      }

      const relativePath = this.deriveRelativePathFromEntityId(entryId)
      if (!relativePath) {
        continue
      }
      const normalizedPath = this.normalizeRelativePath(relativePath).toLowerCase()
      if (!normalizedPath) {
        continue
      }

      if (this.entityHasType(entry, 'Dataset')) {
        datasetEntitiesByPath.set(normalizedPath, entry)
      }
      if (this.entityHasType(entry, 'File')) {
        fileEntityPaths.add(normalizedPath)
      }
    }

    let addedFiles = 0
    let addedDatasets = 0
    let linkedReferences = 0

    for (const directoryPath of directoryPaths) {
      const normalizedPath = this.normalizeRelativePath(directoryPath).toLowerCase()
      if (!normalizedPath || datasetEntitiesByPath.has(normalizedPath)) {
        continue
      }
      const datasetEntity = this.buildDatasetEntity(directoryPath)
      graph.push(datasetEntity)
      datasetEntitiesByPath.set(normalizedPath, datasetEntity)
      addedDatasets += 1
    }

    for (const filePath of filePaths) {
      const normalizedPath = this.normalizeRelativePath(filePath).toLowerCase()
      if (!normalizedPath || fileEntityPaths.has(normalizedPath)) {
        continue
      }
      graph.push(await this.buildFileEntity(filePath))
      fileEntityPaths.add(normalizedPath)
      addedFiles += 1
    }

    for (const directoryPath of directoryPaths) {
      const normalizedPath = this.normalizeRelativePath(directoryPath).toLowerCase()
      if (!normalizedPath) {
        continue
      }
      const datasetEntity = datasetEntitiesByPath.get(normalizedPath)
      if (!datasetEntity) {
        continue
      }
      const datasetId =
        typeof datasetEntity['@id'] === 'string'
          ? datasetEntity['@id']
          : `${directoryPath}/`
      const parentContainer = this.resolveInclusionParentContainer(
        directoryPath,
        datasetEntitiesByPath,
        rootEntity,
      )
      if (!parentContainer || parentContainer === datasetEntity) {
        continue
      }
      if (this.ensureHasPartReference(parentContainer, datasetId)) {
        linkedReferences += 1
      }
    }

    for (const filePath of filePaths) {
      const parentContainer = this.resolveInclusionParentContainer(
        filePath,
        datasetEntitiesByPath,
        rootEntity,
      )
      if (!parentContainer) {
        continue
      }
      if (this.ensureHasPartReference(parentContainer, filePath)) {
        linkedReferences += 1
      }
    }

    const changed = addedFiles > 0 || addedDatasets > 0 || linkedReferences > 0
    if (changed) {
      const updatedCrate = { ...crate, '@graph': graph }
      this.appStateService.roCrate = updatedCrate
      this.appStateService.dirty = this.appStateService.isRoCrateDirty(updatedCrate)
    }

    return {
      metadataLoaded: true,
      addedFiles,
      addedDatasets,
      linkedReferences,
    }
  }

  /**
   * Read-only preflight helper for omit UX.
   *
   * Returns how many RO-Crate entities are currently paired with the provided resources.
   * Typical usage: show confirmation before removing metadata descriptions.
   */
  async getPairedDescriptionCount(
    resources: readonly RoCrateWorkspaceResource[],
  ): Promise<number> {
    const normalizedResources = this.normalizeResources(resources)
    if (!normalizedResources.length) {
      return 0
    }

    const crate = this.appStateService.roCrate
    if (!crate || !Array.isArray(crate['@graph'])) {
      return 0
    }

    const graph = crate['@graph'] as Record<string, any>[]
    return this.collectEntityIdsForResources(graph, normalizedResources).size
  }

  /**
   * Omits resources from RO-Crate scope:
   * 1. Marks resources omitted in ignored.txt
   * 2. Removes paired RO-Crate entities (`File`/`Dataset`) from `@graph`
   */
  async omitResources(
    resources: readonly RoCrateWorkspaceResource[],
  ): Promise<OmitResourcesResult> {
    const normalizedResources = this.normalizeResources(resources)
    if (!normalizedResources.length) {
      return {
        metadataLoaded: false,
        pairedDescriptionCount: 0,
        removedDescriptionCount: 0,
      }
    }

    const ignoreEntries = normalizedResources.map((resource) =>
      resource.isDirectory ? `${resource.path}/` : resource.path,
    )
    await this.roCrateIgnoredFilesService.addIgnoredPaths(ignoreEntries)

    const crate = this.appStateService.roCrate
    if (!crate || !Array.isArray(crate['@graph'])) {
      return {
        metadataLoaded: false,
        pairedDescriptionCount: 0,
        removedDescriptionCount: 0,
      }
    }

    const graph = this.cloneValue(crate['@graph']) as Record<string, any>[]
    const idsToRemove = this.collectEntityIdsForResources(graph, normalizedResources)
    const pairedDescriptionCount = idsToRemove.size
    if (!pairedDescriptionCount) {
      return {
        metadataLoaded: true,
        pairedDescriptionCount,
        removedDescriptionCount: 0,
      }
    }

    const updatedGraph = this.removeEntitiesAndReferences(graph, idsToRemove)
    const updatedCrate = { ...crate, '@graph': updatedGraph }
    this.appStateService.roCrate = updatedCrate
    this.appStateService.dirty = this.appStateService.isRoCrateDirty(updatedCrate)

    return {
      metadataLoaded: true,
      pairedDescriptionCount,
      removedDescriptionCount: pairedDescriptionCount,
    }
  }

  /**
   * Removes RO-Crate `File`/`Dataset` descriptions that are currently omitted by ignored.txt rules.
   *
   * Intended for external ignored.txt edits (for example from file editor / external tools),
   * so metadata views stay in sync with omit rules.
   */
  async syncIgnoredDescriptionsFromRules(): Promise<SyncIgnoredDescriptionsResult> {
    const crate = this.appStateService.roCrate
    if (!crate || !Array.isArray(crate['@graph'])) {
      return {
        metadataLoaded: false,
        matchedDescriptionCount: 0,
        removedDescriptionCount: 0,
      }
    }

    const graph = this.cloneValue(crate['@graph']) as Record<string, any>[]
    const idsToRemove = new Set<string>()
    for (const entry of graph) {
      if (!entry || typeof entry !== 'object') {
        continue
      }
      if (!this.entityHasType(entry, 'File') && !this.entityHasType(entry, 'Dataset')) {
        continue
      }

      const rawId = typeof entry['@id'] === 'string' ? entry['@id'] : ''
      if (!rawId) {
        continue
      }
      const relativePath = this.deriveRelativePathFromEntityId(rawId)
      if (!relativePath) {
        continue
      }
      const normalizedPath = this.normalizeRelativePath(relativePath).toLowerCase()
      if (!normalizedPath) {
        continue
      }
      if (this.roCrateIgnoredFilesService.isIgnoredPath(normalizedPath)) {
        idsToRemove.add(rawId)
      }
    }

    const matchedDescriptionCount = idsToRemove.size
    if (!matchedDescriptionCount) {
      return {
        metadataLoaded: true,
        matchedDescriptionCount: 0,
        removedDescriptionCount: 0,
      }
    }

    const updatedGraph = this.removeEntitiesAndReferences(graph, idsToRemove)
    const updatedCrate = { ...crate, '@graph': updatedGraph }
    this.appStateService.roCrate = updatedCrate
    this.appStateService.dirty = this.appStateService.isRoCrateDirty(updatedCrate)

    return {
      metadataLoaded: true,
      matchedDescriptionCount,
      removedDescriptionCount: matchedDescriptionCount,
    }
  }

  protected normalizeResources(
    resources: readonly RoCrateWorkspaceResource[],
  ): RoCrateWorkspaceResource[] {
    const seen = new Set<string>()
    const normalized: RoCrateWorkspaceResource[] = []

    for (const resource of resources) {
      const path = this.normalizeRelativePath(resource.path)
      if (!path || path === 'ro-crate-metadata.json') {
        continue
      }
      const key = `${path.toLowerCase()}${resource.isDirectory ? '/' : ''}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      normalized.push({
        path,
        isDirectory: resource.isDirectory,
        uri: resource.uri,
      })
    }

    return normalized
  }

  protected async collectInclusionPaths(
    resources: readonly RoCrateWorkspaceResource[],
  ): Promise<{ filePaths: Set<string>; directoryPaths: Set<string> }> {
    const filePaths = new Set<string>()
    const directoryPaths = new Set<string>()
    const rootUri = this.getPrimaryWorkspaceRootUri()

    for (const resource of resources) {
      const selectedPath = this.normalizeRelativePath(resource.path)
      if (!selectedPath) {
        continue
      }

      if (!resource.isDirectory) {
        filePaths.add(selectedPath)
        continue
      }

      directoryPaths.add(selectedPath)

      const scanRootUri = resource.uri ?? rootUri?.resolve(selectedPath)
      if (!scanRootUri) {
        continue
      }

      let fileUris: string[] = []
      try {
        fileUris = await this.fileSearchService.find('', {
          rootUris: [scanRootUri.toString()],
        })
      } catch (error) {
        console.warn(
          'Failed to resolve selected directory files for include operation:',
          error,
        )
        continue
      }

      for (const fileUri of fileUris) {
        const relative = this.getWorkspaceRelativePath(new URI(fileUri))
        if (!relative) {
          continue
        }
        const normalized = this.normalizeRelativePath(relative)
        if (!normalized || normalized === 'ro-crate-metadata.json') {
          continue
        }
        filePaths.add(normalized)

        const parentDirectories = this.collectParentDirectories(normalized)
        for (const directoryPath of parentDirectories) {
          if (
            directoryPath === selectedPath ||
            directoryPath.startsWith(`${selectedPath}/`)
          ) {
            directoryPaths.add(directoryPath)
          }
        }
      }
    }

    return { filePaths, directoryPaths }
  }

  protected collectParentDirectories(path: string): string[] {
    const normalized = this.normalizeRelativePath(path)
    if (!normalized) {
      return []
    }
    const segments = normalized.split('/').filter(Boolean)
    if (segments.length < 2) {
      return []
    }

    const directories: string[] = []
    for (let index = 1; index < segments.length; index += 1) {
      directories.push(segments.slice(0, index).join('/'))
    }
    return directories
  }

  protected countPathSegments(path: string): number {
    const normalized = this.normalizeRelativePath(path)
    if (!normalized) {
      return 0
    }
    return normalized.split('/').filter(Boolean).length
  }

  protected resolveInclusionParentContainer(
    path: string,
    datasetEntitiesByPath: Map<string, Record<string, any>>,
    rootEntity: Record<string, any> | undefined,
  ): Record<string, any> | undefined {
    const normalizedPath = this.normalizeRelativePath(path)
    if (!normalizedPath) {
      return rootEntity
    }
    const parentPath = this.getParentPath(normalizedPath)
    if (!parentPath) {
      return rootEntity
    }

    const normalizedParentPath = this.normalizeRelativePath(parentPath).toLowerCase()
    if (!normalizedParentPath) {
      return rootEntity
    }
    if (this.roCrateIgnoredFilesService.isIgnoredPath(normalizedParentPath)) {
      return rootEntity
    }

    return datasetEntitiesByPath.get(normalizedParentPath) ?? rootEntity
  }

  protected getParentPath(path: string): string | undefined {
    const normalized = this.normalizeRelativePath(path)
    if (!normalized) {
      return undefined
    }
    const lastSeparatorIndex = normalized.lastIndexOf('/')
    if (lastSeparatorIndex === -1) {
      return undefined
    }
    return normalized.slice(0, lastSeparatorIndex)
  }

  protected ensureHasPartReference(entity: Record<string, any>, childId: string): boolean {
    const hasPart = this.normalizeHasPart(entity.hasPart)
    if (hasPart.some((reference) => reference['@id'] === childId)) {
      return false
    }
    hasPart.push({ '@id': childId })
    entity.hasPart = hasPart
    return true
  }

  protected collectEntityIdsForResources(
    graph: ReadonlyArray<Record<string, any>>,
    resources: ReadonlyArray<RoCrateWorkspaceResource>,
  ): Set<string> {
    const idsToRemove = new Set<string>()
    const normalizedResources = resources.map((resource) => ({
      path: this.normalizeRelativePath(resource.path).toLowerCase(),
      isDirectory: resource.isDirectory,
    }))

    for (const entry of graph) {
      if (!entry || typeof entry !== 'object') {
        continue
      }
      if (!this.entityHasType(entry, 'File') && !this.entityHasType(entry, 'Dataset')) {
        continue
      }
      const rawId = typeof entry['@id'] === 'string' ? entry['@id'] : ''
      if (!rawId) {
        continue
      }
      const derivedPath = this.deriveRelativePathFromEntityId(rawId)
      if (!derivedPath) {
        continue
      }
      const normalizedPath = this.normalizeRelativePath(derivedPath).toLowerCase()
      if (!normalizedPath) {
        continue
      }

      for (const resource of normalizedResources) {
        if (!resource.path) {
          continue
        }
        if (resource.isDirectory) {
          if (
            normalizedPath === resource.path ||
            normalizedPath.startsWith(`${resource.path}/`)
          ) {
            idsToRemove.add(rawId)
            break
          }
        } else if (normalizedPath === resource.path) {
          idsToRemove.add(rawId)
          break
        }
      }
    }

    return idsToRemove
  }

  protected removeEntitiesAndReferences(
    graph: ReadonlyArray<Record<string, any>>,
    idsToRemove: Set<string>,
  ): Record<string, any>[] {
    const filtered = graph.filter((entry) => {
      const id = typeof entry?.['@id'] === 'string' ? entry['@id'] : ''
      return !idsToRemove.has(id)
    })

    const cleaned: Record<string, any>[] = []
    for (const entity of filtered) {
      const normalized = this.removeReferencesFromValue(entity, idsToRemove)
      if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
        cleaned.push(normalized as Record<string, any>)
      }
    }
    return cleaned
  }

  protected removeReferencesFromValue(value: unknown, idsToRemove: Set<string>): unknown {
    if (Array.isArray(value)) {
      return value
        .map((item) => this.removeReferencesFromValue(item, idsToRemove))
        .filter((item) => item !== undefined)
    }

    if (value && typeof value === 'object') {
      const objectValue = value as Record<string, unknown>
      const referenceId = this.extractReferenceId(objectValue)
      if (referenceId && idsToRemove.has(referenceId) && this.isReferenceObject(objectValue)) {
        return undefined
      }

      const nextObject: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(objectValue)) {
        const normalized = this.removeReferencesFromValue(child, idsToRemove)
        if (normalized === undefined) {
          continue
        }
        if (Array.isArray(normalized) && normalized.length === 0) {
          continue
        }
        nextObject[key] = normalized
      }
      return nextObject
    }

    return value
  }

  protected extractReferenceId(value: Record<string, unknown>): string | undefined {
    const idValue = value['@id'] ?? value.id
    return typeof idValue === 'string' ? idValue : undefined
  }

  protected isReferenceObject(value: Record<string, unknown>): boolean {
    const keys = Object.keys(value)
    return keys.length === 1 && (keys[0] === '@id' || keys[0] === 'id')
  }

  protected async buildFileEntity(relativePath: string): Promise<Record<string, any>> {
    const name = relativePath.split('/').pop() ?? relativePath
    const fileEntity: Record<string, any> = {
      '@id': relativePath,
      '@type': 'File',
      name,
    }

    const rootUri = this.getPrimaryWorkspaceRootUri()
    if (!rootUri) {
      return fileEntity
    }

    try {
      const fileUri = rootUri.resolve(relativePath)
      const fileStat = await this.fileService.resolve(fileUri, { resolveMetadata: true })
      if (!fileStat.isDirectory && typeof fileStat.size === 'number' && fileStat.size >= 0) {
        fileEntity.contentSize = `${fileStat.size}`
      }
    } catch (error) {
      console.warn(
        `Failed to read file size for "${relativePath}" while including into RO-Crate:`,
        error,
      )
    }

    return fileEntity
  }

  protected buildDatasetEntity(relativePath: string): Record<string, any> {
    const normalizedPath = this.normalizeRelativePath(relativePath)
    const name = normalizedPath.split('/').pop() ?? normalizedPath
    return {
      '@id': `${normalizedPath}/`,
      '@type': 'Dataset',
      name,
      hasPart: [],
    }
  }

  protected normalizeHasPart(value: unknown): Array<{ '@id': string }> {
    if (!value) {
      return []
    }
    const raw = Array.isArray(value) ? value : [value]
    const normalized: Array<{ '@id': string }> = []
    for (const entry of raw) {
      if (!entry) {
        continue
      }
      if (typeof entry === 'string') {
        normalized.push({ '@id': entry })
        continue
      }
      if (typeof entry === 'object') {
        const id = (entry as Record<string, any>)['@id'] ?? (entry as Record<string, any>).id
        if (typeof id === 'string') {
          normalized.push({ '@id': id })
        }
      }
    }
    return normalized
  }

  protected entityHasType(entity: Record<string, any>, type: string): boolean {
    const rawType = entity['@type']
    if (Array.isArray(rawType)) {
      return rawType.includes(type)
    }
    return rawType === type
  }

  protected deriveRelativePathFromEntityId(entityId: string): string | undefined {
    let candidate = entityId.trim()
    if (!candidate) {
      return undefined
    }

    if (candidate.startsWith('file://./')) {
      candidate = candidate.slice('file://./'.length)
    } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
      return undefined
    }

    if (candidate.startsWith('./')) {
      candidate = candidate.slice(2)
    }

    return this.normalizeRelativePath(candidate) || undefined
  }

  protected getWorkspaceRelativePath(uri: URI): string | undefined {
    const rootUri = this.workspaceService.getWorkspaceRootUri(uri)
    if (!rootUri) {
      return undefined
    }
    const relative = rootUri.relative(uri)
    if (!relative) {
      return undefined
    }
    const normalized = this.normalizeRelativePath(relative.toString())
    return normalized || undefined
  }

  protected normalizeRelativePath(path: string): string {
    let normalized = (path || '').replace(/\\/g, '/').trim()
    normalized = normalized.replace(/^\.?\//, '')
    normalized = normalized.replace(/^\/+/, '')
    normalized = normalized.replace(/\/{2,}/g, '/')
    while (normalized.endsWith('/') && normalized.length > 1) {
      normalized = normalized.slice(0, -1)
    }
    return normalized
  }

  protected getPrimaryWorkspaceRootUri(): URI | undefined {
    const roots = this.workspaceService.tryGetRoots()
    return roots && roots.length > 0 ? roots[0].resource : undefined
  }

  protected cloneValue<T>(value: T): T {
    try {
      return JSON.parse(JSON.stringify(value))
    } catch {
      return value
    }
  }
}

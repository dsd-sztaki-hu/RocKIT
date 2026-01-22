import { CommonMenus } from '@theia/core/lib/browser'
import {
  Command,
  CommandContribution,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
  MessageService,
} from '@theia/core/lib/common'
import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import { inject, injectable } from '@theia/core/shared/inversify'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'

export const RemoteRoCrateConversionCommand: Command = {
  id: 'RemoteRoCrateConversion.command',
  label: 'ROC Remote to Locale Conversion',
}

type EntityKind = 'File' | 'Dataset' | 'CreativeWork' | 'Other'

@injectable()
export class RemoteRoCrateConversionCommandContribution implements CommandContribution {
  @inject(MessageService)
  protected readonly messageService!: MessageService

  @inject(WorkspaceService)
  protected readonly workspaceService!: WorkspaceService

  @inject(FileService)
  protected readonly fileService!: FileService

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(RemoteRoCrateConversionCommand, {
      execute: () => this.convertInWorkspaceRoot(),
    })
  }

  private async convertInWorkspaceRoot(): Promise<void> {
    const roots = await this.workspaceService.roots
    const root = roots?.[0]
    if (!root) {
      this.messageService.error(
        'No workspace folder is open. Open a RO-Crate folder first.',
      )
      return
    }

    const metadataUri = root.resource.resolve('ro-crate-metadata.json')
    const exists = await this.fileService.exists(metadataUri)
    if (!exists) {
      this.messageService.error(
        `Could not find ro-crate-metadata.json in workspace root: ${root.resource.toString()}`,
      )
      return
    }

    let json: any
    try {
      const stat = await this.fileService.readFile(metadataUri)
      json = JSON.parse(stat.value.toString())
    } catch (e) {
      this.messageService.error(
        `Failed to read/parse ro-crate-metadata.json: ${String(e)}`,
      )
      return
    }

    const graph = Array.isArray(json?.['@graph']) ? json['@graph'] : []
    if (!Array.isArray(graph) || graph.length === 0) {
      this.messageService.error('ro-crate-metadata.json has no @graph array to convert.')
      return
    }

    // PASS 1: build oldId -> newId mapping (so we can update references everywhere)
    const idMap = new Map<string, string>()
    let skippedRootDataset = 0
    let skippedNoId = 0
    let skippedNonConvertibleType = 0
    let skippedCouldNotDerivePath = 0

    for (const entry of graph) {
      if (!entry || typeof entry !== 'object') continue

      const oldId = entry['@id']
      if (typeof oldId !== 'string' || !oldId.trim()) {
        skippedNoId++
        continue
      }

      const oldIdTrim = oldId.trim()

      // Skip ONLY the RO-Crate root dataset
      if (oldIdTrim === './') {
        skippedRootDataset++
        continue
      }

      const kind = this.getEntityKind(entry)
      if (kind === 'Other') {
        skippedNonConvertibleType++
        continue
      }

      const relPath =
        this.computeRelativePathFromDirectoryLabelAndName(entry) ??
        this.deriveRelativePathFromOldId(oldIdTrim)

      if (!relPath) {
        skippedCouldNotDerivePath++
        continue
      }

      const newId = `file://./${relPath}`
      idMap.set(oldIdTrim, newId)
    }

    if (idMap.size === 0) {
      this.messageService.info(
        `No entities were eligible for conversion. (Skipped root dataset: ${skippedRootDataset}, missing @id: ${skippedNoId}, non-convertible type: ${skippedNonConvertibleType}, could-not-derive-path: ${skippedCouldNotDerivePath})`,
      )
      return
    }

    // PASS 2: apply changes to entities themselves (+ url rules)
    let changedEntities = 0
    let datasetsSkippedUrlMove = 0

    for (const entry of graph) {
      if (!entry || typeof entry !== 'object') continue

      const oldId = entry['@id']
      if (typeof oldId !== 'string' || !oldId.trim()) continue

      const oldIdTrim = oldId.trim()
      if (oldIdTrim === './') continue

      const newId = idMap.get(oldIdTrim)
      if (!newId) continue

      const kind = this.getEntityKind(entry)

      // For File + CreativeWork: move old @id into url
      // For Dataset: DO NOT move the old id into url (per your requirement)
      if (kind === 'File' || kind === 'CreativeWork') {
        this.pushIntoUrl(entry, oldIdTrim)
      } else if (kind === 'Dataset') {
        datasetsSkippedUrlMove++
      }

      entry['@id'] = newId
      changedEntities++
    }

    // PASS 3: update all references in the whole document where an object has { "@id": "<old>" }
    // (e.g. hasPart, mentions, about, conformsTo, etc.)
    this.replaceIdReferencesDeep(json, idMap)

    // Write back
    try {
      const pretty = JSON.stringify(json, null, 2) + '\n'
      await this.fileService.writeFile(metadataUri, BinaryBuffer.fromString(pretty))
      this.messageService.info(
        `Converted ${changedEntities} entities and updated references. (Datasets kept local @id out of url: ${datasetsSkippedUrlMove})`,
      )
    } catch (e) {
      this.messageService.error(`Failed to write ro-crate-metadata.json: ${String(e)}`)
    }
  }

  /**
   * Only convert entities of type File / Dataset / CreativeWork
   * (ro-crate-metadata.json is often CreativeWork)
   */
  private getEntityKind(entry: Record<string, any>): EntityKind {
    const t = entry['@type']
    const types: string[] =
      typeof t === 'string'
        ? [t]
        : Array.isArray(t)
          ? t.filter((x) => typeof x === 'string')
          : []

    if (types.includes('File')) return 'File'
    if (types.includes('Dataset')) return 'Dataset'
    if (types.includes('CreativeWork')) return 'CreativeWork'
    return 'Other'
  }

  /**
   * Preferred path source: directoryLabel + name
   * - If directoryLabel missing, uses name only.
   * - Keeps trailing "/" if name has it.
   */
  private computeRelativePathFromDirectoryLabelAndName(
    entry: Record<string, any>,
  ): string | undefined {
    const directoryLabel =
      typeof entry['directoryLabel'] === 'string' ? entry['directoryLabel'].trim() : ''
    const name = typeof entry['name'] === 'string' ? entry['name'].trim() : ''

    if (!name) return undefined

    if (!directoryLabel) return this.normalizeRelPath(name)

    const dirNoTrail = directoryLabel.endsWith('/')
      ? directoryLabel.slice(0, -1)
      : directoryLabel
    const nameNoLead = name.startsWith('/') ? name.slice(1) : name

    return this.normalizeRelPath(`${dirNoTrail}/${nameNoLead}`)
  }

  /**
   * Fallback: derive relative path from old @id
   * Handles:
   * - "elsokonyvtar/"
   * - "./path/file.txt"
   * - "file://./path/file.txt"
   */
  private deriveRelativePathFromOldId(oldIdRaw: string): string | undefined {
    const oldId = oldIdRaw.trim()
    if (!oldId) return undefined

    let s = oldId

    if (s.startsWith('file://./')) s = s.slice('file://./'.length)
    else if (s.startsWith('file://')) s = s.slice('file://'.length)

    if (s.startsWith('./')) s = s.slice(2)

    s = s.trim()
    if (!s) return undefined

    return this.normalizeRelPath(s)
  }

  private normalizeRelPath(p: string): string {
    let s = p.replace(/\\/g, '/').trim()
    while (s.startsWith('/')) s = s.slice(1)
    s = s.replace(/\/{2,}/g, '/')
    return s
  }

  /**
   * Moves old @id into url:
   * - url missing/empty => url = oldId
   * - url string => url = [url, oldId] (unless identical)
   * - url array => push if not present
   */
  private pushIntoUrl(entry: Record<string, any>, oldId: string): void {
    const current = entry['url']

    if (current === undefined || current === null || current === '') {
      entry['url'] = oldId
      return
    }

    if (typeof current === 'string') {
      if (current === oldId) return
      entry['url'] = [current, oldId]
      return
    }

    if (Array.isArray(current)) {
      if (!current.includes(oldId)) current.push(oldId)
      entry['url'] = current
      return
    }

    entry['url'] = [current, oldId]
  }

  /**
   * Deeply traverse the whole RO-Crate JSON and replace any object property
   * that is literally "@id": "<oldId>" with the mapped new id.
   *
   * This ensures relations like hasPart/about/mentions/etc. remain valid.
   */
  private replaceIdReferencesDeep(node: unknown, idMap: Map<string, string>): void {
    if (!node) return

    if (Array.isArray(node)) {
      for (const item of node) {
        this.replaceIdReferencesDeep(item, idMap)
      }
      return
    }

    if (typeof node !== 'object') return

    const obj = node as Record<string, unknown>

    // Replace this object's @id if it points to an old id
    const idVal = obj['@id']
    if (typeof idVal === 'string') {
      const mapped = idMap.get(idVal.trim())
      if (mapped) {
        obj['@id'] = mapped
      }
    }

    // Recurse into all properties (including hasPart, @reverse, etc.)
    for (const key of Object.keys(obj)) {
      const value = obj[key]
      // Avoid infinite loops (shouldn't happen in JSON, but safe anyway)
      if (value && typeof value === 'object') {
        this.replaceIdReferencesDeep(value, idMap)
      } else if (Array.isArray(value)) {
        this.replaceIdReferencesDeep(value, idMap)
      }
    }
  }
}

@injectable()
export class RemoteRoCrateConversionMenuContribution implements MenuContribution {
  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.FILE, {
      commandId: RemoteRoCrateConversionCommand.id,
      label: RemoteRoCrateConversionCommand.label,
    })
  }
}

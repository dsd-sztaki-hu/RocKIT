import { CommonCommands, CommonMenus } from '@theia/core/lib/browser'
import {
  Command,
  CommandContribution,
  CommandRegistry,
  CommandService,
  MenuContribution,
  MenuModelRegistry,
  MessageService,
  nls,
} from '@theia/core/lib/common'
import { URI } from '@theia/core/lib/common/uri'
import { inject, injectable } from '@theia/core/shared/inversify'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateHistoryService } from 'app-state/lib/browser/state/ro-crate-history-service'
import { writeUtf8TextFile } from 'rockit-common/lib/browser'

export const RemoteRoCrateConversionCommand: Command = {
  id: 'RemoteRoCrateConversion.command',
  label: nls.localize(
    'rockit/remoteConversion/title',
    'Convert Remote RO-Crate IDs to Local IDs',
  ),
}

type EntityKind = 'File' | 'Dataset' | 'Other'
type RoCrateEntityIdMapping = Record<string, string>

interface ExportLogEntry {
  target: string
  repository: string
  mappingFile: string
  syncType: 'create' | 'update'
  syncedAt: string
  datasetName?: string
}

const EXPORT_LOG_FILE_NAME = 'export-log.json'
const ARP_PRODUCTION_REPOSITORY_URL = 'https://repo.researchdata.hu'
const ARP_DEV_REPOSITORY_URL = 'https://dsddev.concorda.sztaki.hu'

@injectable()
export class RemoteRoCrateConversionCommandContribution implements CommandContribution {
  @inject(MessageService)
  protected readonly messageService!: MessageService

  @inject(WorkspaceService)
  protected readonly workspaceService!: WorkspaceService

  @inject(FileService)
  protected readonly fileService!: FileService

  @inject(CommandService)
  protected readonly commandService!: CommandService

  @inject(AppStateService)
  protected readonly appStateService!: AppStateService

  @inject(RoCrateHistoryService)
  protected readonly roCrateHistoryService!: RoCrateHistoryService

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(RemoteRoCrateConversionCommand, {
      execute: () => this.convertInWorkspaceRoot(),
    })
  }

  private async convertInWorkspaceRoot(): Promise<void> {
    // Run the Save ALl command first, so that all files are saved to disk.
    await this.commandService.executeCommand(CommonCommands.SAVE_ALL.id)

    const roots = await this.workspaceService.roots
    const root = roots?.[0]
    if (!root) {
      this.messageService.error(
        nls.localize(
          'rockit/remoteConversion/noWorkspace',
          'No workspace folder is open. Open a RO-Crate folder first.',
        ),
      )
      return
    }

    const metadataUri = root.resource.resolve('ro-crate-metadata.json')
    const exists = await this.fileService.exists(metadataUri)
    if (!exists) {
      this.messageService.error(
        nls.localize(
          'rockit/remoteConversion/metadataNotFound',
          'Could not find ro-crate-metadata.json in workspace root: {0}',
          root.resource.toString(),
        ),
      )
      return
    }

    let json: any
    try {
      const stat = await this.fileService.readFile(metadataUri)
      json = JSON.parse(stat.value.toString())
    } catch (e) {
      this.messageService.error(
        nls.localize(
          'rockit/remoteConversion/readFailed',
          'Failed to read/parse ro-crate-metadata.json: {0}',
          String(e),
        ),
      )
      return
    }

    const graph = Array.isArray(json?.['@graph']) ? json['@graph'] : []
    if (!Array.isArray(graph) || graph.length === 0) {
      this.messageService.error(nls.localize(
        'rockit/remoteConversion/noGraph',
        'ro-crate-metadata.json has no @graph array to convert.',
      ))
      return
    }

    const arpPid = this.getRootArpPid(json)
    if (!arpPid) {
      this.messageService.info(
        nls.localize(
          'rockit/remoteConversion/arpOnly',
          'ID localization is only supported for ARP Data Repository RO-Crates.',
        ),
      )
      return
    }

    // PASS 1: build oldId -> newId mapping (so we can update references everywhere)
    const idMap = new Map<string, string>()
    const nextIds = new Set<string>()
    let skippedRootDataset = 0
    let skippedNoId = 0
    let skippedNonConvertibleType = 0
    let skippedNonLocalEntity = 0
    let skippedMissingName = 0

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

      if (!this.isArpLocalEntityId(oldIdTrim, arpPid)) {
        skippedNonLocalEntity++
        continue
      }

      const relPath = this.computeRelativePathFromDirectoryLabelAndName(entry)

      if (!relPath) {
        skippedMissingName++
        continue
      }

      const newId = relPath
      const conflictingEntry = graph.find((candidate) => {
        if (!candidate || typeof candidate !== 'object') {
          return false
        }
        const candidateId =
          typeof candidate['@id'] === 'string' ? candidate['@id'].trim() : ''
        if (!candidateId || candidateId === oldIdTrim) {
          return false
        }
        if (idMap.has(candidateId)) {
          return false
        }
        return candidateId === newId
      })

      if (nextIds.has(newId) || conflictingEntry) {
        this.messageService.error(
          nls.localize(
            'rockit/remoteConversion/nonUniquePath',
            "ID localization cannot continue because the generated local path '{0}' would not be unique.",
            newId,
          ),
        )
        return
      }

      nextIds.add(newId)
      idMap.set(oldIdTrim, newId)
    }

    if (idMap.size === 0) {
      this.messageService.info(
        nls.localize(
          'rockit/remoteConversion/nothingEligible',
          'No entities were eligible for conversion. (Skipped root dataset: {0}, missing @id: {1}, non-convertible type: {2}, non-local ID: {3}, missing name/path metadata: {4})',
          skippedRootDataset,
          skippedNoId,
          skippedNonConvertibleType,
          skippedNonLocalEntity,
          skippedMissingName,
        ),
      )
      return
    }

    // PASS 2: apply changes to entities themselves and build export/update mapping.
    let changedEntities = 0
    const entityIdMapping: RoCrateEntityIdMapping = {}

    for (const entry of graph) {
      if (!entry || typeof entry !== 'object') continue

      const oldId = entry['@id']
      if (typeof oldId !== 'string' || !oldId.trim()) continue

      const oldIdTrim = oldId.trim()
      if (oldIdTrim === './') continue

      const newId = idMap.get(oldIdTrim)
      if (!newId) continue

      const kind = this.getEntityKind(entry)
      if (kind === 'File') {
        entityIdMapping[newId] = oldIdTrim
      }

      entry['@id'] = newId
      changedEntities++
    }

    // PASS 3: update all references in the whole document where an object has { "@id": "<old>" }
    // (e.g. hasPart, mentions, about, conformsTo, etc.)
    this.replaceIdReferencesDeep(json, idMap)

    // Write back
    try {
      const mappingFileName = await this.persistExportState(
        root.resource,
        json,
        arpPid,
        entityIdMapping,
      )
      const pretty = JSON.stringify(json, null, 2) + '\n'
      await writeUtf8TextFile(this.fileService, metadataUri, pretty)
      this.roCrateHistoryService.applyRoCrateChange(json, {
        label: nls.localize(
          'rockit/remoteConversion/historyLabel',
          'Convert remote RO-Crate IDs to local IDs',
        ),
      })
      await this.messageService.info(
        nls.localize(
          'rockit/remoteConversion/completed',
          'Converted {0} entities and updated references. Stored {1} ARP file mapping(s) in .rockit/{2}.',
          changedEntities,
          Object.keys(entityIdMapping).length,
          mappingFileName,
        ),
      )
    } catch (e) {
      this.messageService.error(nls.localize(
        'rockit/remoteConversion/writeFailed',
        'Failed to write ro-crate-metadata.json: {0}',
        String(e),
      ))
    }
  }

  /**
   * Only convert entities of type File / Dataset.
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
    return 'Other'
  }

  private getRootArpPid(crate: Record<string, any>): string | undefined {
    const rootDataset = this.getRootDataset(crate)
    const arpPid =
      rootDataset && typeof rootDataset['@arpPid'] === 'string'
        ? rootDataset['@arpPid'].trim()
        : ''
    return arpPid || undefined
  }

  private isArpLocalEntityId(id: string, arpPid: string): boolean {
    const trimmedId = id.trim()
    if (!trimmedId || !arpPid) {
      return false
    }

    const prefixes = [
      `https://w3id.org/arp/ro-id/${arpPid}/file/`,
      `https://w3id.org/arp/dev/ro-id/${arpPid}/file/`,
    ]
    return prefixes.some((prefix) => trimmedId.startsWith(prefix) && trimmedId.length > prefix.length)
  }

  private getRootDataset(crate: Record<string, any>): Record<string, any> | undefined {
    const graph = Array.isArray(crate?.['@graph']) ? crate['@graph'] : []
    return graph.find((entry) => {
      if (!entry || typeof entry !== 'object') {
        return false
      }

      const id = typeof entry['@id'] === 'string' ? entry['@id'].trim() : ''
      const rawType = entry['@type']
      const types: string[] =
        typeof rawType === 'string'
          ? [rawType]
          : Array.isArray(rawType)
            ? rawType.filter((x): x is string => typeof x === 'string')
            : []

      return (id === './' || id === '.') && types.includes('Dataset')
    })
  }

  /**
   * Localized path source: directoryLabel + "/" + name, or name only.
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

  private normalizeRelPath(p: string): string {
    let s = p.replace(/\\/g, '/').trim()
    while (s.startsWith('/')) s = s.slice(1)
    s = s.replace(/\/{2,}/g, '/')
    return s
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

  private async persistExportState(
    rootUri: URI,
    crate: Record<string, any>,
    arpPid: string,
    mapping: RoCrateEntityIdMapping,
  ): Promise<string> {
    const mappingFileName = await this.createUniqueMappingFileName(rootUri)
    await this.saveEntityIdMapping(rootUri, mappingFileName, mapping)
    await this.appendExportLog(rootUri, {
      target: this.buildDatasetPidTarget(arpPid),
      repository: this.inferRepositoryUrl(crate, arpPid),
      mappingFile: mappingFileName,
      syncType: 'update',
      syncedAt: new Date().toISOString(),
      datasetName: this.getRootDatasetName(crate),
    })
    return mappingFileName
  }

  private async createUniqueMappingFileName(rootUri: URI): Promise<string> {
    const rockitUri = rootUri.resolve('.rockit')
    await this.ensureFolder(rockitUri)
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const fileName = `${this.randomId(16)}.json`
      if (!(await this.fileService.exists(rockitUri.resolve(fileName)))) {
        return fileName
      }
    }
    return `${Date.now()}-${this.randomId(16)}.json`
  }

  private async saveEntityIdMapping(
    rootUri: URI,
    mappingFileName: string,
    mapping: RoCrateEntityIdMapping,
  ): Promise<void> {
    const rockitUri = rootUri.resolve('.rockit')
    await this.ensureFolder(rockitUri)
    await writeUtf8TextFile(
      this.fileService,
      rockitUri.resolve(mappingFileName),
      `${JSON.stringify(this.sortObject(mapping), null, 2)}\n`,
    )
  }

  private async appendExportLog(rootUri: URI, entry: ExportLogEntry): Promise<void> {
    const rockitUri = rootUri.resolve('.rockit')
    await this.ensureFolder(rockitUri)
    const historyUri = rockitUri.resolve(EXPORT_LOG_FILE_NAME)
    const entries = await this.readExportLogEntries(historyUri)
    const entryPid = this.normalizePid(entry.target)
    const repository = this.normalizeBaseUrl(entry.repository)
    const existingIndex = entries.findIndex(
      (existing) =>
        this.normalizeBaseUrl(existing.repository) === repository &&
        this.normalizePid(existing.target) === entryPid,
    )
    const nextEntries = [...entries]
    if (existingIndex >= 0) {
      nextEntries[existingIndex] = entry
    } else {
      nextEntries.push(entry)
    }
    await writeUtf8TextFile(
      this.fileService,
      historyUri,
      `${JSON.stringify(nextEntries, null, 2)}\n`,
    )
  }

  private async readExportLogEntries(historyUri: URI): Promise<ExportLogEntry[]> {
    if (!(await this.fileService.exists(historyUri))) {
      return []
    }
    try {
      const parsed = JSON.parse((await this.fileService.readFile(historyUri)).value.toString())
      return Array.isArray(parsed)
        ? parsed.filter(
            (entry): entry is ExportLogEntry =>
              !!entry && typeof entry === 'object' && !Array.isArray(entry),
          )
        : []
    } catch (error) {
      console.warn('Failed to parse .rockit/export-log.json; starting a new export log.', error)
      return []
    }
  }

  private async ensureFolder(uri: URI): Promise<void> {
    if (await this.fileService.exists(uri)) {
      return
    }
    const parent = uri.parent
    if (parent.toString() !== uri.toString() && !(await this.fileService.exists(parent))) {
      await this.ensureFolder(parent)
    }
    await this.fileService.createFolder(uri)
  }

  private inferRepositoryUrl(crate: Record<string, any>, arpPid: string): string {
    const ids = this.readGraphEntities(crate)
      .map((entry) => (typeof entry['@id'] === 'string' ? entry['@id'].trim() : ''))
      .filter((id) => id.includes(`/ro-id/${arpPid}/`))
    if (ids.some((id) => id.startsWith(`https://w3id.org/arp/dev/ro-id/${arpPid}/`))) {
      return ARP_DEV_REPOSITORY_URL
    }
    return ARP_PRODUCTION_REPOSITORY_URL
  }

  private buildDatasetPidTarget(pid: string): string {
    const trimmed = pid.trim()
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed
    }
    if (/^hdl:/i.test(trimmed)) {
      return `https://hdl.handle.net/${trimmed.slice('hdl:'.length)}`
    }
    return trimmed
  }

  private normalizePid(value: string): string {
    const extracted = this.extractDatasetPid(value) ?? value
    return extracted.replace(/^hdl:/i, '').replace(/^\/+/, '').toLowerCase()
  }

  private extractDatasetPid(value: string): string | undefined {
    let trimmed = value.trim()
    try {
      trimmed = decodeURIComponent(trimmed)
    } catch {
      // Keep original value.
    }
    const handleMatch = trimmed.match(/hdl\.handle\.net\/(.+)$/i)
    if (handleMatch) {
      return `hdl:${handleMatch[1]}`
    }
    if (/^hdl:/i.test(trimmed)) {
      return trimmed
    }
    try {
      const persistentId = new URL(trimmed).searchParams.get('persistentId')
      return persistentId?.trim() || undefined
    } catch {
      return undefined
    }
  }

  private getRootDatasetName(crate: Record<string, any>): string | undefined {
    const root = this.getRootDataset(crate)
    if (!root) {
      return undefined
    }
    return this.readOptionalString(root.title) ?? this.readOptionalString(root.name)
  }

  private readOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  }

  private readGraphEntities(crate: Record<string, any>): Record<string, any>[] {
    const graph = crate['@graph']
    return Array.isArray(graph)
      ? graph.filter(
          (entry): entry is Record<string, any> =>
            !!entry && typeof entry === 'object' && !Array.isArray(entry),
        )
      : []
  }

  private normalizeBaseUrl(baseUrl: string): string {
    const normalized = baseUrl.trim().replace(/\/+$/, '')
    return normalized.endsWith('/api/v1') ? normalized.slice(0, -'/api/v1'.length) : normalized
  }

  private sortObject<T extends Record<string, string>>(value: T): T {
    return Object.fromEntries(
      Object.entries(value).sort((a, b) => a[0].localeCompare(b[0])),
    ) as T
  }

  private randomId(length: number): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const bytes = new Uint8Array(length)
    window.crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
  }
}

@injectable()
export class RemoteRoCrateConversionMenuContribution implements MenuContribution {
  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction([...CommonMenus.EDIT, '9_remote_ro_crate_conversion'], {
      commandId: RemoteRoCrateConversionCommand.id,
      label: RemoteRoCrateConversionCommand.label,
      order: 'zzzz',
    })
  }
}

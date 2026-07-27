import JSZip = require('jszip')

import { CommonMenus } from '@theia/core/lib/browser'
import {
  Command,
  CommandContribution,
  CommandRegistry,
  CommandService,
  MenuContribution,
  MenuModelRegistry,
  MessageService,
  nls,
  URI,
} from '@theia/core/lib/common'
import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import { FileUri } from '@theia/core/lib/common/file-uri'
import { inject, injectable } from '@theia/core/shared/inversify'
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { FileDownloadService } from '@theia/filesystem/lib/common/download/file-download'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { minimatch, MinimatchOptions } from 'minimatch'
import { collectRoCrateExportFileReferences } from 'rockit-common/lib/common/ro-crate-export-file-references'
import type { RoCrateExportFileSource } from 'rockit-common/lib/common/ro-crate-export-file-references'
import {
  ROCKIT_IGNORE_DIR,
  ROCKIT_IGNORE_FILE,
  DEFAULT_IGNORED_ENTRIES as SHARED_DEFAULT_IGNORED_ENTRIES,
} from 'rockit-common/lib/common/ro-crate-technical-files'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import {
  ExportRoCrateDialog,
  ExportRoCrateMode,
  ExportRoCrateOptions,
} from './export-ro-crate-dialog'

export const ExportRoCrateCommand: Command = {
  id: 'ExportRoCrate.command',
  label: nls.localize('rockit/exportRoCrate/title', 'Export RO-Crate'),
}

interface IgnoreRule {
  negated: boolean
  pattern: string
  directoryOnly: boolean
  isGlob: boolean
}

@injectable()
export class ExportRoCrateCommandContribution implements CommandContribution {
  protected static readonly IGNORE_DIR = ROCKIT_IGNORE_DIR
  protected static readonly IGNORE_FILE = ROCKIT_IGNORE_FILE
  protected static readonly DEFAULT_IGNORED_ENTRIES = SHARED_DEFAULT_IGNORED_ENTRIES
  protected static readonly FORCED_NORMAL_EXPORT_FILES = new Set([
    'ro-crate-metadata.json',
    'ro-crate-preview.html',
  ])

  @inject(MessageService)
  protected readonly messageService!: MessageService

  @inject(WorkspaceService)
  protected readonly workspaceService!: WorkspaceService

  @inject(FileService)
  protected readonly fileService!: FileService

  @inject(FileDownloadService)
  protected readonly fileDownloadService!: FileDownloadService

  @inject(FileDialogService)
  protected readonly fileDialogService!: FileDialogService

  @inject(AppStateService)
  protected readonly appStateService!: AppStateService

  @inject(CommandService)
  protected readonly commandService!: CommandService

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(ExportRoCrateCommand, {
      execute: async () => {
        const dialog = new ExportRoCrateDialog({
          hasUnsavedChanges: () => this.hasUnsavedRoCrateChanges(),
          saveChanges: () => this.saveRoCrateBeforeExport(),
        })
        const options = await dialog.open()
        if (!options) return

        if (options.mode === ExportRoCrateMode.Normal) {
          await this.handleNormalExport(options)
          return
        }

        await this.handleCleanExport(options)
      },
    })
  }

  protected async saveRoCrateBeforeExport(): Promise<void> {
    let saveError: unknown
    const savePromise = this.commandService
      .executeCommand('ro-crate.save')
      .catch((error) => {
        saveError = error
      })
    await Promise.race([
      savePromise,
      new Promise<void>((resolve) => window.setTimeout(resolve, 2000)),
    ])
    if (saveError) {
      throw saveError
    }
  }

  protected async hasUnsavedRoCrateChanges(): Promise<boolean> {
    const appCrate = this.appStateService.roCrate
    if (!appCrate) {
      return false
    }

    const rootUri = this.getWorkspaceRoot()
    if (!rootUri) {
      return this.appStateService.dirty || this.appStateService.isRoCrateDirty(appCrate)
    }

    const metadataUri = rootUri.resolve('ro-crate-metadata.json')
    try {
      if (!(await this.fileService.exists(metadataUri))) {
        return true
      }
      const diskContent = await this.fileService.readFile(metadataUri)
      const diskCrate = this.parseCrate(diskContent.value)
      if (!diskCrate) {
        return true
      }
      return this.stringifyCrate(appCrate) !== this.stringifyCrate(diskCrate)
    } catch (error) {
      console.warn('Failed to compare RO-Crate metadata before export', error)
      return true
    }
  }

  protected stringifyCrate(crate: Record<string, any>): string | undefined {
    try {
      return JSON.stringify(crate)
    } catch {
      return undefined
    }
  }

  protected async handleNormalExport(options: ExportRoCrateOptions): Promise<void> {
    const roots = this.workspaceService.tryGetRoots()
    if (!roots.length) {
      this.messageService.warn(
        nls.localize('rockit/exportRoCrate/noWorkspace', 'No workspace is open.'),
        { timeout: 3000 },
      )
      return
    }
    const rootName = roots[0]?.resource?.path?.base || 'workspace'

    const target = await this.fileDialogService.showSaveDialog({
      title: nls.localize(
        'rockit/exportRoCrate/saveNormalTitle',
        'Save Normal export',
      ),
      filters: {
        [nls.localize('rockit/exportRoCrate/zipArchive', 'Zip Archive')]: ['zip'],
      },
      saveLabel: nls.localize('rockit/exportRoCrate/save', 'Save'),
      inputValue: `${rootName}.zip`,
    })
    if (!target) {
      return
    }

    const zip = new JSZip()
    const multiRoot = roots.length > 1

    for (const root of roots) {
      const rootUri = root.resource
      const prefix = multiRoot ? `${rootUri.path.base}/` : ''
      const shouldOmit = await this.createIgnoreMatcher(rootUri)
      await this.addDirectoryToZip(zip, rootUri, rootUri, prefix, shouldOmit)
      if (options.includeReferencedLocalFiles) {
        await this.addMetadataReferencedFilesToZip(zip, rootUri, prefix, shouldOmit, {
          includeWorkspaceSources: false,
          includeLocalSources: true,
        })
      }
    }

    try {
      const data = await zip.generateAsync({ type: 'uint8array' })
      await this.fileService.writeFile(target, BinaryBuffer.wrap(data))
      this.messageService.info(
        nls.localize(
          'rockit/exportRoCrate/normalSaved',
          'Normal export saved to {0}',
          target.path.base,
        ),
        { timeout: 3000 },
      )
    } catch (error) {
      console.error(error)
      this.messageService.error(
        nls.localize(
          'rockit/exportRoCrate/normalFailed',
          'Failed to create normal export: {0}',
          String(error),
        ),
        { timeout: 3000 },
      )
    }
  }

  protected async addDirectoryToZip(
    zip: JSZip,
    dirUri: URI,
    rootUri: URI,
    prefix: string,
    shouldOmit: (relativePath: string, isDirectory: boolean) => boolean,
  ): Promise<void> {
    // biome-ignore lint/suspicious/noImplicitAnyLet: <explanation>
    let stat
    try {
      stat = await this.fileService.resolve(dirUri)
    } catch (error) {
      console.warn('Skipping unreadable directory', dirUri.toString(), error)
      return
    }

    if (!stat.isDirectory) {
      await this.addFileToZip(zip, dirUri, rootUri, prefix, shouldOmit)
      return
    }

    const relativeDir = this.toRelativePath(rootUri, dirUri)
    if (
      relativeDir &&
      shouldOmit(relativeDir, true) &&
      !this.isForcedNormalExportFile(relativeDir)
    ) {
      return
    }

    const children = stat.children ?? []
    for (const child of children) {
      if (child.isDirectory) {
        await this.addDirectoryToZip(zip, child.resource, rootUri, prefix, shouldOmit)
      } else {
        await this.addFileToZip(zip, child.resource, rootUri, prefix, shouldOmit)
      }
    }
  }

  protected async addFileToZip(
    zip: JSZip,
    fileUri: URI,
    rootUri: URI,
    prefix: string,
    shouldOmit: (relativePath: string, isDirectory: boolean) => boolean,
  ): Promise<void> {
    const relativePath = this.toRelativePath(rootUri, fileUri)
    if (!relativePath) {
      return
    }

    if (shouldOmit(relativePath, false) && !this.isForcedNormalExportFile(relativePath)) {
      return
    }

    try {
      const content = await this.fileService.readFile(fileUri)
      const entryPath = `${prefix}${relativePath}`
      zip.file(entryPath, content.value.buffer)
    } catch (error) {
      console.warn('Skipping unreadable file', fileUri.toString(), error)
    }
  }

  protected toRelativePath(rootUri: URI, resourceUri: URI): string | undefined {
    const relative = rootUri.relative(resourceUri)
    if (!relative) {
      return undefined
    }
    return relative.toString().replace(/\\/g, '/').replace(/^\/+/, '')
  }

  protected isForcedNormalExportFile(relativePath: string): boolean {
    const normalized = relativePath
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .toLowerCase()
    return ExportRoCrateCommandContribution.FORCED_NORMAL_EXPORT_FILES.has(normalized)
  }

  protected async createIgnoreMatcher(
    rootUri: URI,
  ): Promise<(relativePath: string, isDirectory: boolean) => boolean> {
    const entries = await this.getEffectiveIgnoreEntries(rootUri)
    const rules = this.toIgnoreRules(entries)

    return (relativePath: string, _isDirectory: boolean): boolean => {
      const normalized = this.normalizeIgnorePath(relativePath)
      if (!normalized) {
        return false
      }
      return this.isIgnoredByRules(rules, normalized)
    }
  }

  protected async getEffectiveIgnoreEntries(rootUri: URI): Promise<string[]> {
    const stateEntries = this.appStateService.ignoreList
    if (Array.isArray(stateEntries) && stateEntries.length >= 0) {
      return this.withDefaultIgnoreEntries(stateEntries)
    }

    const ignoredUri = rootUri
      .resolve(ExportRoCrateCommandContribution.IGNORE_DIR)
      .resolve(ExportRoCrateCommandContribution.IGNORE_FILE)
    const diskEntries = await this.readIgnoreEntries(ignoredUri)
    return this.withDefaultIgnoreEntries(diskEntries)
  }

  protected async readIgnoreEntries(ignoreFileUri: URI): Promise<string[]> {
    try {
      const content = await this.fileService.read(ignoreFileUri)
      const text = `${content.value ?? ''}`
      return text
        .split(/\r?\n/g)
        .map((line) => this.normalizeIgnoreEntry(line))
        .filter((line): line is string => Boolean(line))
    } catch {
      return []
    }
  }

  protected withDefaultIgnoreEntries(entries: readonly string[]): string[] {
    const defaults = ExportRoCrateCommandContribution.DEFAULT_IGNORED_ENTRIES.map((entry) =>
      this.normalizeIgnoreEntry(entry),
    ).filter((entry): entry is string => Boolean(entry))
    const existingPositive = new Set(entries.filter((entry) => !entry.startsWith('!')))
    const missingDefaults = defaults.filter((entry) => !existingPositive.has(entry))
    if (!missingDefaults.length) {
      return [...entries]
    }
    return [...missingDefaults, ...entries]
  }

  protected normalizeIgnoreEntry(value: string): string | undefined {
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

  protected normalizeIgnorePath(path: string): string | undefined {
    let normalized = (path || '').replace(/\\/g, '/').trim()
    normalized = normalized.replace(/^\.\//, '')
    normalized = normalized.replace(/^\/+/, '')
    normalized = normalized.replace(/\/{2,}/g, '/')
    normalized = normalized.replace(/\/+$/, '')
    if (!normalized) {
      return undefined
    }
    return normalized.toLowerCase()
  }

  protected toIgnoreRules(entries: readonly string[]): IgnoreRule[] {
    const rules: IgnoreRule[] = []
    for (const entry of entries) {
      const negated = entry.startsWith('!')
      const ruleBody = negated ? entry.slice(1) : entry
      const directoryOnly = ruleBody.endsWith('/')
      const pattern = directoryOnly ? ruleBody.slice(0, -1) : ruleBody
      if (!pattern) {
        continue
      }
      rules.push({
        negated,
        pattern,
        directoryOnly,
        isGlob: /[*?[\]{}]/.test(pattern),
      })
    }
    return rules
  }

  protected isIgnoredByRules(rules: readonly IgnoreRule[], relativePath: string): boolean {
    let ignored = false
    for (const rule of rules) {
      if (this.matchesIgnoreRule(rule, relativePath)) {
        ignored = !rule.negated
      }
    }
    return ignored
  }

  protected matchesIgnoreRule(rule: IgnoreRule, relativePath: string): boolean {
    if (!rule.isGlob) {
      if (rule.directoryOnly) {
        return (
          relativePath === rule.pattern ||
          relativePath.startsWith(`${rule.pattern}/`)
        )
      }
      return relativePath === rule.pattern
    }

    const options: MinimatchOptions = {
      dot: true,
      nocase: true,
      windowsPathsNoEscape: true,
      matchBase: !rule.pattern.includes('/'),
    }
    if (rule.directoryOnly) {
      if (minimatch(relativePath, rule.pattern, options)) {
        return true
      }
      return minimatch(relativePath, `${rule.pattern}/**`, {
        ...options,
        matchBase: false,
      })
    }
    return minimatch(relativePath, rule.pattern, options)
  }

  protected getWorkspaceRoot(): URI | undefined {
    const roots = this.workspaceService.tryGetRoots()
    return roots?.[0]?.resource
  }

  protected parseCrate(buffer: BinaryBuffer): Record<string, any> | undefined {
    try {
      return JSON.parse(new TextDecoder('utf-8').decode(buffer.buffer))
    } catch (error) {
      console.error('Failed to parse RO-Crate metadata', error)
      return undefined
    }
  }

  protected isAllowedScheme(scheme: string): boolean {
    return ['file', 'workspace', 'user-storage'].includes(scheme)
  }

  protected async addMetadataReferencedFilesToZip(
    zip: JSZip,
    rootUri: URI,
    prefix: string,
    shouldOmit: (relativePath: string, isDirectory: boolean) => boolean,
    options: {
      crate?: Record<string, any>
      includeWorkspaceSources?: boolean
      includeLocalSources?: boolean
    } = {},
  ): Promise<number> {
    const roCrate = options.crate ?? (await this.readMetadataCrate(rootUri))
    if (!roCrate) {
      return 0
    }
    const includeWorkspaceSources = options.includeWorkspaceSources !== false
    const includeLocalSources = options.includeLocalSources === true
    const usedEntryPaths = this.collectZipEntryPaths(zip)
    const importedSourcePaths = new Map<string, string>()
    let importedResourcesPrefix: string | undefined

    let added = 0
    for (const reference of collectRoCrateExportFileReferences(roCrate)) {
      if (
        shouldOmit(reference.entryPath, false) &&
        !this.isForcedNormalExportFile(reference.entryPath)
      ) {
        continue
      }

      const sources = reference.sources.filter(
        (source: RoCrateExportFileSource) =>
          (source.kind === 'workspace' && includeWorkspaceSources) ||
          (source.kind === 'local' && includeLocalSources),
      )
      if (!sources.length) {
        continue
      }

      const resolved = await this.readReferencedFile(rootUri, sources)
      if (!resolved) {
        console.warn(
          'Skipping unresolved file referenced in RO-Crate metadata',
          reference.entityId,
          reference.sources.map((source: RoCrateExportFileSource) => source.value)
        )
        continue
      }

      let zipEntryPath = `${prefix}${reference.entryPath}`
      if (resolved.source.kind === 'local') {
        const sourceKey = this.normalizeImportedSourceKey(resolved.source.value)
        const existingImportedPath = importedSourcePaths.get(sourceKey)
        if (existingImportedPath) {
          continue
        }

        importedResourcesPrefix ??= await this.resolveImportedResourcesPrefix(
          zip,
          rootUri,
          prefix,
        )
        zipEntryPath = this.createUniqueImportedResourceEntryPath(
          importedResourcesPrefix,
          reference,
          resolved.source,
          usedEntryPaths,
        )
        importedSourcePaths.set(sourceKey, zipEntryPath)
      }

      if (usedEntryPaths.has(zipEntryPath.toLowerCase()) || zip.file(zipEntryPath)) {
        continue
      }

      zip.file(zipEntryPath, resolved.content)
      usedEntryPaths.add(zipEntryPath.toLowerCase())
      added += 1
    }

    return added
  }

  protected collectZipEntryPaths(zip: JSZip): Set<string> {
    const files = (zip as unknown as { files?: Record<string, unknown> }).files ?? {}
    return new Set(Object.keys(files).map((entry) => entry.toLowerCase()))
  }

  protected async resolveImportedResourcesPrefix(
    zip: JSZip,
    rootUri: URI,
    prefix: string,
  ): Promise<string> {
    const existing = this.collectZipEntryPaths(zip)
    for (let index = 0; index < 1000; index += 1) {
      const directoryName = index === 0 ? 'imported_resources' : `imported_resources_${index}`
      const relativeDirectoryPath = `${directoryName}/`
      const zipDirectoryPath = `${prefix}${relativeDirectoryPath}`
      if (
        existing.has(zipDirectoryPath.toLowerCase()) ||
        this.hasZipEntryUnder(zip, zipDirectoryPath) ||
        (await this.fileService.exists(rootUri.resolve(directoryName)))
      ) {
        continue
      }
      return zipDirectoryPath
    }
    return `${prefix}imported_resources_${Date.now()}/`
  }

  protected hasZipEntryUnder(zip: JSZip, directoryPath: string): boolean {
    const normalized = directoryPath.toLowerCase()
    return Array.from(this.collectZipEntryPaths(zip)).some((entry) =>
      entry.startsWith(normalized),
    )
  }

  protected createUniqueImportedResourceEntryPath(
    importedResourcesPrefix: string,
    reference: { entryPath: string },
    source: RoCrateExportFileSource,
    usedEntryPaths: Set<string>,
  ): string {
    const rawName = this.getImportedResourceFileName(reference.entryPath, source.value)
    const { baseName, extension } = this.splitFileName(rawName)

    for (let index = 0; index < 10000; index += 1) {
      const candidateName =
        index === 0 ? `${baseName}${extension}` : `${baseName}_${index}${extension}`
      const candidatePath = `${importedResourcesPrefix}${candidateName}`
      if (!usedEntryPaths.has(candidatePath.toLowerCase())) {
        return candidatePath
      }
    }

    return `${importedResourcesPrefix}${baseName}_${Date.now()}${extension}`
  }

  protected getImportedResourceFileName(entryPath: string, sourceValue: string): string {
    const candidate = entryPath || sourceValue
    const normalized = candidate.replace(/\\/g, '/').replace(/\/+$/, '')
    const fileName = normalized.split('/').filter(Boolean).pop() || 'imported_resource'
    return fileName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_') || 'imported_resource'
  }

  protected splitFileName(fileName: string): { baseName: string; extension: string } {
    const lastDot = fileName.lastIndexOf('.')
    if (lastDot <= 0 || lastDot === fileName.length - 1) {
      return { baseName: fileName, extension: '' }
    }
    return {
      baseName: fileName.slice(0, lastDot),
      extension: fileName.slice(lastDot),
    }
  }

  protected normalizeImportedSourceKey(value: string): string {
    return value.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  }

  protected async readMetadataCrate(rootUri: URI): Promise<Record<string, any> | undefined> {
    const metadataUri = rootUri.resolve('ro-crate-metadata.json')
    try {
      const metadataContent = await this.fileService.readFile(metadataUri)
      return this.parseCrate(metadataContent.value)
    } catch {
      return undefined
    }
  }

  protected async readReferencedFile(
    rootUri: URI,
    sources: readonly RoCrateExportFileSource[],
  ): Promise<{ content: Uint8Array; source: RoCrateExportFileSource } | undefined> {
    for (const source of sources) {
      try {
        const uri =
          source.kind === 'workspace'
            ? rootUri.resolve(source.value)
            : this.toLocalFileUri(source.value)
        if (!uri || !(await this.fileService.exists(uri))) {
          continue
        }

        const stat = await this.fileService.resolve(uri)
        if (stat.isDirectory) {
          continue
        }

        const content = await this.fileService.readFile(uri)
        return { content: content.value.buffer, source }
      } catch (error) {
        console.warn('Failed to read referenced RO-Crate file', source.value, error)
      }
    }

    return undefined
  }

  protected toLocalFileUri(value: string): URI | undefined {
    const trimmed = value.trim()
    if (!trimmed) {
      return undefined
    }
    if (/^file:\/\//i.test(trimmed)) {
      return new URI(trimmed)
    }
    if (
      /^[a-zA-Z]:[\\/]/.test(trimmed) ||
      /^[/\\]{2}[^/\\]/.test(trimmed) ||
      /^\/[^/]/.test(trimmed)
    ) {
      return new URI(FileUri.create(trimmed).toString())
    }
    return undefined
  }

  // ----------------------------
  // Clean export implementation
  // ----------------------------

  protected async handleCleanExport(options: ExportRoCrateOptions): Promise<void> {
    const rootUri = this.getWorkspaceRoot()
    if (!rootUri) {
      this.messageService.warn(
        nls.localize(
          'rockit/exportRoCrate/noWorkspaceRoot',
          'No workspace root available for Clean export.',
        ),
        { timeout: 3000 },
      )
      return
    }
    const rootName = rootUri.path.base || 'workspace'

    const metadataUri = rootUri.resolve('ro-crate-metadata.json')
    if (!(await this.fileService.exists(metadataUri))) {
      this.messageService.warn(
        nls.localize(
          'rockit/exportRoCrate/metadataNotFound',
          'RO-Crate metadata not found; cannot perform Clean export.',
        ),
        { timeout: 3000 },
      )
      return
    }

    const metadataContent = await this.fileService.readFile(metadataUri)
    const crate = this.parseCrate(metadataContent.value)
    if (!crate) {
      this.messageService.error(
        nls.localize(
          'rockit/exportRoCrate/parseFailed',
          'Failed to parse RO-Crate metadata.',
        ),
        { timeout: 3000 },
      )
      return
    }

    const target = await this.fileDialogService.showSaveDialog({
      title: nls.localize(
        'rockit/exportRoCrate/saveCleanTitle',
        'Save Clean RO-Crate export',
      ),
      filters: {
        [nls.localize('rockit/exportRoCrate/zipArchive', 'Zip Archive')]: ['zip'],
      },
      saveLabel: nls.localize('rockit/exportRoCrate/save', 'Save'),
      inputValue: `${rootName}-clean.zip`,
    })
    if (!target) {
      return
    }

    const zip = new JSZip()
    zip.file('ro-crate-metadata.json', metadataContent.value.buffer)

    await this.addOptionalFileToZip(zip, rootUri, 'ro-crate-preview.html')
    const shouldOmit = await this.createIgnoreMatcher(rootUri)
    await this.addMetadataReferencedFilesToZip(zip, rootUri, '', shouldOmit, {
      crate,
      includeWorkspaceSources: true,
      includeLocalSources: options.includeReferencedLocalFiles,
    })

    try {
      const data = await zip.generateAsync({ type: 'uint8array' })
      await this.fileService.writeFile(target, BinaryBuffer.wrap(data))
      this.messageService.info(
        nls.localize(
          'rockit/exportRoCrate/cleanSaved',
          'Clean export saved to {0}',
          target.path.base,
        ),
        { timeout: 3000 },
      )
    } catch (error) {
      console.error(error)
      this.messageService.error(
        nls.localize(
          'rockit/exportRoCrate/cleanFailed',
          'Failed to create clean export: {0}',
          String(error),
        ),
        { timeout: 3000 },
      )
    }
  }

  protected async addOptionalFileToZip(
    zip: JSZip,
    rootUri: URI,
    relativePath: string,
  ): Promise<void> {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
    const uri = rootUri.resolve(normalized)

    try {
      const stat = await this.fileService.resolve(uri)
      if (stat.isDirectory) {
        return
      }
      const content = await this.fileService.readFile(uri)
      zip.file(normalized, content.value.buffer)
    } catch {
      // File not present -> silently ignore
    }
  }

}

@injectable()
export class ExportRoCrateMenuContribution implements MenuContribution {
  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.FILE, {
      commandId: ExportRoCrateCommand.id,
      label: ExportRoCrateCommand.label,
    })
  }
}

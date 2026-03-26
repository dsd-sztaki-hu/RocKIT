import JSZip = require('jszip')

import { CommonMenus } from '@theia/core/lib/browser'
import {
  Command,
  CommandContribution,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
  MessageService,
  URI,
} from '@theia/core/lib/common'
import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import { inject, injectable } from '@theia/core/shared/inversify'
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { FileDownloadService } from '@theia/filesystem/lib/common/download/file-download'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { minimatch, MinimatchOptions } from 'minimatch'
import { ExportRoCrateDialog, ExportRoCrateMode } from './export-ro-crate-dialog'

export const ExportRoCrateCommand: Command = {
  id: 'ExportRoCrate.command',
  label: 'Export RO-Crate',
}

interface IgnoreRule {
  negated: boolean
  pattern: string
  directoryOnly: boolean
  isGlob: boolean
}

@injectable()
export class ExportRoCrateCommandContribution implements CommandContribution {
  protected static readonly IGNORE_DIR = '.aroma'
  protected static readonly IGNORE_FILE = 'ignored.txt'
  protected static readonly DEFAULT_IGNORED_ENTRIES = [
    'ro-crate-preview.html',
    'ro-crate-metadata.json',
    'AGENTS.md',
    'CLAUDE.md',
    '.aroma/',
  ] as const
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

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(ExportRoCrateCommand, {
      execute: async () => {
        const dialog = new ExportRoCrateDialog()
        const mode = await dialog.open()
        if (!mode) return

        if (mode === ExportRoCrateMode.Normal) {
          await this.handleNormalExport()
          return
        }

        await this.handleCleanExport()
      },
    })
  }

  protected async handleNormalExport(): Promise<void> {
    const roots = this.workspaceService.tryGetRoots()
    if (!roots.length) {
      this.messageService.warn('No workspace is open.', { timeout: 3000 })
      return
    }
    const rootName = roots[0]?.resource?.path?.base || 'workspace'

    const target = await this.fileDialogService.showSaveDialog({
      title: 'Save Normal export',
      filters: { 'Zip Archive': ['zip'] },
      saveLabel: 'Save',
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
    }

    try {
      const data = await zip.generateAsync({ type: 'uint8array' })
      await this.fileService.writeFile(target, BinaryBuffer.wrap(data))
      this.messageService.info(`Normal export saved to ${target.path.base}`, {
        timeout: 3000,
      })
    } catch (error) {
      console.error(error)
      this.messageService.error(`Failed to create normal export: ${error}`, {
        timeout: 3000,
      })
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
    const ignoredUri = rootUri
      .resolve(ExportRoCrateCommandContribution.IGNORE_DIR)
      .resolve(ExportRoCrateCommandContribution.IGNORE_FILE)
    const diskEntries = await this.readIgnoreEntries(ignoredUri)
    const entries = this.withDefaultIgnoreEntries(diskEntries)
    const rules = this.toIgnoreRules(entries)

    return (relativePath: string, _isDirectory: boolean): boolean => {
      const normalized = this.normalizeIgnorePath(relativePath)
      if (!normalized) {
        return false
      }
      return this.isIgnoredByRules(rules, normalized)
    }
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
      return JSON.parse(buffer.toString())
    } catch (error) {
      console.error('Failed to parse RO-Crate metadata', error)
      return undefined
    }
  }

  protected isAllowedScheme(scheme: string): boolean {
    return ['file', 'workspace', 'user-storage'].includes(scheme)
  }

  // ----------------------------
  // Clean export implementation
  // ----------------------------

  protected async handleCleanExport(): Promise<void> {
    const rootUri = this.getWorkspaceRoot()
    if (!rootUri) {
      this.messageService.warn('No workspace root available for Clean export.', {
        timeout: 3000,
      })
      return
    }
    const rootName = rootUri.path.base || 'workspace'

    const metadataUri = rootUri.resolve('ro-crate-metadata.json')
    if (!(await this.fileService.exists(metadataUri))) {
      this.messageService.warn(
        'RO-Crate metadata not found; cannot perform Clean export.',
        { timeout: 3000 },
      )
      return
    }

    const metadataContent = await this.fileService.readFile(metadataUri)
    const crate = this.parseCrate(metadataContent.value)
    if (!crate) {
      this.messageService.error('Failed to parse RO-Crate metadata.', { timeout: 3000 })
      return
    }

    const target = await this.fileDialogService.showSaveDialog({
      title: 'Save Clean RO-Crate export',
      filters: { 'Zip Archive': ['zip'] },
      saveLabel: 'Save',
      inputValue: `${rootName}-clean.zip`,
    })
    if (!target) {
      return
    }

    const zip = new JSZip()
    zip.file('ro-crate-metadata.json', metadataContent.value.buffer)

    await this.addOptionalFileToZip(zip, rootUri, 'ro-crate-preview.html')

    // Collect all workspace files referenced by @graph entity name
    const files = await this.collectWorkspaceFilesFromGraphByName(
      crate['@graph'],
      rootUri,
    )

    for (const file of files) {
      try {
        const fileContent = await this.fileService.readFile(file.uri)
        zip.file(file.relativePath, fileContent.value.buffer)
      } catch (error) {
        console.warn(
          'Skipping unreadable file during Clean export',
          file.uri.toString(),
          error,
        )
      }
    }

    try {
      const data = await zip.generateAsync({ type: 'uint8array' })
      await this.fileService.writeFile(target, BinaryBuffer.wrap(data))
      this.messageService.info(`Clean export saved to ${target.path.base}`, {
        timeout: 3000,
      })
    } catch (error) {
      console.error(error)
      this.messageService.error(`Failed to create clean export: ${error}`, {
        timeout: 3000,
      })
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

  protected async collectWorkspaceFilesFromGraphByName(
    graph: any,
    rootUri: URI,
  ): Promise<Array<{ uri: URI; relativePath: string }>> {
    if (!Array.isArray(graph)) {
      return []
    }

    const seen = new Set<string>()
    const results: Array<{ uri: URI; relativePath: string }> = []

    for (const entry of graph) {
      // We only care about entries that represent files in the crate
      const rawType = entry?.['@type']
      const types = Array.isArray(rawType) ? rawType : rawType ? [rawType] : []
      const isFile = types.some((t: any) => String(t) === 'File')
      if (!isFile) {
        continue
      }

      const fileName = typeof entry?.name === 'string' ? entry.name.trim() : ''
      if (!fileName) {
        continue
      }

      // Where is it in the workspace?
      // 1) Prefer directoryLabel if present (your example uses this)
      // 2) Otherwise, try @reverse.hasPart.@id to infer folder (e.g. "elsokonyvtar/" or "./")
      // 3) Otherwise, root
      const directoryLabel =
        typeof entry?.directoryLabel === 'string' ? entry.directoryLabel.trim() : ''

      const inferredDir = this.inferDirectoryFromReverseHasPart(entry)
      const dir = directoryLabel || inferredDir || ''

      const relativePath = this.joinPosix(dir, fileName) // e.g. "elsokonyvtar/jargon.html" or "keyboard-interface.html"
      const resolvedUri = rootUri.resolve(relativePath)

      // Ensure it exists and is a file
      try {
        const stat = await this.fileService.resolve(resolvedUri)
        if (stat.isDirectory) {
          continue
        }
      } catch {
        // If not found, skip (crate may reference something not present locally)
        continue
      }

      const key = resolvedUri.toString()
      if (seen.has(key)) {
        continue
      }
      seen.add(key)

      results.push({ uri: resolvedUri, relativePath })
    }

    return results
  }

  protected inferDirectoryFromReverseHasPart(entry: any): string {
    // Your sample:
    // "@reverse": { "hasPart": { "@id": "elsokonyvtar/" } }
    // or "@id": "./"
    const hp = entry?.['@reverse']?.hasPart
    const hpId =
      typeof hp?.['@id'] === 'string' ? hp['@id'] : typeof hp === 'string' ? hp : ''

    if (!hpId) {
      return ''
    }

    // Normalize "./" to root
    if (hpId === './' || hpId === '.') {
      return ''
    }

    // If it ends with "/", treat it as a folder label/path
    const normalized = hpId.replace(/\\/g, '/')
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
  }

  protected joinPosix(dir: string, file: string): string {
    const d = (dir || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
    const f = (file || '').replace(/\\/g, '/').replace(/^\/+/, '')
    return d ? `${d}/${f}` : f
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

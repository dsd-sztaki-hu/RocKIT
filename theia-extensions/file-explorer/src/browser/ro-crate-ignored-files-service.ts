import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'
import { Emitter, Event } from '@theia/core/lib/common/event'
import URI from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { minimatch, MinimatchOptions } from 'minimatch'
import { Disposable } from '@theia/core/lib/common/disposable'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'

interface IgnoreRule {
  negated: boolean
  pattern: string
  directoryOnly: boolean
  isGlob: boolean
}

@injectable()
export class RoCrateIgnoredFilesService {
  static readonly IGNORE_DIR = '.aroma'
  static readonly IGNORE_FILE = 'ignored.txt'
  static readonly DEFAULT_IGNORED_ENTRIES = [
    'ro-crate-preview.html',
    'ro-crate-metadata.json',
    'AGENTS.md',
    'CLAUDE.md',
    '.aroma/',
  ] as const

  protected ignoredEntries: string[] = []
  protected ignoredRules: IgnoreRule[] = []
  protected readonly onDidChangeIgnoredPathsEmitter = new Emitter<ReadonlySet<string>>()
  protected ignoreWatchDisposable?: Disposable
  protected ignoreChangeDisposable?: Disposable
  protected ignoreWatchRoot?: string
  protected ignoreFileUri?: URI
  protected pendingExternalReload?: number

  readonly onDidChangeIgnoredPaths: Event<ReadonlySet<string>> =
    this.onDidChangeIgnoredPathsEmitter.event

  @inject(WorkspaceService)
  protected readonly workspaceService: WorkspaceService

  @inject(FileService)
  protected readonly fileService: FileService

  @inject(AppStateService)
  protected readonly appStateService: AppStateService

  @postConstruct()
  protected init(): void {
    this.appStateService.onDidChangeSelector((state) => state.ignoreList)(
      (entries) => {
        this.setIgnoredEntries(Array.isArray(entries) ? entries : [])
      },
    )
  }

  async ensureIgnoreStoreExists(): Promise<void> {
    const rootUri = this.getPrimaryWorkspaceRootUri()
    if (!rootUri) {
      this.disposeIgnoreWatch()
      this.setIgnoredEntries([])
      return
    }

    const ignoredUri = await this.ensureIgnoreFile(rootUri)
    this.ensureIgnoreWatch(rootUri, ignoredUri)

    const diskEntries = await this.readIgnoredEntries(ignoredUri)
    const stateEntries = this.appStateService.ignoreList
    const baseEntries = Array.isArray(stateEntries) && stateEntries.length > 0
      ? stateEntries
      : diskEntries
    const next = this.compactRedundantIncludeEntries(
      this.withDefaultEntries([...baseEntries]),
    )

    if (!this.sameEntries(diskEntries, next)) {
      await this.writeIgnoredEntries(ignoredUri, next)
    }

    this.applyIgnoredEntries(next)
  }

  getIgnoredPaths(): ReadonlySet<string> {
    return new Set(this.ignoredEntries)
  }

  isIgnoredPath(relativePath: string): boolean {
    const normalized = this.normalizePathForMatch(relativePath)
    if (!normalized) {
      return false
    }

    let ignored = false
    for (const rule of this.ignoredRules) {
      if (this.matchesRule(rule, normalized)) {
        ignored = !rule.negated
      }
    }
    return ignored
  }

  async addIgnoredPaths(paths: readonly string[]): Promise<void> {
    await this.updateIgnoredPaths(paths, 'add')
  }

  async removeIgnoredPaths(paths: readonly string[]): Promise<void> {
    await this.updateIgnoredPaths(paths, 'remove')
  }

  protected async updateIgnoredPaths(
    paths: readonly string[],
    mode: 'add' | 'remove',
  ): Promise<void> {
    const rootUri = this.getPrimaryWorkspaceRootUri()
    if (!rootUri) {
      return
    }

    let next = [
      ...(this.appStateService.ignoreList ?? this.ignoredEntries),
    ]
    next = this.withDefaultEntries(next)

    for (const path of paths) {
      const isDirectoryEntry = (path || '').replace(/\\/g, '/').trim().endsWith('/')
      const normalizedBase = this.normalizePathForMatch(path)
      const normalized = normalizedBase
        ? `${normalizedBase}${isDirectoryEntry ? '/' : ''}`
        : undefined
      if (!normalized) {
        continue
      }
      if (mode === 'add') {
        next = this.upsertOmitEntry(next, normalized)
      } else {
        next = this.upsertIncludeEntry(next, normalized)
      }
    }
    next = this.compactRedundantIncludeEntries(next)

    this.applyIgnoredEntries(next)
  }

  protected resolveIgnoreFileUri(rootUri: URI): URI {
    return rootUri
      .resolve(RoCrateIgnoredFilesService.IGNORE_DIR)
      .resolve(RoCrateIgnoredFilesService.IGNORE_FILE)
  }

  protected async ensureIgnoreFile(rootUri: URI): Promise<URI> {
    const aromaUri = rootUri.resolve(RoCrateIgnoredFilesService.IGNORE_DIR)
    if (!(await this.fileService.exists(aromaUri))) {
      await this.fileService.createFolder(aromaUri)
    }
    const ignoredUri = aromaUri.resolve(RoCrateIgnoredFilesService.IGNORE_FILE)
    if (!(await this.fileService.exists(ignoredUri))) {
      await this.fileService.create(ignoredUri, '', { overwrite: true })
    }
    return ignoredUri
  }

  protected async readIgnoredEntries(ignoreFileUri: URI): Promise<string[]> {
    try {
      const content = await this.fileService.read(ignoreFileUri)
      const text = `${content.value ?? ''}`
      return text
        .split(/\r?\n/g)
        .map((line) => this.normalizeIgnoredEntry(line))
        .filter((line): line is string => Boolean(line))
    } catch {
      return []
    }
  }

  protected async writeIgnoredEntries(ignoreFileUri: URI, entries: string[]): Promise<void> {
    const lines = [...entries]
    const payload = lines.length ? `${lines.join('\n')}\n` : ''
    await this.fileService.create(ignoreFileUri, payload, { overwrite: true })
  }

  protected normalizeIgnoredEntry(value: string): string | undefined {
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

  protected normalizePathForMatch(path: string): string | undefined {
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

  protected getPrimaryWorkspaceRootUri(): URI | undefined {
    const roots = this.workspaceService.tryGetRoots()
    return roots && roots.length > 0 ? roots[0].resource : undefined
  }

  protected ensureIgnoreWatch(rootUri: URI, ignoredUri: URI): void {
    const rootKey = rootUri.toString()
    if (
      this.ignoreWatchRoot === rootKey &&
      this.ignoreFileUri &&
      this.ignoreFileUri.toString() === ignoredUri.toString()
    ) {
      return
    }

    this.disposeIgnoreWatch()
    this.ignoreWatchRoot = rootKey
    this.ignoreFileUri = ignoredUri
    this.ignoreWatchDisposable = this.fileService.watch(rootUri)
    this.ignoreChangeDisposable = this.fileService.onDidFilesChange((event) => {
      const currentIgnoreFileUri = this.ignoreFileUri
      if (!currentIgnoreFileUri || !event.contains(currentIgnoreFileUri)) {
        return
      }
      this.scheduleExternalReload()
    })
  }

  protected disposeIgnoreWatch(): void {
    this.ignoreWatchDisposable?.dispose()
    this.ignoreChangeDisposable?.dispose()
    this.ignoreWatchDisposable = undefined
    this.ignoreChangeDisposable = undefined
    this.ignoreWatchRoot = undefined
    this.ignoreFileUri = undefined
    if (this.pendingExternalReload) {
      clearTimeout(this.pendingExternalReload)
      this.pendingExternalReload = undefined
    }
  }

  protected scheduleExternalReload(): void {
    if (this.pendingExternalReload) {
      clearTimeout(this.pendingExternalReload)
    }
    this.pendingExternalReload = window.setTimeout(() => {
      this.pendingExternalReload = undefined
      void this.reloadIgnoreEntriesFromDisk()
    }, 200)
  }

  protected async reloadIgnoreEntriesFromDisk(): Promise<void> {
    const rootUri = this.getPrimaryWorkspaceRootUri()
    if (!rootUri) {
      return
    }

    const ignoredUri = this.resolveIgnoreFileUri(rootUri)
    this.ensureIgnoreWatch(rootUri, ignoredUri)

    const current = await this.readIgnoredEntries(ignoredUri)
    const next = this.compactRedundantIncludeEntries(this.withDefaultEntries(current))

    this.applyIgnoredEntries(next)
  }

  protected withDefaultEntries(entries: string[]): string[] {
    const defaults = RoCrateIgnoredFilesService.DEFAULT_IGNORED_ENTRIES.map((entry) =>
      this.normalizeIgnoredEntry(entry),
    ).filter((entry): entry is string => Boolean(entry))
    const existingPositive = new Set(
      entries.filter((entry) => !entry.startsWith('!')),
    )

    const missingDefaults = defaults.filter((entry) => !existingPositive.has(entry))
    if (!missingDefaults.length) {
      return entries
    }

    return [...missingDefaults, ...entries]
  }

  protected upsertOmitEntry(entries: string[], normalizedPath: string): string[] {
    const omitEntry = normalizedPath
    const includeEntry = `!${normalizedPath}`
    const filtered = entries.filter(
      (entry) => entry !== omitEntry && entry !== includeEntry,
    )
    filtered.push(omitEntry)
    return filtered
  }

  protected upsertIncludeEntry(entries: string[], normalizedPath: string): string[] {
    const omitEntry = normalizedPath
    const includeEntry = `!${normalizedPath}`
    const filtered = entries.filter(
      (entry) => entry !== omitEntry && entry !== includeEntry,
    )
    if (this.requiresIncludeException(filtered, normalizedPath)) {
      filtered.push(includeEntry)
    }
    return filtered
  }

  protected requiresIncludeException(
    entries: readonly string[],
    normalizedPath: string,
  ): boolean {
    const path = this.normalizePathForMatch(normalizedPath)
    if (!path) {
      return false
    }

    const rules = this.toRules(entries)
    if (this.isIgnoredByRules(rules, path)) {
      return true
    }

    if (normalizedPath.endsWith('/')) {
      const descendantProbe = `${path}/__include_probe__`
      if (this.isIgnoredByRules(rules, descendantProbe)) {
        return true
      }
    }

    return false
  }

  protected isIgnoredByRules(rules: readonly IgnoreRule[], relativePath: string): boolean {
    let ignored = false
    for (const rule of rules) {
      if (this.matchesRule(rule, relativePath)) {
        ignored = !rule.negated
      }
    }
    return ignored
  }

  protected compactRedundantIncludeEntries(entries: readonly string[]): string[] {
    let compacted = [...entries]
    for (let index = 0; index < compacted.length; index += 1) {
      const entry = compacted[index]
      if (!entry.startsWith('!')) {
        continue
      }

      const normalizedPath = entry.slice(1)
      const withoutEntry = compacted.filter((_, currentIndex) => currentIndex !== index)
      if (!this.requiresIncludeException(withoutEntry, normalizedPath)) {
        compacted = withoutEntry
        index -= 1
      }
    }
    return compacted
  }

  protected toRules(entries: readonly string[]): IgnoreRule[] {
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
        isGlob: this.hasGlobMagic(pattern),
      })
    }
    return rules
  }

  protected hasGlobMagic(value: string): boolean {
    return /[*?[\]{}]/.test(value)
  }

  protected matchesRule(rule: IgnoreRule, relativePath: string): boolean {
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
      if (this.matchesGlob(relativePath, rule.pattern, options)) {
        return true
      }
      return this.matchesGlob(relativePath, `${rule.pattern}/**`, {
        ...options,
        matchBase: false,
      })
    }
    return this.matchesGlob(relativePath, rule.pattern, options)
  }

  protected matchesGlob(
    path: string,
    pattern: string,
    options: MinimatchOptions,
  ): boolean {
    try {
      return minimatch(path, pattern, options)
    } catch {
      return false
    }
  }

  protected sameEntries(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) {
      return false
    }
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) {
        return false
      }
    }
    return true
  }

  protected setIgnoredEntries(next: string[]): void {
    if (this.sameEntries(this.ignoredEntries, next)) {
      return
    }
    this.ignoredEntries = [...next]
    this.ignoredRules = this.toRules(next)
    this.onDidChangeIgnoredPathsEmitter.fire(new Set(this.ignoredEntries))
  }

  protected applyIgnoredEntries(next: readonly string[]): void {
    const normalized = [...next]
    this.setIgnoredEntries(normalized)

    const currentStateEntries = this.appStateService.ignoreList ?? []
    if (this.sameEntries(currentStateEntries, normalized)) {
      return
    }
    this.appStateService.ignoreList = normalized.length
      ? [...normalized]
      : undefined
  }
}

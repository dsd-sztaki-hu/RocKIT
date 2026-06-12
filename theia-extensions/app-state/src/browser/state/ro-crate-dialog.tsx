import { CommandService } from '@theia/core/lib/common/command'
import { MessageService } from '@theia/core/lib/common/message-service'
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import type { URI } from '@theia/core/lib/common/uri'
import { injectable } from '@theia/core/shared/inversify'
import type { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceCommands } from '@theia/workspace/lib/browser'
import type { WorkspaceService } from '@theia/workspace/lib/browser'
import { RoCrateHtmlGenerator } from 'aroma2-common/lib/browser'
import {
  AROMA_IGNORE_DIR,
  AROMA_IGNORE_FILE,
  DEFAULT_IGNORED_ENTRIES,
  RO_CRATE_APPROVAL_FILE_NAME,
} from 'aroma2-common/lib/common/ro-crate-technical-files'
import * as mime from 'mime-types'
import type * as React from 'react'
import SparkMD5 from 'spark-md5'
import { Message } from '@lumino/messaging'

@injectable()
export class ROCrateDialog extends ReactDialog<string> {
  protected closeRoCrateButton?: HTMLButtonElement
  protected generating = false
  protected scannedFileCount = 0

  constructor(
    protected readonly workspaceService: WorkspaceService,
    protected readonly fileService: FileService,
    protected readonly roCrateHtmlGenerator: RoCrateHtmlGenerator,
    protected readonly commandService: CommandService,
    protected readonly messageService: MessageService,
    protected readonly jsonExists: boolean = true,
  ) {
    super({
      title: jsonExists
        ? 'Invalid ro-crate-metadata.json'
        : 'ro-crate-metadata.json Not Found',
    })
    this.title.closable = false
    this.appendAcceptButton(
      this.jsonExists ? 'Generate valid JSON file' : 'Generate JSON file',
    )
    this.closeRoCrateButton = this.appendButton('Close RO-Crate', false)
  }

  get value(): string {
    return ''
  }

  protected render(): React.ReactNode {
    return (
      <div style={{ padding: '20px', maxWidth: '450px' }}>
        <div
          style={{
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <i
            className="fa fa-exclamation-triangle"
            style={{ color: '#d9534f', fontSize: '24px' }}
          ></i>
          <span style={{ fontWeight: 'bold', fontSize: '14px' }}>
            {this.jsonExists ? 'Critical Parsing Error' : 'File Not Found'}
          </span>
        </div>

        <p>
          {this.jsonExists ? (
            <>
              The <code>ro-crate-metadata.json</code> file is invalid or cannot be parsed.
            </>
          ) : (
            <>
              No <code>ro-crate-metadata.json</code> was found in this workspace.
            </>
          )}
        </p>
        <p style={{ fontSize: '0.9em', color: '#888' }}>
          Would you like to generate a new default metadata file based on the current
          workspace files?
        </p>
      </div>
    )
  }

  protected async accept(): Promise<void> {
    if (this.generating) {
      return
    }

    this.generating = true
    this.scannedFileCount = 0
    this.setGenerationControls(true)
    this.setErrorMessage('')

    try {
      await this.createDefaultCrate()
      await super.accept()
    } catch (err) {
      console.error('Failed to generate RO-Crate:', err)
      this.setErrorMessage(
        `Could not generate a new RO-Crate: ${this.getErrorMessage(err)}`,
      )
      if (this.acceptButton) {
        this.acceptButton.disabled = false
      }
    } finally {
      this.generating = false
      this.setGenerationControls(false)
    }
  }

  protected async dismiss(): Promise<void> {
    await this.commandService.executeCommand(WorkspaceCommands.CLOSE.id)
    super.close()
  }

  protected override onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg)
    if (this.closeRoCrateButton) {
      this.addAction(this.closeRoCrateButton, () => {
        void this.dismiss()
      }, 'click')
    }
  }

  private async scanAndBuildEntities(
    dirUri: URI,
    rootUri: URI,
    graph: any[],
    parentHasPart: { '@id': string }[],
  ): Promise<void> {
    const fileStat = await this.fileService.resolve(dirUri, { resolveMetadata: true })
    const relativePath =
      (await this.workspaceService.getWorkspaceRelativePath(dirUri)) ?? ''
    const { directoryLabel, name } = this.splitDirectoryInfo(relativePath)
    if (!name) {
      return
    }

    if (fileStat.isDirectory) {
      const entityId = this.buildEntityId(directoryLabel, name, true)
      if (!entityId) {
        return
      }
      const dirEntity = {
        '@id': entityId,
        '@type': 'Dataset',
        name: fileStat.name,
        directoryLabel,
        hasPart: [] as { '@id': string }[],
      }
      graph.push(dirEntity)
      parentHasPart.push({ '@id': dirEntity['@id'] })

      for (const child of fileStat.children || []) {
        await this.scanAndBuildEntities(child.resource, rootUri, graph, dirEntity.hasPart)
      }
    } else {
      const content = await this.fileService.readFile(dirUri)
      const mimeType = mime.lookup(fileStat.name) || 'application/octet-stream'
      const entityId = this.buildEntityId(directoryLabel, name, false)
      if (!entityId) {
        return
      }
      const fileEntity = {
        '@id': entityId,
        '@type': 'File',
        name: fileStat.name,
        directoryLabel,
        encodingFormat: mimeType,
        contentSize: fileStat.size ? `${fileStat.size}` : undefined,
        dateModified: fileStat.mtime ? new Date(fileStat.mtime).toISOString() : undefined,
        hash: this.hashFileContent(content.value.buffer),
      }
      graph.push(fileEntity)
      parentHasPart.push({ '@id': fileEntity['@id'] })
      this.scannedFileCount += 1
      if (this.scannedFileCount % 100 === 0) {
        this.updateGenerationProgress()
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      }
    }
  }

  protected async createDefaultCrate(): Promise<void> {
    const roots = this.workspaceService.tryGetRoots()
    if (!roots || roots.length === 0) {
      throw new Error('No workspace is open.')
    }

    const rootUri = roots[0].resource
    await this.ensureDefaultIgnoredEntries(rootUri)

    const graph: any[] = []
    const rootHasPart: { '@id': string }[] = []

    const rootDataset = {
      '@id': './',
      '@type': 'Dataset',
      name: './',
      description: `RO-Crate for the workspace: ${rootUri.path.base}`,
      datePublished: new Date().toISOString(),
      hasPart: rootHasPart,
    }
    graph.push(rootDataset)

    const metadataDescriptor = {
      '@id': this.buildEntityId('', 'ro-crate-metadata.json', false),
      '@type': 'CreativeWork',
      conformsTo: { '@id': 'https://w3id.org/ro/crate/1.1' },
      about: { '@id': './' },
      directoryLabel: '',
      name: 'ro-crate-metadata.json',
    }
    graph.push(metadataDescriptor)

    const rootStat = await this.fileService.resolve(rootUri, { resolveMetadata: true })
    if (rootStat.children) {
      for (const child of rootStat.children) {
        if (
          child.name === 'ro-crate-metadata.json' ||
          child.name === 'ro-crate-preview.html' ||
          child.name === RO_CRATE_APPROVAL_FILE_NAME ||
          child.name === 'AGENTS.md' ||
          child.name === 'CLAUDE.md' ||
          child.name === '.aroma' ||
          child.name.startsWith('.')
        ) {
          continue
        }
        await this.scanAndBuildEntities(child.resource, rootUri, graph, rootHasPart)
      }
    }

    // Add directoryLabel and hash which are non-schema.org properties but are Dataverse specific
    const roCrate = {
      '@context': [
        'https://w3id.org/ro/crate/1.1/context',
        {
          directoryLabel: 'https://dataverse.org/schema/file/directoryLabel',
          hash: 'https://dataverse.org/schema/file/hash',
        },
      ],
      '@graph': graph,
    }

    const metadataUri = rootUri.resolve('ro-crate-metadata.json')
    const previewUri = rootUri.resolve('ro-crate-preview.html')

    await this.fileService.create(metadataUri, JSON.stringify(roCrate, null, 2), {
      overwrite: true,
    })

    try {
      const htmlContent = this.roCrateHtmlGenerator.generate(roCrate)
      await this.fileService.create(previewUri, htmlContent, { overwrite: true })
    } catch (error) {
      console.warn('Failed to generate RO-Crate preview:', error)
      this.messageService.warn(
        'The new RO-Crate metadata was created successfully, but the HTML preview could not be generated because the crate is too large.',
      )
    }
  }

  protected setGenerationControls(generating: boolean): void {
    if (this.acceptButton) {
      this.acceptButton.disabled = generating
      this.acceptButton.textContent = generating
        ? 'Generating...'
        : this.jsonExists
          ? 'Generate valid JSON file'
          : 'Generate JSON file'
    }
    if (this.closeRoCrateButton) {
      this.closeRoCrateButton.disabled = generating
    }
  }

  protected updateGenerationProgress(): void {
    if (this.acceptButton) {
      this.acceptButton.textContent =
        `Generating metadata... ${this.scannedFileCount.toLocaleString()} files processed`
    }
  }

  protected hashFileContent(content: Uint8Array): string {
    const arrayBuffer = content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer
    return SparkMD5.ArrayBuffer.hash(arrayBuffer)
  }

  protected getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message
    }
    return String(error)
  }

  protected async ensureDefaultIgnoredEntries(rootUri: URI): Promise<void> {
    const aromaUri = rootUri.resolve(AROMA_IGNORE_DIR)
    if (!(await this.fileService.exists(aromaUri))) {
      await this.fileService.createFolder(aromaUri)
    }

    const ignoredUri = aromaUri.resolve(AROMA_IGNORE_FILE)
    if (!(await this.fileService.exists(ignoredUri))) {
      await this.fileService.create(ignoredUri, '', { overwrite: true })
    }

    const currentEntries = await this.readIgnoredEntries(ignoredUri)
    const nextEntries = this.withDefaultIgnoredEntries(currentEntries)

    if (!this.sameEntries(currentEntries, nextEntries)) {
      const payload = nextEntries.join('\n')
      await this.fileService.create(ignoredUri, payload ? `${payload}\n` : '', {
        overwrite: true,
      })
    }
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

  protected withDefaultIgnoredEntries(entries: string[]): string[] {
    const defaults = DEFAULT_IGNORED_ENTRIES.map((entry) =>
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

  private splitDirectoryInfo(relativePath: string): { directoryLabel: string; name: string } {
    const normalized = this.normalizeRelativePathForId(relativePath)
    if (!normalized) {
      return { directoryLabel: '', name: '' }
    }
    const lastSlashIndex = normalized.lastIndexOf('/')
    if (lastSlashIndex === -1) {
      return { directoryLabel: '', name: normalized }
    }
    return {
      directoryLabel: normalized.slice(0, lastSlashIndex + 1),
      name: normalized.slice(lastSlashIndex + 1),
    }
  }

  private buildEntityId(
    directoryLabel: string,
    name: string,
    isDirectory: boolean,
  ): string | undefined {
    if (!name) {
      return undefined
    }
    let combined = `${directoryLabel}${name}`
    combined = this.normalizeRelativePathForId(combined)
    if (!combined) {
      return undefined
    }
    if (isDirectory && !combined.endsWith('/')) {
      combined = `${combined}/`
    }
    return combined
  }

  private normalizeRelativePathForId(path: string): string {
    let normalized = (path || '').replace(/\\/g, '/').trim()
    normalized = normalized.replace(/^\.\//, '')
    normalized = normalized.replace(/^\/+/, '')
    normalized = normalized.replace(/\/{2,}/g, '/')
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1)
    }
    return normalized
  }
}

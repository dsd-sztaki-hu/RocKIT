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
import { ExportRoCrateDialog, ExportRoCrateMode } from './export-ro-crate-dialog'

export const ExportRoCrateCommand: Command = {
  id: 'ExportRoCrate.command',
  label: 'Export RO-Crate',
}

@injectable()
export class ExportRoCrateCommandContribution implements CommandContribution {
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

        // Clean export: keep your existing RO-Crate-specific export implementation here
        await this.handleCleanExport()
      },
    })
  }

  protected async handleNormalExport(): Promise<void> {
    const roots = this.workspaceService.tryGetRoots()
    if (!roots.length) {
      this.messageService.warn('No workspace is open.')
      return
    }

    const target = await this.fileDialogService.showSaveDialog({
      title: 'Save Normal export',
      filters: { 'Zip Archive': ['zip'] },
      saveLabel: 'Save',
      inputValue: 'workspace-export.zip',
    })
    if (!target) {
      return
    }

    this.messageService.info('Normal export started (creating ZIP)…')

    const zip = new JSZip()
    const multiRoot = roots.length > 1

    for (const root of roots) {
      const rootUri = root.resource
      // If multiple roots, keep them separated in the zip:
      const prefix = multiRoot ? `${rootUri.path.base}/` : ''
      await this.addDirectoryToZip(zip, rootUri, rootUri, prefix)
    }

    try {
      const data = await zip.generateAsync({ type: 'uint8array' })
      await this.fileService.writeFile(target, BinaryBuffer.wrap(data))
      this.messageService.info(`Normal export saved to ${target.path.base}`)
    } catch (error) {
      console.error(error)
      this.messageService.error(`Failed to create normal export: ${error}`)
    }
  }

  protected async addDirectoryToZip(
    zip: JSZip,
    dirUri: URI,
    rootUri: URI,
    prefix: string,
  ): Promise<void> {
    // biome-ignore lint/suspicious/noImplicitAnyLet: <explanation>
    let stat
    try {
      stat = await this.fileService.resolve(dirUri)
    } catch (error) {
      console.warn('Skipping unreadable directory', dirUri.toString(), error)
      return
    }

    // If this resolves to a file, just add it (defensive)
    if (!stat.isDirectory) {
      await this.addFileToZip(zip, dirUri, rootUri, prefix)
      return
    }

    const children = stat.children ?? []
    for (const child of children) {
      if (child.isDirectory) {
        await this.addDirectoryToZip(zip, child.resource, rootUri, prefix)
      } else {
        await this.addFileToZip(zip, child.resource, rootUri, prefix)
      }
    }
  }

  protected async addFileToZip(
    zip: JSZip,
    fileUri: URI,
    rootUri: URI,
    prefix: string,
  ): Promise<void> {
    const relative = rootUri.relative(fileUri)
    if (!relative) {
      return
    }

    try {
      const content = await this.fileService.readFile(fileUri)
      // Use POSIX separators in zip entries
      const entryPath = `${prefix}${relative.toString().replace(/\\/g, '/')}`
      zip.file(entryPath, content.value.buffer)
    } catch (error) {
      console.warn('Skipping unreadable file', fileUri.toString(), error)
    }
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

  protected async handleCleanExport(): Promise<void> {
    const rootUri = this.getWorkspaceRoot()
    if (!rootUri) {
      this.messageService.warn('No workspace root available for Clean export.')
      return
    }
    const metadataUri = rootUri.resolve('ro-crate-metadata.json')
    if (!(await this.fileService.exists(metadataUri))) {
      this.messageService.warn(
        'RO-Crate metadata not found; cannot perform Clean export.',
      )
      return
    }
    const metadataContent = await this.fileService.readFile(metadataUri)
    const crate = this.parseCrate(metadataContent.value)
    if (!crate) {
      this.messageService.error('Failed to parse RO-Crate metadata.')
      return
    }

    const target = await this.fileDialogService.showSaveDialog({
      title: 'Save Clean RO-Crate export',
      filters: {
        'Zip Archive': ['zip'],
      },
      saveLabel: 'Save',
      inputValue: 'clean-ro-crate.zip',
    })
    if (!target) {
      return
    }

    const zip = new JSZip()
    zip.file('ro-crate-metadata.json', metadataContent.value.buffer)
    const files = await this.collectWorkspaceFiles(crate['@graph'], rootUri)
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
      this.messageService.info(`Clean export saved to ${target.path.base}`)
    } catch (error) {
      this.messageService.error(`Failed to create clean export: ${error}`)
    }
  }

  protected async collectWorkspaceFiles(
    graph: any,
    rootUri: URI,
  ): Promise<Array<{ uri: URI; relativePath: string }>> {
    if (!Array.isArray(graph)) {
      return []
    }
    const seen = new Set<string>()
    const results: Array<{ uri: URI; relativePath: string }> = []
    for (const entry of graph) {
      if (!this.isFileEntity(entry)) {
        continue
      }
      const resolved = await this.resolveWorkspaceFile(
        String(entry['@id'] ?? ''),
        rootUri,
      )
      if (!resolved) {
        continue
      }
      const key = resolved.uri.toString()
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      results.push(resolved)
    }
    return results
  }

  protected isFileEntity(entry: any): boolean {
    const rawType = entry?.['@type']
    if (!rawType) {
      return false
    }
    const types = Array.isArray(rawType) ? rawType : [rawType]
    return types.some((type) => String(type) === 'File')
  }

  protected async resolveWorkspaceFile(
    entryId: string,
    rootUri: URI,
  ): Promise<{ uri: URI; relativePath: string } | undefined> {
    if (!entryId) {
      return undefined
    }
    const candidate = new URI(entryId)
    if (candidate.scheme && !this.isAllowedScheme(candidate.scheme)) {
      return undefined
    }
    const normalized = candidate.scheme ? candidate : rootUri.resolve(entryId)
    if (normalized.scheme !== rootUri.scheme) {
      return undefined
    }
    const relative = rootUri.relative(normalized)
    if (!relative) {
      return undefined
    }
    try {
      const stat = await this.fileService.resolve(normalized)
      if (stat.isDirectory) {
        return undefined
      }
    } catch {
      return undefined
    }
    return { uri: normalized, relativePath: relative.toString() }
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

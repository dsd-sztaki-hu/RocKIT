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
          const roots = this.workspaceService.tryGetRoots()
          if (!roots.length) {
            return
          }

          // Download children of each workspace root
          const uris: URI[] = []
          for (const root of roots) {
            const stat = await this.fileService.resolve(root.resource)
            for (const child of stat.children ?? []) {
              uris.push(child.resource)
            }
          }

          if (!uris.length) {
            return
          }

          await this.fileDownloadService.download(uris)
          return
        }

        // Clean export: keep your existing RO-Crate-specific export implementation here
        await this.handleCleanExport()
      },
    })
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

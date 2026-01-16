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
import { inject, injectable } from '@theia/core/shared/inversify'
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
        // (e.g. call your backend service to build a crate zip and download it).
        this.messageService.info('Clean export triggered (RO-Crate structure).')
      },
    })
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

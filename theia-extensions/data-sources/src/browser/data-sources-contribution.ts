import {
  Command,
  CommandContribution,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
  MessageService,
  nls,
} from '@theia/core/lib/common'
import { CommonMenus } from '@theia/core/lib/browser'
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog'
import { inject, injectable } from '@theia/core/shared/inversify'
import { DataSourceService } from './data-source-service'

export const AddDataSourceCommand: Command = {
  id: 'data-sources.add',
  label: nls.localize('rockit/fileExplorer/addDataSource', 'Add new data source'),
}

@injectable()
export class DataSourcesContribution implements CommandContribution, MenuContribution {
  @inject(FileDialogService) protected readonly fileDialogService: FileDialogService
  @inject(DataSourceService) protected readonly dataSourceService: DataSourceService
  @inject(MessageService) protected readonly messageService: MessageService

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(AddDataSourceCommand, {
      execute: async () => {
        const uri = await this.fileDialogService.showOpenDialog({
          title: nls.localize(
            'rockit/fileExplorer/selectDataSource',
            'Select a folder to add as a data source',
          ),
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
        })

        if (!uri) {
          return
        }

        await this.dataSourceService.add(uri)
        this.messageService.info(
          nls.localize(
            'rockit/fileExplorer/dataSourceAdded',
            'Added data source: {0}',
            uri.path.toString(),
          ),
        )
      },
    })
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.FILE, {
      commandId: AddDataSourceCommand.id,
      label: AddDataSourceCommand.label,
      order: '7.5',
    })
  }
}

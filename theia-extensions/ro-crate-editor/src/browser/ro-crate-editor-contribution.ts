import { MenuModelRegistry } from '@theia/core'
import {
  AbstractViewContribution,
  ApplicationShell,
  CommonMenus,
  WidgetManager,
} from '@theia/core/lib/browser'
import { Command, CommandRegistry, CommandService } from '@theia/core/lib/common/command'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { ROCrateDialog } from 'app-state/lib/browser/state/ro-crate-dialog'
import { inject, injectable } from 'inversify'
import { RoCrateHtmlGenerator } from 'rockit-common/lib/browser';
import { RoCrateEditorWidget } from './ro-crate-editor-widget'

export const OpenRoCrateEditorCommand: Command = {
  id: 'rocrate.openEditor',
  label: 'Open New RO-Crate Editor',
}

export const InitializeRoCrateCommand: Command = {
  id: 'rocrate.initialize',
  label: 'Initialize RO-Crate',
}

const ROOT_ENTITY_ID = './'

@injectable()
export class RoCrateEditorContribution extends AbstractViewContribution<RoCrateEditorWidget> {
  @inject(AppStateService) protected readonly appStateService!: AppStateService
  @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService
  @inject(FileService) protected readonly fileService!: FileService
  @inject(RoCrateHtmlGenerator)
  protected readonly roCrateHtmlGenerator: RoCrateHtmlGenerator
  @inject(CommandService) protected readonly commandService!: CommandService

  constructor(
    @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
    @inject(ApplicationShell) protected readonly shell: ApplicationShell,
  ) {
    super({
      widgetId: RoCrateEditorWidget.ID,
      widgetName: 'RO-Crate Editor',
      defaultWidgetOptions: { area: 'main' },
    })
  }

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(OpenRoCrateEditorCommand, {
      isEnabled: () =>
        !!this.appStateService.roCrate && !this.appStateService.isROCrateInvalid,
      isVisible: () =>
        !!this.appStateService.roCrate && !this.appStateService.isROCrateInvalid,
      execute: async () => {
        const widget = await this.widgetManager.getOrCreateWidget(
          RoCrateEditorWidget.ID,
          {
            instance: Math.random().toString(),
            entityId: ROOT_ENTITY_ID,
          },
        )
        await this.shell.addWidget(widget, { area: 'main' })
        this.appStateService.registerEntityEditor(widget.id, ROOT_ENTITY_ID)
        await this.shell.activateWidget(widget.id)
      },
    })

    registry.registerCommand(InitializeRoCrateCommand, {
      isEnabled: () =>
        !this.appStateService.roCrate || this.appStateService.isROCrateInvalid,
      isVisible: () =>
        !this.appStateService.roCrate || this.appStateService.isROCrateInvalid,
      execute: async () => {
        const dialog = new ROCrateDialog(
          this.workspaceService,
          this.fileService,
          this.roCrateHtmlGenerator,
          this.commandService,
          !!this.appStateService.roCrate,
        )
        await dialog.open()
      },
    })
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.VIEW, {
      commandId: OpenRoCrateEditorCommand.id,
      label: OpenRoCrateEditorCommand.label,
    })
    menus.registerMenuAction(CommonMenus.VIEW, {
      commandId: InitializeRoCrateCommand.id,
      label: InitializeRoCrateCommand.label,
    })
  }
}

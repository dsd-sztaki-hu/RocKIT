// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { MenuModelRegistry } from '@theia/core'
import {
  AbstractViewContribution,
  ApplicationShell,
  CommonMenus,
  codicon,
  OpenerService,
  WidgetManager,
} from '@theia/core/lib/browser'
import {
  TabBarToolbarContribution,
  TabBarToolbarRegistry,
} from '@theia/core/lib/browser/shell/tab-bar-toolbar'
import { ApplicationServer } from '@theia/core/lib/common/application-protocol'
import { Command, CommandRegistry, CommandService } from '@theia/core/lib/common/command'
import { MessageService } from '@theia/core/lib/common/message-service'
import { nls } from '@theia/core/lib/common/nls'
import URI from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { ROCrateDialog } from 'app-state/lib/browser/state/ro-crate-dialog'
import { inject, injectable } from 'inversify'
import {
  findRoCrateEntityIdForPath,
  OpenRoCrateEntityForResourceCommand,
  openRockitDocumentationPage,
  ROCKIT_DOCUMENTATION_PAGES,
  RoCrateHtmlGenerator,
} from 'rockit-common/lib/browser'
import { RoCrateEditorWidget } from './ro-crate-editor-widget'

export const OpenRoCrateEditorCommand: Command = {
  id: 'rocrate.openEditor',
  label: nls.localize('rockit/roCrateEditor/openNew', 'Open New RO-Crate Editor'),
}

export const InitializeRoCrateCommand: Command = {
  id: 'rocrate.initialize',
  label: nls.localize('rockit/roCrateEditor/initialize', 'Initialize RO-Crate'),
}

export const RoCrateEditorDocumentationCommand: Command = {
  id: 'rocrate.openEditorDocumentation',
  label: nls.localize(
    'rockit/roCrateEditor/openDocumentation',
    'Open RO-Crate Editor Documentation',
  ),
  iconClass: codicon('info'),
}

const ROOT_ENTITY_ID = './'

@injectable()
export class RoCrateEditorContribution
  extends AbstractViewContribution<RoCrateEditorWidget>
  implements TabBarToolbarContribution
{
  @inject(AppStateService) protected readonly appStateService!: AppStateService
  @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService
  @inject(FileService) protected readonly fileService!: FileService
  @inject(RoCrateHtmlGenerator)
  protected readonly roCrateHtmlGenerator: RoCrateHtmlGenerator
  @inject(CommandService) protected readonly commandService!: CommandService
  @inject(MessageService) protected readonly messageService!: MessageService
  @inject(ApplicationServer) protected readonly applicationServer!: ApplicationServer
  @inject(OpenerService) protected readonly openerService!: OpenerService

  constructor(
    @inject(WidgetManager) protected readonly widgetManager: WidgetManager,
    @inject(ApplicationShell) protected readonly shell: ApplicationShell,
  ) {
    super({
      widgetId: RoCrateEditorWidget.ID,
      widgetName: nls.localize('rockit/roCrateEditor/title', 'RO-Crate Editor'),
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

    registry.registerCommand(OpenRoCrateEntityForResourceCommand, {
      execute: (resource: URI) => this.openEntityForResource(resource),
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
          this.messageService,
          !!this.appStateService.roCrate,
        )
        await dialog.open()
      },
    })

    registry.registerCommand(RoCrateEditorDocumentationCommand, {
      execute: () =>
        openRockitDocumentationPage(
          this.applicationServer,
          this.openerService,
          ROCKIT_DOCUMENTATION_PAGES.RO_CRATE_EDITOR,
        ),
      isEnabled: (widget) => widget instanceof RoCrateEditorWidget,
      isVisible: (widget) => widget instanceof RoCrateEditorWidget,
    })
  }

  protected async openEntityForResource(resource: URI): Promise<boolean> {
    const entityId = this.findFileEntityId(resource)
    if (!entityId) {
      return false
    }

    this.appStateService.selectedEntityId = entityId

    const existingWidgetId = this.appStateService.getEntityEditorWidgetId(entityId)
    const existingWidget = existingWidgetId
      ? this.shell.getWidgetById(existingWidgetId)
      : undefined
    if (existingWidget) {
      await this.shell.activateWidget(existingWidget.id)
      return true
    }

    const currentEditor = this.shell.currentWidget
    if (currentEditor instanceof RoCrateEditorWidget) {
      this.appStateService.registerEntityEditor(currentEditor.id, entityId)
      await this.shell.activateWidget(currentEditor.id)
      return true
    }

    const instanceId = `${RoCrateEditorWidget.ID}:${Math.random().toString(36).slice(2)}`
    const widget = await this.widgetManager.getOrCreateWidget(RoCrateEditorWidget.ID, {
      instanceId,
      entityId,
    })
    await this.shell.addWidget(widget, { area: 'main' })
    this.appStateService.registerEntityEditor(widget.id, entityId)
    await this.shell.activateWidget(widget.id)
    return true
  }

  protected findFileEntityId(resource: URI): string | undefined {
    const root = this.workspaceService.getWorkspaceRootUri(resource)
    const relative = root?.relative(resource)?.toString()
    return findRoCrateEntityIdForPath(this.appStateService.roCrate?.['@graph'], relative)
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

  async registerToolbarItems(toolbarRegistry: TabBarToolbarRegistry): Promise<void> {
    toolbarRegistry.registerItem({
      id: RoCrateEditorDocumentationCommand.id,
      command: RoCrateEditorDocumentationCommand.id,
      tooltip: RoCrateEditorDocumentationCommand.label,
      priority: -100,
    })
  }
}

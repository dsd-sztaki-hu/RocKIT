// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution'
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell'
import { WidgetManager } from '@theia/core/lib/browser/widget-manager'
import { inject, injectable } from '@theia/core/shared/inversify'
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service'
import { EntitiesOverviewWidget } from 'entities-overview/lib/browser/entities-overview-widget'
import { RoCrateEditorWidget } from 'ro-crate-editor/lib/browser/ro-crate-editor-widget'
import { RoCrateStructurePanelWidget } from 'ro-crate-structure-panel/lib/browser/ro-crate-structure-panel-widget'
import { EmptyWorkspaceWidget } from './empty-workspace-widget'

@injectable()
export class RoCrateDefaultLayoutContribution implements FrontendApplicationContribution {
  protected readonly leftPanelRatio = 0.18
  protected readonly rightPanelRatio = 0.18
  protected readonly structurePanelRatio = 18
  protected readonly editorPanelRatio = 46

  @inject(ApplicationShell)
  protected readonly shell: ApplicationShell

  @inject(WidgetManager)
  protected readonly widgetManager: WidgetManager

  @inject(WorkspaceService)
  protected readonly workspaceService: WorkspaceService

  async initializeLayout(): Promise<void> {
    const roots = await this.workspaceService.roots
    if (!roots || roots.length === 0) {
      await this.showEmptyWorkspace()
      return
    }

    const structure = await this.widgetManager.getOrCreateWidget(
      RoCrateStructurePanelWidget.ID,
    )
    this.shell.addWidget(structure, { area: 'main' })
    this.shell.activateWidget(structure.id)

    const editor = await this.widgetManager.getOrCreateWidget(RoCrateEditorWidget.ID)
    this.shell.addWidget(editor, {
      area: 'main',
      mode: 'split-right',
      ref: structure,
    })
    this.shell.leftPanelHandler.expand()
    await this.shell.revealWidget('file-explorer')

    const entities = await this.widgetManager.getOrCreateWidget(EntitiesOverviewWidget.ID)
    this.shell.addWidget(entities, { area: 'right' })
    this.shell.rightPanelHandler.expand()
    await this.shell.revealWidget(entities.id)

    await this.shell.pendingUpdates
    this.applyDefaultColumnRatios(structure.id, editor.id)
  }

  async onDidInitializeLayout(): Promise<void> {
    await this.updateEmptyWorkspace(await this.workspaceService.roots)
    this.workspaceService.onWorkspaceChanged((roots) => {
      void this.updateEmptyWorkspace(roots)
    })
  }

  protected async updateEmptyWorkspace(roots: readonly unknown[]): Promise<void> {
    if (roots.length === 0) {
      await this.showEmptyWorkspace()
      return
    }

    const welcome = this.shell.getWidgetById(EmptyWorkspaceWidget.ID)
    if (welcome) {
      await this.shell.closeWidget(welcome.id, { save: false })
    }
  }

  protected async showEmptyWorkspace(): Promise<void> {
    const welcome = await this.widgetManager.getOrCreateWidget(EmptyWorkspaceWidget.ID)
    if (!this.shell.getAreaFor(welcome)) {
      this.shell.addWidget(welcome, { area: 'main' })
    }
    this.shell.activateWidget(welcome.id)
  }

  protected applyDefaultColumnRatios(
    structureWidgetId: string,
    editorWidgetId: string,
  ): void {
    const shellWidth = this.shell.node.getBoundingClientRect().width
    if (shellWidth > 0) {
      const leftPanelWidth = Math.round(shellWidth * this.leftPanelRatio)
      const rightPanelWidth = Math.round(shellWidth * this.rightPanelRatio)
      this.shell.resize(leftPanelWidth, 'left')
      this.shell.resize(rightPanelWidth, 'right')
    }

    const mainLayout = this.shell.mainPanel.saveLayout() as any
    const mainArea = mainLayout.main as any
    if (
      !mainArea ||
      mainArea.type !== 'split-area' ||
      mainArea.orientation !== 'horizontal'
    ) {
      return
    }
    if (mainArea.children.length !== 2 || mainArea.sizes.length !== 2) {
      return
    }

    const [firstChild, secondChild] = mainArea.children
    if (firstChild.type !== 'tab-area' || secondChild.type !== 'tab-area') {
      return
    }

    const firstHasStructure = firstChild.widgets.some(
      (widget: { id: string }) => widget.id === structureWidgetId,
    )
    const firstHasEditor = firstChild.widgets.some(
      (widget: { id: string }) => widget.id === editorWidgetId,
    )
    const secondHasStructure = secondChild.widgets.some(
      (widget: { id: string }) => widget.id === structureWidgetId,
    )
    const secondHasEditor = secondChild.widgets.some(
      (widget: { id: string }) => widget.id === editorWidgetId,
    )

    if (firstHasStructure && secondHasEditor) {
      mainArea.sizes = [this.structurePanelRatio, this.editorPanelRatio]
    } else if (firstHasEditor && secondHasStructure) {
      mainArea.sizes = [this.editorPanelRatio, this.structurePanelRatio]
    } else {
      return
    }

    this.shell.mainPanel.restoreLayout(mainLayout)
  }
}

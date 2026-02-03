import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution'
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell'
import { WidgetManager } from '@theia/core/lib/browser/widget-manager'
import { inject, injectable } from '@theia/core/shared/inversify'
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service'
import { EntitiesOverviewWidget } from 'entities-overview/lib/browser/entities-overview-widget'
import { RoCrateEditorWidget } from 'ro-crate-editor/lib/browser/ro-crate-editor-widget'
import { RoCrateStructurePanelWidget } from 'ro-crate-structure-panel/lib/browser/ro-crate-structure-panel-widget'

@injectable()
export class RoCrateDefaultLayoutContribution implements FrontendApplicationContribution {
  @inject(ApplicationShell)
  protected readonly shell: ApplicationShell

  @inject(WidgetManager)
  protected readonly widgetManager: WidgetManager

  @inject(WorkspaceService)
  protected readonly workspaceService: WorkspaceService

  async initializeLayout(): Promise<void> {
    const roots = await this.workspaceService.roots
    if (!roots || roots.length === 0) {
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
  }
}

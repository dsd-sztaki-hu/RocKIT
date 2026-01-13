import { FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser'
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell'
import { injectable, inject } from '@theia/core/shared/inversify'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { DisposableCollection } from '@theia/core/lib/common'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateEditorWidget } from './ro-crate-editor-widget'

@injectable()
export class RoCrateEditorAppStateSyncContribution implements FrontendApplicationContribution {
  protected readonly toDispose = new DisposableCollection()

  constructor(
    @inject(ApplicationShell) protected readonly shell: ApplicationShell,
    @inject(AppStateService) protected readonly appStateService: AppStateService,
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
  ) {}

  async onStart(app: FrontendApplication): Promise<void> {
    await this.appStateService.ready
    this.reconcile()

    this.toDispose.push(
      this.shell.onDidAddWidget((widget) => {
        if (widget instanceof RoCrateEditorWidget) {
          this.reconcile()
        }
      }),
    )
    this.toDispose.push(
      this.shell.onDidRemoveWidget((widget) => {
        if (widget instanceof RoCrateEditorWidget) {
          this.reconcile()
        }
      }),
    )
    this.toDispose.push(
      this.workspaceService.onWorkspaceChanged(() => {
        this.reconcile()
      }),
    )
  }

  dispose(): void {
    this.toDispose.dispose()
  }

  protected reconcile(): void {
    const mapping: Record<string, string> = {}
    for (const widget of this.shell.widgets) {
      if (widget instanceof RoCrateEditorWidget && widget.id) {
        const entity = widget.getAssignedEntityId()
        if (entity) {
          mapping[widget.id] = entity
        }
      }
    }
    this.appStateService.EIRCEIA = Object.keys(mapping).length ? mapping : undefined
  }
}

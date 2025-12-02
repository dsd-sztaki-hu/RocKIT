import type {
  FrontendApplication,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser'
import { inject, injectable } from '@theia/core/shared/inversify'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { AppStateService } from './app-state-service'

@injectable()
export class RoCrateLoaderContribution implements FrontendApplicationContribution {
  @inject(AppStateService)
  protected readonly appStateService: AppStateService

  @inject(WorkspaceService)
  protected readonly workspaceService: WorkspaceService

  @inject(FileService)
  protected readonly fileService: FileService

  async onStart(app: FrontendApplication): Promise<void> {
    await this.syncRoCrateFromWorkspace()

    this.workspaceService.onWorkspaceChanged(async (roots) => {
      await this.syncRoCrateFromWorkspace()
    })
  }

  protected async syncRoCrateFromWorkspace(): Promise<void> {
    const roots = this.workspaceService.tryGetRoots()

    if (!roots || roots.length === 0) {
      this.updateState(undefined)
      return
    }

    const rootUri = roots[0].resource

    try {
      const roCrateUri = rootUri.resolve('ro-crate-metadata.json')

      const exists = await this.fileService.exists(roCrateUri)

      if (exists) {
        const content = await this.fileService.read(roCrateUri)
        this.updateState(content.value)
      } else {
        this.updateState(undefined)
      }
    } catch (error) {
      this.updateState(undefined)
    }
  }

  private updateState(content: string | undefined): void {
    this.appStateService.roCrate = content
  }
}

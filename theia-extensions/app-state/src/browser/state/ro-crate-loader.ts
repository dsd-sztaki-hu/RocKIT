import type {
  FrontendApplication,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser'
import { inject, injectable } from '@theia/core/shared/inversify'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { AppStateService } from './app-state-service'
import { ROCrateDialog } from './ro-crate-dialog'

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
      this.updateState(undefined, false)
      return
    }

    const rootUri = roots[0].resource

    try {
      const roCrateUri = rootUri.resolve('ro-crate-metadata.json')
      const exists = await this.fileService.exists(roCrateUri)

      if (exists) {
        const content = await this.fileService.read(roCrateUri)

        try {
          const jsonContent = JSON.parse(content.value)
          this.updateState(jsonContent, false)
        } catch (parseError) {
          console.error('Parsing error: ', parseError)

          this.updateState(undefined, true)

          const dialog = new ROCrateDialog(this.workspaceService, this.fileService)
          await dialog.open()

          const roCrateUri = rootUri.resolve('ro-crate-metadata.json')
          const content = await this.fileService.read(roCrateUri)

          const jsonContent = JSON.parse(content.value)
          this.updateState(jsonContent, false)
        }
      } else {
        this.updateState(undefined, false)
        const dialog = new ROCrateDialog(this.workspaceService, this.fileService, false)
        await dialog.open()

        const roCrateUri = rootUri.resolve('ro-crate-metadata.json')
        const content = await this.fileService.read(roCrateUri)

        const jsonContent = JSON.parse(content.value)
        this.updateState(jsonContent, false)
      }
    } catch (error) {
      this.updateState(undefined, true)
    }
  }

  private updateState(
    content: Record<string, any> | undefined,
    isInvalid: boolean,
  ): void {
    this.appStateService.roCrate = content
    this.appStateService.isROCrateInvalid = isInvalid
  }
}

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

        try {
          // Parse the string content into a JSON object
          const jsonContent = JSON.parse(content.value)
          this.updateState(jsonContent)
        } catch (parseError) {
          console.error(
            'Parsing error: ',
            parseError,
            ' for content: ',
            content.value,
            '',
          )
          this.updateState(undefined)
        }
      } else {
        this.updateState(undefined)
      }
    } catch (error) {
      console.error('Error reading ro-crate-metadata.json: ', error)
      this.updateState(undefined)
    }
  }

  private updateState(content: Record<string, any> | undefined): void {
    this.appStateService.roCrate = content
  }
}

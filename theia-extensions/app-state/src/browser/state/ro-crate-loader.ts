import type {
  FrontendApplication,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser'
import { URI } from '@theia/core/lib/common/uri'
import { inject, injectable } from '@theia/core/shared/inversify'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { RoCrateHtmlGenerator } from 'save-ro-crate/lib/browser/ro-crate-html-generator'
import { AppStateService } from './app-state-service'
import { ROCrateDialog } from './ro-crate-dialog'
// import { loadInitialCrateAndProfile } from './initial-state-loader'

@injectable()
export class RoCrateLoaderContribution implements FrontendApplicationContribution {
  @inject(AppStateService)
  protected readonly appStateService: AppStateService

  @inject(WorkspaceService)
  protected readonly workspaceService: WorkspaceService

  @inject(FileService)
  protected readonly fileService: FileService

  @inject(RoCrateHtmlGenerator)
  protected readonly roCrateHtmlGenerator: RoCrateHtmlGenerator

  // With this hack we can use the local crate.json and profile.json files for testing purposes
  // async onStart(app: FrontendApplication): Promise<void> {
  //   await this.appStateService.ready // Wait for AppStateService to be ready
  //   // await this.syncRoCrateFromWorkspace()
  //   const { roCrate, profile, selectedEntityId } = await loadInitialCrateAndProfile()
  //   console.log('Setting roCrate in AppStateService:', roCrate);
  //   this.appStateService.roCrate = roCrate
  //   console.log('Setting profile in AppStateService:', profile);
  //   this.appStateService.profile = profile
  //   console.log('Setting selectedEntityId in AppStateService:', selectedEntityId);
  //   this.appStateService.selectedEntityId = selectedEntityId

  //   this.workspaceService.onWorkspaceChanged(async (roots) => {
  //     await this.appStateService.ready // Wait for AppStateService to be ready
  //     // await this.syncRoCrateFromWorkspace()
  //     const { roCrate, profile, selectedEntityId } = await loadInitialCrateAndProfile()
  //     console.log('Setting roCrate in AppStateService (onWorkspaceChanged):', roCrate);
  //     this.appStateService.roCrate = roCrate
  //     console.log('Setting profile in AppStateService (onWorkspaceChanged):', profile);
  //     this.appStateService.profile = profile
  //     console.log('Setting selectedEntityId in AppStateService (onWorkspaceChanged):', selectedEntityId);
  //     this.appStateService.selectedEntityId = selectedEntityId
  //   })
  // }

  async onStart(app: FrontendApplication): Promise<void> {
    await this.syncRoCrateFromWorkspace()

    this.workspaceService.onWorkspaceChanged(() => {
      void this.syncRoCrateFromWorkspace()
    })
    this.workspaceService.onWorkspaceLocationChanged(() => {
      void this.syncRoCrateFromWorkspace()
    })
  }

  public async refresh(): Promise<void> {
    await this.syncRoCrateFromWorkspace()
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
          void this.promptForCrateRecovery(rootUri, true)
        }
        return
      }

      this.updateState(undefined, false)
      void this.promptForCrateRecovery(rootUri, false)
    } catch (error) {
      this.updateState(undefined, true)
    }
  }

  protected async promptForCrateRecovery(
    rootUri: URI,
    jsonExists: boolean,
  ): Promise<void> {
    const dialog = new ROCrateDialog(
      this.workspaceService,
      this.fileService,
      this.roCrateHtmlGenerator,
      jsonExists,
    )
    await dialog.open()

    const roots = this.workspaceService.tryGetRoots()
    if (!roots || roots.length === 0) {
      return
    }

    const currentRoot = roots[0].resource
    if (currentRoot.toString() !== rootUri.toString()) {
      return
    }

    const roCrateUri = currentRoot.resolve('ro-crate-metadata.json')
    const exists = await this.fileService.exists(roCrateUri)
    if (!exists) {
      return
    }

    try {
      const content = await this.fileService.read(roCrateUri)
      const jsonContent = JSON.parse(content.value)
      this.updateState(jsonContent, false)
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
    this.appStateService.setRoCrateSnapshot(content)
    this.appStateService.dirty = false
  }
}

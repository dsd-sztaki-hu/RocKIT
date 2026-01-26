import type {
  FrontendApplication,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser'
import { CommandService, MessageService } from '@theia/core/lib/common'
import { URI } from '@theia/core/lib/common/uri'
import { inject, injectable } from '@theia/core/shared/inversify'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { AppStateService } from './app-state-service'
import { ROCrateDialog } from './ro-crate-dialog'
import { RoCrateIdConversionDialog } from './ro-crate-id-conversion-dialog'

// import { loadInitialCrateAndProfile } from './initial-state-loader'

const REMOTE_RO_CRATE_CONVERSION_COMMAND_ID = 'RemoteRoCrateConversion.command'

@injectable()
export class RoCrateLoaderContribution implements FrontendApplicationContribution {
  @inject(AppStateService)
  protected readonly appStateService: AppStateService

  @inject(WorkspaceService)
  protected readonly workspaceService: WorkspaceService

  @inject(FileService)
  protected readonly fileService: FileService

  @inject(CommandService)
  protected readonly commandService: CommandService

  @inject(MessageService)
  protected readonly messageService: MessageService

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
    const roCrateUri = rootUri.resolve('ro-crate-metadata.json')
    const exists = await this.fileService.exists(roCrateUri)

    if (!exists) {
      this.updateState(undefined, false)
      const dialog = new ROCrateDialog(this.workspaceService, this.fileService, false)
      await dialog.open()
      const crate = await this.loadRoCrateWithNormalization(roCrateUri)
      this.updateState(crate, false)
      return
    }

    try {
      const crate = await this.loadRoCrateWithNormalization(roCrateUri)
      this.updateState(crate, false)
    } catch (parseError) {
      console.error('Parsing error: ', parseError)
      this.updateState(undefined, true)
      const dialog = new ROCrateDialog(this.workspaceService, this.fileService)
      await dialog.open()
      const crate = await this.loadRoCrateWithNormalization(roCrateUri)
      this.updateState(crate, false)
    }
  }

  private async loadRoCrateWithNormalization(
    metadataUri: URI,
  ): Promise<Record<string, any>> {
    const crate = await this.readRoCrateJson(metadataUri)
    return this.ensureRelativeIdsIfNeeded(metadataUri, crate)
  }

  private async readRoCrateJson(metadataUri: URI): Promise<Record<string, any>> {
    const content = await this.fileService.read(metadataUri)
    return JSON.parse(content.value)
  }

  private async ensureRelativeIdsIfNeeded(
    metadataUri: URI,
    crate: Record<string, any>,
  ): Promise<Record<string, any>> {
    if (!this.needsIdConversion(crate)) {
      return crate
    }
    const dialog = new RoCrateIdConversionDialog()
    const shouldConvert = await dialog.open()
    if (!shouldConvert) {
      return crate
    }
    try {
      await this.commandService.executeCommand(REMOTE_RO_CRATE_CONVERSION_COMMAND_ID)
      return await this.readRoCrateJson(metadataUri)
    } catch (error) {
      console.error('RO-Crate conversion failed', error)
      this.messageService.error(
        'Failed to update RO-Crate metadata to workspace-relative IDs.',
      )
      return crate
    }
  }

  private needsIdConversion(crate: Record<string, any>): boolean {
    const graph = Array.isArray(crate?.['@graph']) ? crate['@graph'] : []
    for (const entry of graph) {
      if (!entry || typeof entry !== 'object') {
        continue
      }
      const rawType = entry['@type']
      const types: string[] = Array.isArray(rawType)
        ? rawType.filter((type): type is string => typeof type === 'string')
        : typeof rawType === 'string'
          ? [rawType]
          : []
      const relevant = types.some(
        (type) => type === 'File' || type === 'Dataset' || type === 'CreativeWork',
      )
      if (!relevant) {
        continue
      }
      const id = typeof entry['@id'] === 'string' ? entry['@id'].trim() : ''
      if (!id) {
        return true
      }
      if (types.includes('Dataset') && (id === './' || id === '.')) {
        continue
      }
      if (!id.startsWith('file://./')) {
        return true
      }
    }
    return false
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

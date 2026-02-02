import type {
  FrontendApplication,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser'
import { URI } from '@theia/core/lib/common/uri'
import { inject, injectable } from '@theia/core/shared/inversify'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { RoCrateHtmlGenerator, MetadataSchemaManager } from 'aroma2-common/lib/browser'
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

  @inject(MetadataSchemaManager)
  protected readonly schemaManagerService: MetadataSchemaManager

  protected initialProfileTemplate?: Record<string, any>

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
    await this.appStateService.ready
    await this.syncRoCrateFromWorkspace()

    try {
      const profileModule = await import('../../../data/init_profile.json')
      this.initialProfileTemplate = profileModule.default
      this.appStateService.setInitialProfileTemplate(profileModule.default)
      this.appStateService.profile = this.appStateService.profile ?? profileModule.default
    } catch (error) {
      console.error('Failed to load initial profile data:', error)
      this.initialProfileTemplate = undefined
      this.appStateService.setInitialProfileTemplate(undefined)
      this.appStateService.profile = undefined
    }
    await this.refreshCompleteProfile(this.appStateService.roCrate)

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
      await this.refreshCompleteProfile(undefined)
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
          await this.refreshCompleteProfile(jsonContent)
        } catch (parseError) {
          console.error('Parsing error: ', parseError)
          this.updateState(undefined, true)
          await this.refreshCompleteProfile(undefined)
          void this.promptForCrateRecovery(rootUri, true)
        }
        return
      }

      this.updateState(undefined, false)
      await this.refreshCompleteProfile(undefined)
      void this.promptForCrateRecovery(rootUri, false)
    } catch (error) {
      this.updateState(undefined, true)
      await this.refreshCompleteProfile(undefined)
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
      await this.refreshCompleteProfile(jsonContent)
    } catch (error) {
      this.updateState(undefined, true)
      await this.refreshCompleteProfile(undefined)
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

  protected async refreshCompleteProfile(
    crate: Record<string, any> | undefined,
  ): Promise<void> {
    if (!crate) {
      this.appStateService.completeProfile = this.cloneProfile(
        this.initialProfileTemplate,
      )
      return
    }

    const baseProfile =
      this.cloneProfile(this.initialProfileTemplate) ?? this.createEmptyProfile()
    const conformsToIds = this.extractAllConformsToIds(crate)
    if (conformsToIds.length === 0) {
      this.appStateService.completeProfile = baseProfile
      return
    }

    const allSchemas = await this.schemaManagerService.loadAllSchemas()
    let mergedProfile = baseProfile

    for (const conformsToUrl of conformsToIds) {
      const matchingSchema = allSchemas.find(
        (schema) => schema.conformsTo === conformsToUrl,
      )
      if (!matchingSchema) {
        continue
      }
      const convertedContent = await this.schemaManagerService.getConvertedProfileContent(
        matchingSchema.path,
      )
      console.log('COMPLETE PROFLILE convertedContent', convertedContent)
      if (convertedContent) {
        mergedProfile = await this.schemaManagerService.getMergedProfile(
          crate,
          convertedContent,
          mergedProfile,
          conformsToUrl,
        )
      }
    }

    this.appStateService.completeProfile = mergedProfile
  }

  protected extractAllConformsToIds(crate: Record<string, any>): string[] {
    const rawGraph = crate?.['@graph']
    const graph = Array.isArray(rawGraph) ? rawGraph : []
    const ids = new Set<string>()
    const pushId = (val: any) => {
      if (!val) return
      if (typeof val === 'string') {
        const t = val.trim()
        if (t) ids.add(t)
        return
      }
      if (typeof val === 'object') {
        const idVal = (val as any)['@id'] ?? (val as any).id
        if (typeof idVal === 'string') {
          const t = idVal.trim()
          if (t) ids.add(t)
        }
      }
    }

    for (const entry of graph) {
      if (!entry || typeof entry !== 'object') {
        continue
      }
      const value: any = (entry as any).conformsTo
      if (Array.isArray(value)) {
        for (const v of value) pushId(v)
      } else {
        pushId(value)
      }
    }

    return Array.from(ids)
  }

  protected cloneProfile(
    profile: Record<string, any> | undefined,
  ): Record<string, any> | undefined {
    if (!profile) {
      return undefined
    }
    try {
      return JSON.parse(JSON.stringify(profile))
    } catch {
      return undefined
    }
  }

  protected createEmptyProfile(): Record<string, any> {
    return { classes: {}, layouts: [], localisation: {} }
  }
}

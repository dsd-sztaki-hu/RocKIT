import type {
  FrontendApplication,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser'
import { CommandService, MessageService } from '@theia/core/lib/common'
import { URI } from '@theia/core/lib/common/uri'
import { inject, injectable } from '@theia/core/shared/inversify'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { MetadataSchemaManager, RoCrateHtmlGenerator } from 'aroma2-common/lib/browser'
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

  @inject(RoCrateHtmlGenerator)
  protected readonly roCrateHtmlGenerator: RoCrateHtmlGenerator

  @inject(MetadataSchemaManager)
  protected readonly schemaManagerService: MetadataSchemaManager

  @inject(CommandService)
  protected readonly commandService: CommandService

  @inject(MessageService)
  protected readonly messageService: MessageService

  protected initialProfileTemplate?: Record<string, any>

  /**
   * Critical: lets us distinguish between:
   * - "startup: roots not ready yet" (do NOT wipe restored state)
   * - "workspace was open, then got closed" (OK to clear state)
   */
  protected hadWorkspaceRoots = false

  async onStart(app: FrontendApplication): Promise<void> {
    await this.appStateService.ready

    // Load init_profile.json like main
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

    // IMPORTANT: do an initial sync attempt, but NEVER wipe state if roots aren't ready yet.
    await this.syncRoCrateFromWorkspace()

    // ensure completeProfile reflects current crate (restored or loaded)
    await this.refreshCompleteProfile(this.appStateService.roCrate)
    this.watchSchemaChanges()

    // Re-sync when workspace changes
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

    // Roots not available / empty:
    if (!roots || roots.length === 0) {
      // If we previously had roots, then this is a real "workspace closed" case => clear state.
      if (this.hadWorkspaceRoots) {
        this.updateState(undefined, false)
        await this.refreshCompleteProfile(undefined)
      }
      // Otherwise: startup / not ready yet => DO NOT touch restored state.
      return
    }

    // Now we definitely have a workspace
    this.hadWorkspaceRoots = true

    const rootUri = roots[0].resource

    try {
      const roCrateUri = rootUri.resolve('ro-crate-metadata.json')
      const exists = await this.fileService.exists(roCrateUri)

      if (exists) {
        try {
          const crate = await this.loadRoCrateWithNormalization(roCrateUri)
          this.updateState(crate, false)
          await this.refreshCompleteProfile(crate)
        } catch (parseError) {
          console.error('Parsing error: ', parseError)
          this.updateState(undefined, true)
          await this.refreshCompleteProfile(undefined)
          void this.promptForCrateRecovery(rootUri, true)
        }
        return
      }

      // crate json missing
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
      const crate = await this.loadRoCrateWithNormalization(roCrateUri)
      this.updateState(crate, false)
      await this.refreshCompleteProfile(crate)
    } catch (error) {
      this.updateState(undefined, true)
      await this.refreshCompleteProfile(undefined)
    }
  }

  // ---- 26606 normalization integration ----

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

    // Open dialog but DON'T block startup: handle result asynchronously.
    // This lets the rest of the app use the restored crate immediately.
    // If the user agrees, run the conversion in the background and update state.
    try {
      const maybePromise = dialog.open()
      // dialog.open() may return a Promise<boolean> (typical). If it does,
      // attach a handler. If it returns synchronously, treat value accordingly.
      if (maybePromise && typeof (maybePromise as any).then === 'function') {
        ;(maybePromise as Promise<boolean>)
          .then((shouldConvert) => {
            if (!shouldConvert) {
              return
            }
            // run conversion in background, update state when done
            void (async () => {
              try {
                await this.commandService.executeCommand(
                  REMOTE_RO_CRATE_CONVERSION_COMMAND_ID,
                )
                // re-read metadata after conversion and update app state so explorer updates
                const converted = await this.readRoCrateJson(metadataUri)
                // update application state and profile
                this.updateState(converted, false)
                try {
                  await this.refreshCompleteProfile(converted)
                } catch (err) {
                  console.error('Error refreshing complete profile after conversion', err)
                }
                // notify success (optional)
                this.messageService.info(
                  'RO-Crate IDs converted to workspace-relative paths.',
                )
              } catch (error) {
                console.error('RO-Crate conversion failed', error)
                this.messageService.error(
                  'Failed to update RO-Crate metadata to workspace-relative IDs.',
                )
              }
            })()
          })
          .catch((err) => {
            // dialog failure (rare) — ignore; keep crate as-is
            console.error('RoCrateIdConversionDialog failed:', err)
          })
      } else {
        // dialog.open returned synchronously (boolean); handle immediately but non-blocking
        const shouldConvert = Boolean(maybePromise)
        if (shouldConvert) {
          void (async () => {
            try {
              await this.commandService.executeCommand(
                REMOTE_RO_CRATE_CONVERSION_COMMAND_ID,
              )
              const converted = await this.readRoCrateJson(metadataUri)
              this.updateState(converted, false)
              try {
                await this.refreshCompleteProfile(converted)
              } catch (err) {
                console.error('Error refreshing complete profile after conversion', err)
              }
              this.messageService.info(
                'RO-Crate IDs converted to workspace-relative paths.',
              )
            } catch (error) {
              console.error('RO-Crate conversion failed', error)
              this.messageService.error(
                'Failed to update RO-Crate metadata to workspace-relative IDs.',
              )
            }
          })()
        }
      }
    } catch (err) {
      // opening the dialog itself failed for some reason: keep crate as-is and log
      console.error('Failed to open RoCrateIdConversionDialog:', err)
    }

    // Return the crate immediately so UI can render and file explorer can color.
    return crate
  }

  private needsIdConversion(crate: Record<string, any>): boolean {
    const graph = Array.isArray(crate?.['@graph']) ? crate['@graph'] : []
    for (const entry of graph) {
      if (!entry || typeof entry !== 'object') continue

      const rawType = (entry as any)['@type']
      const types: string[] = Array.isArray(rawType)
        ? rawType.filter((t): t is string => typeof t === 'string')
        : typeof rawType === 'string'
          ? [rawType]
          : []

      const relevant = types.some(
        (t) => t === 'File' || t === 'Dataset' || t === 'CreativeWork',
      )
      if (!relevant) continue

      const id =
        typeof (entry as any)['@id'] === 'string' ? (entry as any)['@id'].trim() : ''

      if (!id) return true

      if (types.includes('Dataset') && (id === './' || id === '.')) {
        continue
      }

      if (!id.startsWith('file://./')) {
        return true
      }
    }
    return false
  }

  // ---- main update + profile merge logic ----

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
      if (!matchingSchema) continue

      const convertedContent = await this.schemaManagerService.getConvertedProfileContent(
        matchingSchema.path,
      )

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

  protected watchSchemaChanges(): void {
    this.schemaManagerService.onDidChangeSchemas(() => {
      void this.refreshCompleteProfile(this.appStateService.roCrate)
    })
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
      if (!entry || typeof entry !== 'object') continue
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
    if (!profile) return undefined
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

import type {
  FrontendApplication,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser'
import type { Disposable } from '@theia/core'
import { PreferenceScope } from '@theia/core'
import { CommandService, MessageService, PreferenceService } from '@theia/core/lib/common'
import { URI } from '@theia/core/lib/common/uri'
import { inject, injectable } from '@theia/core/shared/inversify'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { MetadataSchemaManager, RoCrateHtmlGenerator } from 'aroma2-common/lib/browser'
import {
  AppStatePreferences,
  ROCrateExternalChangeAction,
  type ROCrateExternalChangeActionValue,
} from '../../common/app-state-preferences'
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

  @inject(AppStatePreferences)
  protected readonly appStatePreferences: AppStatePreferences

  @inject(PreferenceService)
  protected readonly preferenceService: PreferenceService

  protected initialProfileTemplate?: Record<string, any>
  protected metadataWatchDisposable?: Disposable
  protected metadataChangeDisposable?: Disposable
  protected metadataWatchRoot?: string
  protected metadataFileUri?: URI
  protected pendingExternalCheck?: ReturnType<typeof setTimeout>
  protected lastKnownMetadataJson?: string

  protected pendingAppStateProfileRefresh?: ReturnType<typeof setTimeout>
  protected pendingAppStateProfileRefreshCrate?: Record<string, any>
  protected lastObservedConformsToKey = ''

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
    await this.refreshProfileList(this.appStateService.roCrate)
    await this.refreshCompleteProfile(this.appStateService.roCrate)
    this.watchSchemaChanges()
    this.watchAppStateCrateChanges()

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
      this.disposeMetadataWatch()
      // If we previously had roots, then this is a real "workspace closed" case => clear state.
      if (this.hadWorkspaceRoots) {
        this.updateState(undefined, false)
        await this.refreshProfileList(undefined)
        await this.refreshCompleteProfile(undefined)
      }
      // Otherwise: startup / not ready yet => DO NOT touch restored state.
      return
    }

    // Now we definitely have a workspace
    this.hadWorkspaceRoots = true

    const rootUri = roots[0].resource
    this.ensureMetadataWatch(rootUri)

    try {
      const roCrateUri = rootUri.resolve('ro-crate-metadata.json')
      const exists = await this.fileService.exists(roCrateUri)

      if (exists) {
        try {
          const crate = await this.loadRoCrateWithNormalization(roCrateUri)
          this.updateState(crate, false)
          await this.refreshProfileList(crate)
          await this.refreshCompleteProfile(crate)
        } catch (parseError) {
          console.error('Parsing error: ', parseError)
          this.updateState(undefined, true)
          await this.refreshProfileList(undefined)
          await this.refreshCompleteProfile(undefined)
          void this.promptForCrateRecovery(rootUri, true)
        }
        return
      }

      // crate json missing
      this.updateState(undefined, false)
      await this.refreshProfileList(undefined)
      await this.refreshCompleteProfile(undefined)
      void this.promptForCrateRecovery(rootUri, false)
    } catch (error) {
      this.updateState(undefined, true)
      await this.refreshProfileList(undefined)
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
      this.commandService,
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
      await this.refreshProfileList(crate)
      await this.refreshCompleteProfile(crate)
    } catch (error) {
      this.updateState(undefined, true)
      await this.refreshProfileList(undefined)
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
                  await this.refreshProfileList(converted)
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
                await this.refreshProfileList(converted)
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
    this.lastObservedConformsToKey = this.buildConformsToKey(content)
    this.appStateService.roCrate = content
    this.appStateService.isROCrateInvalid = isInvalid
    this.appStateService.setRoCrateSnapshot(content)
    this.appStateService.dirty = false
    this.lastKnownMetadataJson = this.normalizeCrate(content)
  }

  protected ensureMetadataWatch(rootUri: URI): void {
    const rootKey = rootUri.toString()
    if (this.metadataWatchRoot === rootKey) {
      return
    }
    this.disposeMetadataWatch()
    this.metadataWatchRoot = rootKey
    this.metadataFileUri = rootUri.resolve('ro-crate-metadata.json')
    this.metadataWatchDisposable = this.fileService.watch(rootUri)
    this.metadataChangeDisposable = this.fileService.onDidFilesChange((event) => {
      const metadataUri = this.metadataFileUri
      if (!metadataUri) {
        return
      }
      if (!event.contains(metadataUri)) {
        return
      }
      this.scheduleExternalMetadataCheck()
    })
  }

  protected disposeMetadataWatch(): void {
    this.metadataWatchDisposable?.dispose()
    this.metadataChangeDisposable?.dispose()
    this.metadataWatchDisposable = undefined
    this.metadataChangeDisposable = undefined
    this.metadataWatchRoot = undefined
    this.metadataFileUri = undefined
  }

  protected scheduleExternalMetadataCheck(): void {
    if (this.pendingExternalCheck) {
      clearTimeout(this.pendingExternalCheck)
    }
    this.pendingExternalCheck = setTimeout(() => {
      void this.handleExternalMetadataChange()
    }, 300)
  }

  protected async handleExternalMetadataChange(): Promise<void> {
    this.pendingExternalCheck = undefined
    const root = this.workspaceService.tryGetRoots()?.[0]?.resource
    if (!root) {
      return
    }
    const metadataUri = root.resolve('ro-crate-metadata.json')
    const exists = await this.fileService.exists(metadataUri)
    if (!exists) {
      if (this.lastKnownMetadataJson) {
        this.lastKnownMetadataJson = undefined
        this.messageService.warn(
          'ro-crate-metadata.json was removed or is missing on disk.',
        )
      }
      return
    }

    let parsed: Record<string, any>
    try {
      const content = await this.fileService.read(metadataUri)
      parsed = JSON.parse(content.value)
    } catch (error) {
      this.messageService.error(
        'ro-crate-metadata.json changed on disk but could not be parsed.',
      )
      return
    }

    const normalized = this.normalizeCrate(parsed)
    if (!normalized) {
      return
    }
    const action =
      this.appStatePreferences[ROCrateExternalChangeAction] ??
      ('prompt' as ROCrateExternalChangeActionValue)
    if (normalized === this.lastKnownMetadataJson) {
      return
    }
    const currentNormalized = this.normalizeCrate(this.appStateService.roCrate)
    if (normalized === currentNormalized) {
      this.lastKnownMetadataJson = normalized
      return
    }
    if (!this.appStateService.isRoCrateDirty(parsed)) {
      this.lastKnownMetadataJson = normalized
      return
    }

    this.lastKnownMetadataJson = normalized

    if (action === 'off') {
      return
    }

    if (action === 'auto') {
      this.messageService.info(
        'ro-crate-metadata.json changed outside the application. Reloading.',
      )
      await this.reloadExternalCrate(metadataUri)
      return
    }

    const choice = await this.messageService.info(
      'ro-crate-metadata.json changed outside the application. Reload changes?',
      'Reload',
      'Always Reload',
      'Ignore',
    )
    if (choice === 'Always Reload') {
      await this.preferenceService.set(
        ROCrateExternalChangeAction,
        'auto',
        PreferenceScope.User,
      )
    }
    if (choice === 'Reload' || choice === 'Always Reload') {
      await this.reloadExternalCrate(metadataUri)
    }
  }

  protected async reloadExternalCrate(metadataUri: URI): Promise<void> {
    try {
      const crate = await this.loadRoCrateWithNormalization(metadataUri)
      this.updateState(crate, false)
      await this.refreshProfileList(crate)
      await this.refreshCompleteProfile(crate)
    } catch (error) {
      console.error('Failed to reload RO-Crate after external change:', error)
      this.messageService.error(
        'Failed to reload ro-crate-metadata.json after external change.',
      )
    }
  }

  protected normalizeCrate(
    crate: Record<string, any> | undefined,
  ): string | undefined {
    if (!crate) {
      return undefined
    }
    try {
      return JSON.stringify(crate)
    } catch (error) {
      console.warn('Failed to normalize RO-Crate metadata:', error)
      return undefined
    }
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

    const profileList = this.appStateService.profileList
    if (!profileList || profileList.length === 0) {
      this.appStateService.completeProfile = baseProfile
      return
    }

    let mergedProfile = baseProfile

    for (const entry of profileList) {
      const conformsToUrl = (entry?.id ?? '').trim()
      if (!conformsToUrl) {
        continue
      }

      const convertedContent = entry?.content

      try {
        if (convertedContent) {
          mergedProfile = await this.schemaManagerService.getMergedProfile(
            crate,
            convertedContent,
            mergedProfile,
            conformsToUrl,
          )
        } else {
          console.warn('Invalid profile content for conformsTo URL:', conformsToUrl)
        }
      } catch (error) {
        console.warn('Failed to merge profile for conformsTo URL:', conformsToUrl, error)
      }
    }

    this.appStateService.completeProfile = mergedProfile
  }

  protected watchSchemaChanges(): void {
    this.schemaManagerService.onDidChangeSchemas(() => {
      void this.refreshProfileList(this.appStateService.roCrate)
      void this.refreshCompleteProfile(this.appStateService.roCrate)
    })
  }

  protected watchAppStateCrateChanges(): void {
    this.appStateService.onDidChangeSelector((s) => s.roCrate)((crate) => {
      this.handleAppStateCrateChange(crate)
    })
  }

  protected handleAppStateCrateChange(crate: Record<string, any> | undefined): void {
    const nextKey = this.buildConformsToKey(crate)
    if (nextKey === this.lastObservedConformsToKey) {
      return
    }

    this.lastObservedConformsToKey = nextKey

    this.pendingAppStateProfileRefreshCrate = crate

    if (this.pendingAppStateProfileRefresh) {
      clearTimeout(this.pendingAppStateProfileRefresh)
    }

    this.pendingAppStateProfileRefresh = setTimeout(() => {
      this.pendingAppStateProfileRefresh = undefined
      const next = this.pendingAppStateProfileRefreshCrate
      void (async () => {
        try {
          await this.updateProfileListIncrementally(next)
          await this.refreshCompleteProfile(next)
        } catch (error) {
          console.error(
            'Failed to refresh profile list after RO-Crate change in AppState',
            error,
          )
        }
      })()
    }, 200)
  }

  protected buildConformsToKey(crate: Record<string, any> | undefined): string {
    if (!crate) {
      return ''
    }

    const ids = this.extractAllConformsToIds(crate)
      .map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter((id) => id.length !== 0)
      .sort()

    return ids.join('|')
  }

  protected async updateProfileListIncrementally(
    crate: Record<string, any> | undefined,
  ): Promise<void> {
    if (!crate) {
      this.appStateService.profileList = undefined
      return
    }

    const nextIds = this.extractAllConformsToIds(crate)
      .map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter((id) => id.length !== 0)

    const nextUnique = Array.from(new Set(nextIds)).sort()

    if (nextUnique.length === 0) {
      this.appStateService.profileList = undefined
      return
    }

    const prevList = Array.isArray(this.appStateService.profileList)
      ? this.appStateService.profileList
      : []

    const prevById = new Map<string, { id: string; content: Record<string, any>; flag: string }>()
    for (const item of prevList as any[]) {
      const id = typeof item?.id === 'string' ? item.id.trim() : ''
      if (id) {
        prevById.set(id, item)
      }
    }

    const missingIds: string[] = []
    const nextList: Array<{ id: string; content: Record<string, any>; flag: string }> = []

    for (const id of nextUnique) {
      const existing = prevById.get(id)
      if (existing?.content) {
        nextList.push({
          id,
          content: existing.content,
          flag: typeof (existing as any).flag === 'string' ? (existing as any).flag : '',
        })
        continue
      }
      missingIds.push(id)
    }

    if (missingIds.length !== 0) {
      const allSchemas = await this.schemaManagerService.loadAllSchemas()

      for (const id of missingIds) {
        const matchingSchema = allSchemas.find(
          (schema) => (schema?.conformsTo ?? '').trim() === id,
        )
        if (!matchingSchema) {
          console.warn('No schema found for conformsTo URL:', id)
          continue
        }
        try {
          const convertedContent = await this.schemaManagerService.getConvertedProfileContent(
            matchingSchema.files.convertedPath,
          )
          if (convertedContent) {
            nextList.push({
              id,
              content: convertedContent,
              flag: '',
            })
          } else {
            console.warn('Invalid profile content for conformsTo URL:', id)
          }
        } catch (error) {
          console.warn('Failed to load profile for conformsTo URL:', id, error)
        }
      }
    }

    this.appStateService.updateState((prev) => ({
      profileList: nextList.length ? nextList : undefined,
    }))
  }

  protected async refreshProfileList(
    crate: Record<string, any> | undefined,
  ): Promise<void> {
    if (!crate) {
      this.appStateService.profileList = undefined
      return
    }

    const conformsToIds = this.extractAllConformsToIds(crate)
    if (conformsToIds.length === 0) {
      this.appStateService.profileList = undefined
      return
    }

    const allSchemas = await this.schemaManagerService.loadAllSchemas()
    const profileListItems: Array<{ id: string; content: Record<string, any>; flag: string }> = []

    for (const conformsToUrl of conformsToIds) {
      const matchingSchema = allSchemas.find(
        (schema) => schema.conformsTo === conformsToUrl,
      )
      if (!matchingSchema) {
        console.warn('No schema found for conformsTo URL:', conformsToUrl)
        continue
      }
      try {
        const convertedContent = await this.schemaManagerService.getConvertedProfileContent(
          matchingSchema.files.convertedPath,
        )
        if (convertedContent) {
          profileListItems.push({
            id: conformsToUrl,
            content: convertedContent,
            flag: '',
          })
        } else {
          console.warn('Invalid profile content for conformsTo URL:', conformsToUrl)
        }
      } catch (error) {
        console.warn('Failed to load profile for conformsTo URL:', conformsToUrl, error)
      }
    }

    this.appStateService.updateState((prev) => ({
      profileList: profileListItems.length ? profileListItems : undefined,
    }))
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

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
    AROMA_IGNORE_DIR,
    AROMA_IGNORE_FILE,
    DEFAULT_IGNORED_ENTRIES,
    RO_CRATE_PREVIEW_FILE,
} from 'aroma2-common/lib/common/ro-crate-technical-files'
import {
    AppStatePreferences,
    ROCrateExternalChangeAction,
    type ROCrateExternalChangeActionValue,
} from '../../common/app-state-preferences'
import {
    collectRoCrateChangedProperties,
    maintainRoCrateApprovalFile,
    parseRoCrateApprovalFile,
    RO_CRATE_APPROVAL_FILE,
    RO_CRATE_APPROVAL_FILE_NAME,
    type RoCrateApprovalFile,
} from './ro-crate-approval'
import { AppStateService } from './app-state-service'
import { RoCrateHistoryService } from './ro-crate-history-service'
import { ROCrateDialog } from './ro-crate-dialog'
import { RoCrateIdConversionDialog } from './ro-crate-id-conversion-dialog'

// import { loadInitialCrateAndProfile } from './initial-state-loader'

const REMOTE_RO_CRATE_CONVERSION_COMMAND_ID = 'RemoteRoCrateConversion.command'

@injectable()
export class RoCrateLoaderContribution implements FrontendApplicationContribution {
    @inject(AppStateService)
    protected readonly appStateService: AppStateService

    @inject(RoCrateHistoryService)
    protected readonly roCrateHistoryService: RoCrateHistoryService

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
    protected externalMetadataPromptInFlight?: string

    protected pendingAppStateProfileRefresh?: ReturnType<typeof setTimeout>
    protected pendingAppStateProfileRefreshCrate?: Record<string, any>
    protected lastObservedConformsToKey = ''
    protected perfSeq = 0

    /**
     * Critical: lets us distinguish between:
     * - "startup: roots not ready yet" (do NOT wipe restored state)
     * - "workspace was open, then got closed" (OK to clear state)
     */
    protected hadWorkspaceRoots = false

    protected nowMs(): number {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now()
        }
        return Date.now()
    }

    protected logPerf(event: string, payload: Record<string, unknown>): void {
        console.info(`[ro-crate-loader:perf] ${event}`, payload)
    }

    async onStart(app: FrontendApplication): Promise<void> {
        await this.appStateService.ready

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

        await this.syncRoCrateFromWorkspace()

        // If roots were not ready yet, sync exited early and preserved restored state,
        // so we refresh profiles here. If roots were available, sync already did it.
        if (!this.hadWorkspaceRoots) {
            await this.refreshProfileList(this.appStateService.roCrate)
            await this.refreshCompleteProfile(this.appStateService.roCrate)
        }

        this.watchSchemaChanges()
        this.watchAppStateCrateChanges()

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

    public async revertToSavedRoCrate(): Promise<boolean> {
        const roots = this.workspaceService.tryGetRoots()
        const rootUri = roots?.[0]?.resource
        if (!rootUri) {
            return false
        }

        this.ensureMetadataWatch(rootUri)

        const roCrateUri = rootUri.resolve('ro-crate-metadata.json')
        const exists = await this.fileService.exists(roCrateUri)
        if (!exists) {
            this.updateState(undefined, false)
            await this.refreshProfileList(undefined)
            await this.refreshCompleteProfile(undefined)
            void this.promptForCrateRecovery(rootUri, false)
            return false
        }

        try {
            const crate = await this.loadRoCrateWithNormalization(roCrateUri)
            const approval = await this.loadRoCrateApprovalForMetadata(roCrateUri)
            const changed = this.applyRevertedState(crate, approval)
            await this.refreshProfileList(crate)
            await this.refreshCompleteProfile(crate)
            return changed
        } catch (parseError) {
            console.error('Parsing error: ', parseError)
            this.updateState(undefined, true)
            await this.refreshProfileList(undefined)
            await this.refreshCompleteProfile(undefined)
            void this.promptForCrateRecovery(rootUri, true)
            return false
        }
    }

    protected async syncRoCrateFromWorkspace(): Promise<void> {
        const startedAt = this.nowMs()
        const seq = ++this.perfSeq
        const roots = this.workspaceService.tryGetRoots()
        const rootCount = roots?.length ?? 0

        try {
            if (!roots || roots.length === 0) {
                this.disposeMetadataWatch()
                if (this.hadWorkspaceRoots) {
                    this.updateState(undefined, false)
                    this.appStateService.ignoreList = undefined
                    this.appStateService.setIgnoreListSnapshot(undefined)
                    await this.refreshProfileList(undefined)
                    await this.refreshCompleteProfile(undefined)
                }
                return
            }

            this.hadWorkspaceRoots = true

            const rootUri = roots[0].resource
            this.ensureMetadataWatch(rootUri)
            await this.syncIgnoredEntriesFromWorkspace(rootUri)

            try {
                const roCrateUri = rootUri.resolve('ro-crate-metadata.json')
                const exists = await this.fileService.exists(roCrateUri)

                if (exists) {
                    try {
                        const crate = await this.loadRoCrateWithNormalization(roCrateUri)
                        const approval = await this.loadRoCrateApprovalForMetadata(roCrateUri)
                        this.updateState(crate, false, approval)
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

                this.updateState(undefined, false)
                await this.refreshProfileList(undefined)
                await this.refreshCompleteProfile(undefined)
                void this.promptForCrateRecovery(rootUri, false)
            } catch (error) {
                this.updateState(undefined, true)
                await this.refreshProfileList(undefined)
                await this.refreshCompleteProfile(undefined)
            }
        } finally {
            this.logPerf('sync-workspace', {
                seq,
                totalMs: Number((this.nowMs() - startedAt).toFixed(2)),
                rootCount,
                hadWorkspaceRoots: this.hadWorkspaceRoots,
            })
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
            this.messageService,
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
            const approval = await this.loadRoCrateApprovalForMetadata(roCrateUri)
            this.updateState(crate, false, approval)
            await this.refreshProfileList(crate)
            await this.refreshCompleteProfile(crate)
        } catch (error) {
            this.updateState(undefined, true)
            await this.refreshProfileList(undefined)
            await this.refreshCompleteProfile(undefined)
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

        try {
            const maybePromise = dialog.open()
            if (maybePromise && typeof (maybePromise as any).then === 'function') {
                ;(maybePromise as Promise<boolean>)
                    .then((shouldConvert) => {
                        if (!shouldConvert) {
                            return
                        }
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
                    })
                    .catch((err) => {
                        console.error('RoCrateIdConversionDialog failed:', err)
                    })
            } else {
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
            console.error('Failed to open RoCrateIdConversionDialog:', err)
        }

        return crate
    }

    private needsIdConversion(crate: Record<string, any>): boolean {
        const arpPid = this.getRootArpPid(crate)
        if (!arpPid) {
            return false
        }

        const graph = Array.isArray(crate?.['@graph']) ? crate['@graph'] : []
        for (const entry of graph) {
            if (!entry || typeof entry !== 'object') continue

            const rawType = (entry as any)['@type']
            const types: string[] = Array.isArray(rawType)
                ? rawType.filter((t): t is string => typeof t === 'string')
                : typeof rawType === 'string'
                    ? [rawType]
                    : []

            const relevant = types.some((t) => t === 'File' || t === 'Dataset')
            if (!relevant) continue

            const id =
                typeof (entry as any)['@id'] === 'string' ? (entry as any)['@id'].trim() : ''
            if (!id) {
                continue
            }

            if (types.includes('Dataset') && (id === './' || id === '.')) {
                continue
            }

            if (this.isArpLocalEntityId(id, arpPid)) {
                return true
            }
        }
        return false
    }

    private getRootArpPid(crate: Record<string, any>): string | undefined {
        const rootDataset = this.getRootDataset(crate)
        const arpPid =
            rootDataset && typeof rootDataset['@arpPid'] === 'string'
                ? rootDataset['@arpPid'].trim()
                : ''
        return arpPid || undefined
    }

    private isArpLocalEntityId(id: string, arpPid: string): boolean {
        const trimmedId = id.trim()
        if (!trimmedId || !arpPid) {
            return false
        }

        const prefix = `https://w3id.org/arp/ro-id/${arpPid}/file/`
        return trimmedId.startsWith(prefix) && trimmedId.length > prefix.length
    }

    private getRootDataset(crate: Record<string, any>): Record<string, any> | undefined {
        const graph = Array.isArray(crate?.['@graph']) ? crate['@graph'] : []
        return graph.find((entry) => {
            if (!entry || typeof entry !== 'object') {
                return false
            }

            const id = typeof (entry as any)['@id'] === 'string' ? (entry as any)['@id'].trim() : ''
            const rawType = (entry as any)['@type']
            const types: string[] = Array.isArray(rawType)
                ? rawType.filter((t): t is string => typeof t === 'string')
                : typeof rawType === 'string'
                    ? [rawType]
                    : []

            return (id === './' || id === '.') && types.includes('Dataset')
        }) as Record<string, any> | undefined
    }

    private updateState(
        content: Record<string, any> | undefined,
        isInvalid: boolean,
        roCrateApproval?: RoCrateApprovalFile,
    ): void {
        this.roCrateHistoryService.clear()
        this.lastObservedConformsToKey = this.buildConformsToKey(content)
        this.appStateService.roCrate = content
        this.appStateService.roCrateApproval = content ? roCrateApproval : undefined
        this.appStateService.isROCrateInvalid = isInvalid
        this.appStateService.setRoCrateSnapshot(content)
        this.appStateService.dirty = false
        this.lastKnownMetadataJson = this.normalizeCrate(content)
    }

    private applyRevertedState(
        content: Record<string, any>,
        roCrateApproval?: RoCrateApprovalFile,
    ): boolean {
        this.lastObservedConformsToKey = this.buildConformsToKey(content)
        const changed = this.roCrateHistoryService.applyRoCrateChange(content, {
            label: 'Revert to saved RO-Crate',
            trackHistory: true,
        })
        this.appStateService.roCrateApproval = roCrateApproval
        this.appStateService.isROCrateInvalid = false
        this.appStateService.setRoCrateSnapshot(content)
        this.appStateService.dirty = false
        this.lastKnownMetadataJson = this.normalizeCrate(content)
        return changed
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

        if (action === 'off') {
            this.lastKnownMetadataJson = normalized
            return
        }

        if (action === 'auto') {
            this.messageService.info(
                'ro-crate-metadata.json changed outside the application. Reloading.',
            )
            await this.reloadExternalCrate(metadataUri)
            return
        }

        if (this.externalMetadataPromptInFlight === normalized) {
            return
        }

        this.externalMetadataPromptInFlight = normalized
        try {
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
                return
            }
            if (choice === 'Ignore') {
                await this.discardExternalCrateChange(metadataUri)
            }
        } finally {
            if (this.externalMetadataPromptInFlight === normalized) {
                this.externalMetadataPromptInFlight = undefined
            }
        }
    }

    protected async discardExternalCrateChange(metadataUri: URI): Promise<void> {
        const crate = this.appStateService.roCrate
        if (!crate) {
            this.messageService.warn(
                'Cannot ignore external ro-crate-metadata.json changes because no RO-Crate is loaded.',
            )
            return
        }

        try {
            const approval = this.appStateService.roCrateApproval
            const previewUri = metadataUri.parent.resolve(RO_CRATE_PREVIEW_FILE)

            this.lastKnownMetadataJson = this.normalizeCrate(crate)
            await this.fileService.create(metadataUri, JSON.stringify(crate, null, 2), {
                overwrite: true,
            })
            await this.writeRoCrateApprovalFile(metadataUri, approval)
            await this.deleteLegacyRoCrateApprovalFile(metadataUri)
            const htmlContent = this.roCrateHtmlGenerator.generate(crate)
            await this.fileService.create(previewUri, htmlContent, { overwrite: true })
        } catch (error) {
            console.error('Failed to ignore external RO-Crate change:', error)
            this.messageService.error(
                'Failed to restore ro-crate-metadata.json after ignoring external changes.',
            )
        }
    }

    protected async reloadExternalCrate(metadataUri: URI): Promise<void> {
        try {
            const crate = await this.loadRoCrateWithNormalization(metadataUri)
            const approval = await this.maintainApprovalForExternalCrateChange(
                metadataUri,
                crate,
            )
            this.updateState(crate, false, approval)
            await this.refreshProfileList(crate)
            await this.refreshCompleteProfile(crate)
        } catch (error) {
            console.error('Failed to reload RO-Crate after external change:', error)
            this.messageService.error(
                'Failed to reload ro-crate-metadata.json after external change.',
            )
        }
    }

    protected async maintainApprovalForExternalCrateChange(
        metadataUri: URI,
        nextCrate: Record<string, any>,
    ): Promise<RoCrateApprovalFile> {
        const changedProperties = collectRoCrateChangedProperties(
            this.appStateService.roCrate,
            nextCrate,
        )

        const existing = await this.loadRoCrateApprovalForMetadata(metadataUri)
        const nextApproval = maintainRoCrateApprovalFile(existing, changedProperties)

        await this.writeRoCrateApprovalFile(metadataUri, nextApproval)
        return nextApproval
    }

    protected async loadRoCrateApprovalForMetadata(
        metadataUri: URI,
    ): Promise<RoCrateApprovalFile | undefined> {
        const approvalUri = this.getRoCrateApprovalUri(metadataUri)
        const approval = await this.readRoCrateApprovalFile(approvalUri)
        if (approval) {
            await this.deleteLegacyRoCrateApprovalFile(metadataUri)
            return approval
        }

        const legacyApprovalUri = this.getLegacyRoCrateApprovalUri(metadataUri)
        const legacyApproval = await this.readRoCrateApprovalFile(legacyApprovalUri)
        if (!legacyApproval) {
            return undefined
        }

        await this.writeRoCrateApprovalFile(metadataUri, legacyApproval)
        await this.deleteLegacyRoCrateApprovalFile(metadataUri)
        return legacyApproval
    }

    protected getRoCrateApprovalUri(metadataUri: URI): URI {
        return metadataUri.parent.resolve(RO_CRATE_APPROVAL_FILE)
    }

    protected getLegacyRoCrateApprovalUri(metadataUri: URI): URI {
        return metadataUri.parent.resolve(RO_CRATE_APPROVAL_FILE_NAME)
    }

    protected async writeRoCrateApprovalFile(
        metadataUri: URI,
        approval: RoCrateApprovalFile | undefined,
    ): Promise<void> {
        const approvalUri = this.getRoCrateApprovalUri(metadataUri)
        const approvalDirUri = approvalUri.parent
        if (!(await this.fileService.exists(approvalDirUri))) {
            await this.fileService.createFolder(approvalDirUri)
        }
        await this.fileService.create(approvalUri, JSON.stringify(approval ?? [], null, 2), {
            overwrite: true,
        })
    }

    protected async deleteLegacyRoCrateApprovalFile(metadataUri: URI): Promise<void> {
        const legacyApprovalUri = this.getLegacyRoCrateApprovalUri(metadataUri)
        try {
            if (await this.fileService.exists(legacyApprovalUri)) {
                await this.fileService.delete(legacyApprovalUri)
            }
        } catch (error) {
            console.warn('Failed to remove legacy root-level ro-crate-approval.json:', error)
        }
    }

    protected async readRoCrateApprovalFile(
        approvalUri: URI,
    ): Promise<RoCrateApprovalFile | undefined> {
        try {
            const exists = await this.fileService.exists(approvalUri)
            if (!exists) {
                return undefined
            }
            const content = await this.fileService.read(approvalUri)
            const parsed = JSON.parse(content.value)
            return parseRoCrateApprovalFile(parsed)
        } catch (error) {
            console.warn('Failed to read ro-crate-approval.json:', error)
            return undefined
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
        const startedAt = this.nowMs()
        const profileListCount = Array.isArray(this.appStateService.profileList)
            ? this.appStateService.profileList.length
            : 0
        let mergeAttemptCount = 0

        try {
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
                mergeAttemptCount += 1

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
        } finally {
            this.logPerf('refresh-complete-profile', {
                totalMs: Number((this.nowMs() - startedAt).toFixed(2)),
                graphEntityCount: Array.isArray(crate?.['@graph']) ? crate['@graph'].length : 0,
                profileListCount,
                mergeAttemptCount,
            })
        }
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

    protected async loadSchemasByConformsTo(): Promise<Map<string, any>> {
        const allSchemas = await this.schemaManagerService.loadAllSchemas()
        const byConformsTo = new Map<string, any>()
        for (const schema of allSchemas) {
            const conformsTo = (schema?.conformsTo ?? '').trim()
            if (!conformsTo || byConformsTo.has(conformsTo)) {
                continue
            }
            byConformsTo.set(conformsTo, schema)
        }
        return byConformsTo
    }

    protected async updateProfileListIncrementally(
        crate: Record<string, any> | undefined,
    ): Promise<void> {
        const startedAt = this.nowMs()
        const prevProfileCount = Array.isArray(this.appStateService.profileList)
            ? this.appStateService.profileList.length
            : 0
        let missingCount = 0
        let nextProfileCount = 0

        try {
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

            const prevById = new Map<
                string,
                { id: string; content: Record<string, any> | undefined; flag: string }
            >()
            for (const item of prevList as any[]) {
                const id = typeof item?.id === 'string' ? item.id.trim() : ''
                if (id) {
                    prevById.set(id, item)
                }
            }

            const missingIds: string[] = []
            const nextList: Array<{
                id: string
                content: Record<string, any> | undefined
                flag: string
            }> = []

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
            missingCount = missingIds.length

            if (missingIds.length !== 0) {
                const schemasByConformsTo = await this.loadSchemasByConformsTo()
                const loadedMissing = await Promise.all(
                    missingIds.map(async (id) => {
                        const matchingSchema = schemasByConformsTo.get(id)
                        if (!matchingSchema) {
                            console.warn('No schema found for conformsTo URL:', id)
                            return undefined
                        }
                        try {
                            const convertedContent = await this.schemaManagerService.getConvertedProfileContent(
                                matchingSchema.files.convertedPath,
                            )
                            if (!convertedContent) {
                                console.warn('Invalid profile content for conformsTo URL:', id)
                                return undefined
                            }
                            return {
                                id,
                                content: convertedContent,
                                flag: '',
                            }
                        } catch (error) {
                            console.warn('Failed to load profile for conformsTo URL:', id, error)
                            return undefined
                        }
                    }),
                )
                for (const loadedItem of loadedMissing) {
                    if (loadedItem) {
                        nextList.push(loadedItem)
                    }
                }
            }

            nextProfileCount = nextList.length
            this.appStateService.updateState((prev) => ({
                profileList: nextList.length ? nextList : undefined,
            }))
        } finally {
            this.logPerf('update-profile-list-incremental', {
                totalMs: Number((this.nowMs() - startedAt).toFixed(2)),
                graphEntityCount: Array.isArray(crate?.['@graph']) ? crate['@graph'].length : 0,
                prevProfileCount,
                missingCount,
                nextProfileCount,
            })
        }
    }

    protected async refreshProfileList(
        crate: Record<string, any> | undefined,
    ): Promise<void> {
        const startedAt = this.nowMs()
        let conformsToCount = 0
        let loadedSchemaCount = 0

        try {
            if (!crate) {
                this.appStateService.profileList = undefined
                return
            }

            const conformsToIds = this.extractAllConformsToIds(crate)
            conformsToCount = conformsToIds.length
            if (conformsToIds.length === 0) {
                this.appStateService.profileList = undefined
                return
            }

            const schemasByConformsTo = await this.loadSchemasByConformsTo()
            const profileListItems: Array<{
                id: string
                content: Record<string, any> | undefined
                flag: string
            }> = []

            const loadedProfiles = await Promise.all(
                conformsToIds.map(async (conformsToUrl) => {
                    const matchingSchema = schemasByConformsTo.get(conformsToUrl)
                    if (!matchingSchema) {
                        console.warn('No schema found for conformsTo URL:', conformsToUrl)
                        if (conformsToUrl.includes('schema')) {
                            return {
                                id: conformsToUrl,
                                content: undefined,
                                flag: 'missing',
                            }
                        }
                        return undefined
                    }
                    try {
                        const convertedContent = await this.schemaManagerService.getConvertedProfileContent(
                            matchingSchema.files.convertedPath,
                        )
                        if (!convertedContent) {
                            console.warn('Invalid profile content for conformsTo URL:', conformsToUrl)
                            return undefined
                        }
                        return {
                            id: conformsToUrl,
                            content: convertedContent,
                            flag: '',
                        }
                    } catch (error) {
                        console.warn('Failed to load profile for conformsTo URL:', conformsToUrl, error)
                        return undefined
                    }
                }),
            )

            for (const loadedProfile of loadedProfiles) {
                if (!loadedProfile) {
                    continue
                }
                profileListItems.push(loadedProfile)
                if (loadedProfile.content) {
                    loadedSchemaCount += 1
                }
            }

            this.appStateService.updateState((prev) => ({
                profileList: profileListItems.length ? profileListItems : undefined,
            }))
        } finally {
            this.logPerf('refresh-profile-list', {
                totalMs: Number((this.nowMs() - startedAt).toFixed(2)),
                graphEntityCount: Array.isArray(crate?.['@graph']) ? crate['@graph'].length : 0,
                conformsToCount,
                loadedSchemaCount,
            })
        }
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

    protected async syncIgnoredEntriesFromWorkspace(rootUri: URI): Promise<void> {
        const ignoredUri = rootUri.resolve(AROMA_IGNORE_DIR).resolve(AROMA_IGNORE_FILE)
        const current = await this.readIgnoredEntries(ignoredUri)
        const next = this.withDefaultIgnoredEntries(current)
        this.appStateService.ignoreList = next.length ? next : undefined
        this.appStateService.setIgnoreListSnapshot(next.length ? next : undefined)
    }

    protected async readIgnoredEntries(ignoreFileUri: URI): Promise<string[]> {
        try {
            const content = await this.fileService.read(ignoreFileUri)
            const text = `${content.value ?? ''}`
            return text
                .split(/\r?\n/g)
                .map((line) => this.normalizeIgnoredEntry(line))
                .filter((line): line is string => Boolean(line))
        } catch {
            return []
        }
    }

    protected withDefaultIgnoredEntries(entries: readonly string[]): string[] {
        const normalizedEntries = entries
            .map((entry) => this.normalizeIgnoredEntry(entry))
            .filter((entry): entry is string => Boolean(entry))

        const defaults = DEFAULT_IGNORED_ENTRIES.map((entry) =>
            this.normalizeIgnoredEntry(entry),
        ).filter((entry): entry is string => Boolean(entry))

        const existingPositive = new Set(
            normalizedEntries.filter((entry) => !entry.startsWith('!')),
        )
        const missingDefaults = defaults.filter((entry) => !existingPositive.has(entry))
        if (!missingDefaults.length) {
            return normalizedEntries
        }
        return [...missingDefaults, ...normalizedEntries]
    }

    protected normalizeIgnoredEntry(value: string): string | undefined {
        const trimmed = (value || '').trim()
        if (!trimmed || trimmed.startsWith('#')) {
            return undefined
        }

        const negated = trimmed.startsWith('!')
        let normalized = negated ? trimmed.slice(1) : trimmed
        normalized = normalized.replace(/\\/g, '/')
        normalized = normalized.replace(/^\.\//, '')
        normalized = normalized.replace(/^\/+/, '')
        normalized = normalized.replace(/\/{2,}/g, '/')
        const isDirectory = normalized.endsWith('/')
        if (isDirectory) {
            normalized = normalized.replace(/\/+$/, '')
        }
        if (!normalized) {
            return undefined
        }
        return `${negated ? '!' : ''}${normalized}${isDirectory ? '/' : ''}`.toLowerCase()
    }
}

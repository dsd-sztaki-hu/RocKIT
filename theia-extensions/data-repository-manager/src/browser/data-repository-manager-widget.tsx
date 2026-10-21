// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import {
  BaseWidget,
  Message,
  OpenerService,
  StatefulWidget,
  open,
} from '@theia/core/lib/browser'
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs'
import { ApplicationServer } from '@theia/core/lib/common/application-protocol'
import { DisposableCollection } from '@theia/core/lib/common/disposable'
import { MessageService } from '@theia/core/lib/common/message-service'
import { nls } from '@theia/core/lib/common/nls'
import URI from '@theia/core/lib/common/uri'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateLoaderContribution } from 'app-state/lib/browser/state/ro-crate-loader'
import { inject, injectable } from 'inversify'
import * as React from 'react'
import { createRoot, Root } from 'react-dom/client'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import {
  buildDocumentationUrl,
  ROCKIT_DOCUMENTATION_PAGES,
} from 'rockit-common/lib/browser'
import { LoadMaskService } from 'rockit-loadmask/lib/browser/loadmask-service'
import { ArpRoCrateImportDialog } from './components/arp-ro-crate-import-dialog'
import { ArpRoCrateValidationErrorsDialog } from './components/arp-ro-crate-validation-errors-dialog'
import { DataRepositoryConfigDialog } from './components/data-repository-config-dialog'
import { DataRepositoryDeleteDialog } from './components/data-repository-delete-dialog'
import {
  DataRepositoryExportDeleteDialog,
  DataRepositoryExportDeleteErrorDialog,
  ExportDeleteAction,
} from './components/data-repository-export-delete-dialog'
import { DataRepositorySelectorDialog } from './components/data-repository-selector-dialog'
import { DataRepositoryTable } from './components/data-repository-table'
import { DataRepositoryToolbar } from './components/data-repository-toolbar'
import { DataverseCollectionBrowserDialog } from './components/dataverse-collection-browser-dialog'
import { NativeDataverseDatasetMetadataDialog } from './components/native-dataverse-dataset-metadata-dialog'
import { RepositorySyncOptionsDialog } from './components/repository-sync-options-dialog'
import { RepositoryOperation } from './repository-provider-registry'
import { RepositoryProviderService } from './repository-provider-service'
import { CrosswalkRegistry } from 'crosswalk-manager/lib/browser/crosswalk-registry'
import {
  ArpRoCrateExportService,
  ArpRoCrateValidationError,
  ArpProviderCreateResult,
  ArpProviderCreateValidationResult,
} from './services/arp-ro-crate-export-service'
import {
  ArpProviderImportDownload,
  ArpRoCrateImportService,
} from './services/arp-ro-crate-import-service'
import { ArpRoCrateLinkService } from './services/arp-ro-crate-link-service'
import { DataRepositoryExportDeleteService } from './services/data-repository-export-delete-service'
import { DataRepositoryStoreService } from './services/data-repository-store-service'
import { DataverseCapabilityService } from './services/dataverse-capability-service'
import { DataverseCollectionService } from './services/dataverse-collection-service'
import { DataverseService } from './services/dataverse-service'
import {
  DataverseProviderCreateResult,
  NativeDataverseDatasetMetadata,
  NativeDataverseExportService,
} from './services/native-dataverse-export-service'
import { NativeDataverseImportService } from './services/native-dataverse-import-service'
import type {
  DataRepositoryCapabilities,
  DataRepositoryImportProgress,
  DataRepositorySelection,
  RepositorySyncMode,
} from './types'
import { DataRepositoryConfig, DataRepositoryExportTarget } from './types'
import './styles/index.css'

export const DATA_REPOSITORY_MANAGER_WIDGET_ID = 'data-repository-manager:widget'
export const DATA_REPOSITORY_MANAGER_LABEL = nls.localize(
  'rockit/dataRepository/title',
  'Data Repository Manager',
)

@injectable()
export class DataRepositoryManagerWidget extends BaseWidget implements StatefulWidget {
  static readonly ID = DATA_REPOSITORY_MANAGER_WIDGET_ID
  static readonly LABEL = DATA_REPOSITORY_MANAGER_LABEL

  private reactRoot: Root | undefined
  protected repositories: DataRepositoryConfig[] = []
  protected isLoading = true
  protected selectedKeys: React.Key[] = []
  protected recentArpValidationError: ArpRoCrateValidationError | undefined
  protected readonly disposables = new DisposableCollection()

  constructor(
    @inject(MessageService) protected readonly messageService: MessageService,
    @inject(DataRepositoryStoreService)
    protected readonly storeService: DataRepositoryStoreService,
    @inject(DataRepositoryExportDeleteService)
    protected readonly exportDeleteService: DataRepositoryExportDeleteService,
    @inject(DataverseService) protected readonly dataverseService: DataverseService,
    @inject(DataverseCollectionService)
    protected readonly collectionService: DataverseCollectionService,
    @inject(NativeDataverseExportService)
    protected readonly nativeExportService: NativeDataverseExportService,
    @inject(ArpRoCrateExportService)
    protected readonly arpExportService: ArpRoCrateExportService,
    @inject(ArpRoCrateImportService)
    protected readonly arpImportService: ArpRoCrateImportService,
    @inject(ArpRoCrateLinkService)
    protected readonly arpLinkService: ArpRoCrateLinkService,
    @inject(NativeDataverseImportService)
    protected readonly nativeImportService: NativeDataverseImportService,
    @inject(DataverseCapabilityService)
    protected readonly capabilityService: DataverseCapabilityService,
    @inject(LoadMaskService)
    protected readonly loadMaskService: LoadMaskService,
    @inject(AppStateService)
    protected readonly appStateService: AppStateService,
    @inject(RoCrateLoaderContribution)
    protected readonly roCrateLoader: RoCrateLoaderContribution,
    @inject(OpenerService)
    protected readonly openerService: OpenerService,
    @inject(ApplicationServer)
    protected readonly applicationServer: ApplicationServer,
    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService,
    @inject(RepositoryProviderService)
    protected readonly providerService: RepositoryProviderService,
    @inject(CrosswalkRegistry)
    protected readonly crosswalkRegistryService: CrosswalkRegistry,
  ) {
    super()
    this.id = DATA_REPOSITORY_MANAGER_WIDGET_ID
    this.title.label = DATA_REPOSITORY_MANAGER_LABEL
    this.title.caption = DATA_REPOSITORY_MANAGER_LABEL
    this.title.closable = true
    this.title.iconClass = 'fa fa-database'

    this.disposables.push(this.storeService.onDidChange(() => this.loadData()))
  }

  protected async loadData() {
    this.isLoading = true
    this.selectedKeys = [] // Reset selection on load
    this.update()
    try {
      this.repositories = await this.storeService.loadRepositories()
    } catch (e) {
      console.error(e)
    } finally {
      this.isLoading = false
      this.update()
    }
  }

  protected showTargetNotification(
    message: string,
    target: string,
    timeout: number,
  ): void {
    const targetUrl = this.externalTargetUrl(target)
    if (!targetUrl) {
      void this.messageService.info(message, { timeout })
      return
    }
    const openDataset = nls.localize('rockit/dataRepository/openDataset', 'Open dataset')
    void this.messageService
      .info(message, { timeout }, openDataset)
      .then((action) => {
        if (action === openDataset) {
          return open(this.openerService, new URI(targetUrl), { openExternalApp: true })
        }
        return undefined
      })
      .catch((error) =>
        console.error(`Failed to open dataset URL '${targetUrl}'.`, error),
      )
  }

  protected externalTargetUrl(target: string): string | undefined {
    const trimmed = target.trim()
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed
    }
    if (/^hdl:/i.test(trimmed)) {
      return `https://hdl.handle.net/${trimmed.slice('hdl:'.length)}`
    }
    if (/^[^\s/:]+(?:\.[^\s/:]+)*\/\S+$/.test(trimmed)) {
      return `https://hdl.handle.net/${trimmed}`
    }
    return undefined
  }

  protected handleSelectionChange = (keys: React.Key[]) => {
    this.selectedKeys = keys
    this.update() // Trigger React re-render
  }

  protected handleImport = () => {
    void this.handleImportFromRemote()
  }

  public async handleImportFromRemote(
    repositorySelection?: DataRepositorySelection,
  ): Promise<void> {
    if (!repositorySelection) {
      const repositories = await this.storeService.loadRepositories()
      this.repositories = repositories
      this.update()

      const selector = new DataRepositorySelectorDialog(
        repositories,
        this.storeService,
        this.dataverseService,
        this.capabilityService,
        this.providerService,
      this.crosswalkRegistryService,
        this.hasOpenWorkspace(),
      )
      repositorySelection = await selector.open()
      if (!repositorySelection) {
        return
      }
    }

    const selectedRepo = repositorySelection.repository
    const capabilities = repositorySelection.capabilities
    if (!selectedRepo) {
      return
    }
    if (selectedRepo.providerId) {
      const provider = this.providerService.getProviderForRepository(selectedRepo)
      const importInput = provider?.importInput
      const importDialog = new ArpRoCrateImportDialog({
        title:
          importInput?.title ??
          nls.localize(
            'rockit/dataRepository/importRepositoryRecord',
            'Import Repository Record',
          ),
        description:
          importInput?.description ??
          nls.localize(
            'rockit/dataRepository/importRepositoryRecordDescription',
            'Enter the URL of the remote repository record to import.',
          ),
        placeholder: importInput?.placeholder,
        fieldLabel:
          importInput?.fieldLabel ??
          nls.localize('rockit/dataRepository/recordUrl', 'Record URL'),
      })
      const importDialogInput = await importDialog.open()
      if (!importDialogInput) {
        return
      }
      if (selectedRepo.providerId === 'arp') {
        await this.handlePluginArpImport(selectedRepo, importDialogInput.datasetUrl)
        return
      }
      await this.executePluginRepositoryOperation(selectedRepo, 'import', {
        repository: selectedRepo,
        recordUrl: importDialogInput.datasetUrl,
      })
      return
    }
    if (!capabilities) {
      return
    }
    if (!capabilities.supportsNativeDataverseApi) {
      this.messageService.warn(
        nls.localize(
          'rockit/dataRepository/importUnsupported',
          "Import is not implemented for '{0}' because it does not expose a supported Dataverse API.",
          selectedRepo.title,
        ),
        { timeout: 10000 },
      )
      return
    }
    const importDialog = new ArpRoCrateImportDialog(
      capabilities.supportsArpRoCrateZipUpload
        ? undefined
        : {
            title: nls.localize(
              'rockit/dataRepository/importDataset',
              'Import Dataverse Dataset',
            ),
            description: nls.localize(
              'rockit/dataRepository/importDatasetDescription',
              'Enter the dataset persistent ID or dataset URL for the Dataverse dataset to import.',
            ),
            placeholder: 'doi:10.70122/FK2/N2XGBJ',
          },
    )
    const importInput = await importDialog.open()
    if (!importInput) {
      return
    }

    const progress = await this.loadMaskService.showProgress({
      text: nls.localize(
        'rockit/dataRepository/importingFrom',
        'Importing dataset from {0}...',
        selectedRepo.title,
      ),
    })
    const reportImportProgress = (update: DataRepositoryImportProgress): void =>
      progress.report({
        message: update.message,
        work: {
          done: update.completedSteps,
          total: update.totalSteps,
        },
      })
    try {
      const result = capabilities.supportsArpRoCrateZipUpload
        ? await this.arpImportService.importFromDatasetUrl(
            selectedRepo,
            importInput.datasetUrl,
            reportImportProgress,
          )
        : await this.nativeImportService.importFromDatasetUrl(
            selectedRepo,
            importInput.datasetUrl,
            reportImportProgress,
          )
      if (!result) {
        return
      }
      if ('hasRoCrateMetadata' in result && !result.hasRoCrateMetadata) {
        this.messageService.info(
          nls.localize(
            'rockit/dataRepository/importedWithoutMetadata',
            'Dataverse dataset imported to {0}. Extracted {1} file(s). No ro-crate-metadata.json was included, so the workspace can create one after opening.',
            result.targetDirectory.path.fsPath(),
            result.extractedFileCount,
          ),
          { timeout: 10000 },
        )
      } else {
        this.messageService.info(
          nls.localize(
            'rockit/dataRepository/importedDataset',
            'Dataset imported to {0}. Extracted {1} file(s).',
            result.targetDirectory.path.fsPath(),
            result.extractedFileCount,
          ),
          { timeout: 10000 },
        )
      }
    } catch (error) {
      console.error('Remote dataset import failed:', error)
      this.messageService.error(
        nls.localize(
          'rockit/dataRepository/importFailed',
          'Dataset import failed: {0}',
          error instanceof Error ? error.message : String(error),
        ),
        { timeout: 10000 },
      )
    } finally {
      progress.cancel()
    }
  }

  public async handleLinkLocalToRemote(): Promise<void> {
    const repositories = await this.storeService.loadRepositories()
    this.repositories = repositories
    this.update()

    const linkDialog = new ArpRoCrateImportDialog({
      title: nls.localize(
        'rockit/dataRepository/linkLocalTitle',
        'Link Local Dataset To Remote',
      ),
      description: nls.localize(
        'rockit/dataRepository/linkLocalDescription',
        'Enter the dataset PID or URL where this local RO-Crate already exists in a remote repository.',
      ),
      placeholder: 'https://repo.researchdata.hu/dataset.xhtml?persistentId=hdl:...',
    })
    const linkInput = await linkDialog.open()
    if (!linkInput) {
      return
    }

    let selectedRepo = this.inferRepositoryFromDatasetUrl(
      repositories,
      linkInput.datasetUrl,
    )
    let selectedCapabilities: DataRepositoryCapabilities | undefined
    if (!selectedRepo) {
      const selector = new DataRepositorySelectorDialog(
        repositories,
        this.storeService,
        this.dataverseService,
        this.capabilityService,
        this.providerService,
        this.crosswalkRegistryService,
        this.hasOpenWorkspace(),
      )
      const repositorySelection = await selector.open()
      if (!repositorySelection || !repositorySelection.repository) {
        return
      }
      selectedRepo = repositorySelection.repository
      selectedCapabilities = repositorySelection.capabilities
    } else if (!selectedRepo.providerId) {
      selectedCapabilities = await this.capabilityService.detectRepositoryCapabilities(
        selectedRepo.baseUrl,
        selectedRepo.apiKey,
      )
    }

    try {
      const previewProgress = await this.loadMaskService.showProgress({
        text: nls.localize(
          'rockit/dataRepository/checkingRemoteDataset',
          'Checking remote dataset in {0}...',
          selectedRepo.title,
        ),
      })
      let shouldContinue = true
      try {
        const preview = selectedRepo.providerId
          ? await this.providerService.executeForRepository<
              { repository: DataRepositoryConfig; datasetUrl: string; mode: 'preview' },
              {
                localDatasetTitle?: string
                remoteDatasetTitle?: string
                titleMismatch: boolean
              }
            >(selectedRepo, 'link', {
              repository: selectedRepo,
              datasetUrl: linkInput.datasetUrl,
              mode: 'preview',
            })
          : await this.arpLinkService.previewLocalDatasetLink(
              selectedRepo,
              selectedCapabilities!,
              linkInput.datasetUrl,
            )
        if (!preview) {
          throw new Error('The repository provider did not return a link preview.')
        }
        previewProgress.cancel()
        if (preview.titleMismatch) {
          shouldContinue =
            (await new ConfirmDialog({
              title: nls.localize(
                'rockit/dataRepository/titleMismatchTitle',
                'Dataset Title Mismatch',
              ),
              msg: nls.localize(
                'rockit/dataRepository/titleMismatchMessage',
                'The remote dataset title is different from the local RO-Crate title.\n\nLocal RO-Crate title: {0}\nRemote dataset title: {1}\n\nLinking the wrong dataset can cause future exports to update the wrong remote dataset. Continue?',
                preview.localDatasetTitle ||
                  nls.localize('rockit/dataRepository/missingValue', '(missing)'),
                preview.remoteDatasetTitle ||
                  nls.localize('rockit/dataRepository/missingValue', '(missing)'),
              ),
              ok: nls.localize('rockit/dataRepository/continue', 'Link Anyway'),
              cancel: nls.localize('rockit/common/cancel', 'Cancel'),
            }).open()) ?? false
        }
      } finally {
        previewProgress.cancel()
      }
      if (!shouldContinue) {
        return
      }

      const progress = await this.loadMaskService.showProgress({
        text: nls.localize(
          'rockit/dataRepository/linkingLocalDataset',
          'Linking local dataset to {0}...',
          selectedRepo.title,
        ),
      })
      try {
        const result = selectedRepo.providerId
          ? await this.providerService.executeForRepository<
              { repository: DataRepositoryConfig; datasetUrl: string; mode: 'link' },
              {
                target: string
                mappedEntityCount: number
                mappingFileName: string
                unmappedEntityIds: string[]
              }
            >(selectedRepo, 'link', {
              repository: selectedRepo,
              datasetUrl: linkInput.datasetUrl,
              mode: 'link',
            })
          : await this.arpLinkService.linkLocalDatasetToRemote(
              selectedRepo,
              selectedCapabilities!,
              linkInput.datasetUrl,
            )
        if (!result) {
          throw new Error('The repository provider did not return a link result.')
        }
        this.showTargetNotification(
          nls.localize(
            'rockit/dataRepository/linkedLocalDataset',
            'Linked local dataset to {0}. Wrote {1} entity mapping(s) to .rockit/{2}.',
            result.target,
            result.mappedEntityCount,
            result.mappingFileName,
          ),
          result.target,
          10000,
        )
        if (result.unmappedEntityIds.length) {
          const previewLimit = 15
          const idPreview = result.unmappedEntityIds
            .slice(0, previewLimit)
            .map((id) => `- ${id.length > 80 ? `${id.slice(0, 77)}...` : id}`)
            .join('\n')
          const remainingCount = result.unmappedEntityIds.length - previewLimit
          this.messageService.warn(
            `${nls.localize(
              'rockit/dataRepository/linkUnmappedIds',
              'Remote link created, but {0} entity ID mapping(s) could not be inferred. Empty values were written to .rockit/{1}.',
              result.unmappedEntityIds.length,
              result.mappingFileName,
            )}\n${idPreview}${remainingCount > 0 ? `\n- ${nls.localize('rockit/dataRepository/andMore', '...and {0} more', remainingCount)}` : ''}`,
            { timeout: 10000 },
          )
        }
      } finally {
        progress.cancel()
      }
    } catch (error) {
      console.error('Remote dataset link failed:', error)
      this.messageService.error(
        nls.localize(
          'rockit/dataRepository/datasetLinkFailed',
          'Dataset link failed: {0}',
          error instanceof Error ? error.message : String(error),
        ),
        { timeout: 10000 },
      )
    }
  }

  protected handleExport = () => {
    this.handleExportToRemote()
  }

  public async offerInterruptedExportRecovery(): Promise<void> {
    if (!this.hasOpenWorkspace()) {
      return
    }
    const repositories = await this.storeService.loadRepositories()
    const targetsByRepository = await this.listAllExportTargets(repositories)
    for (const repository of repositories) {
      for (const target of targetsByRepository[repository.id] ?? []) {
        if (target.status !== 'cancelled') {
          continue
        }
        const capabilities = repository.providerId
          ? undefined
          : await this.capabilityService.detectRepositoryCapabilities(
              repository.baseUrl,
              repository.apiKey,
            )
        const resume = await new ConfirmDialog({
          title: nls.localize(
            'rockit/dataRepository/interruptedExport',
            'Interrupted export',
          ),
          msg: nls.localize(
            'rockit/dataRepository/resumeInterruptedExport',
            'The export to {0} was interrupted. Do you want to continue it?',
            target.datasetName || target.target,
          ),
          ok: nls.localize('rockit/dataRepository/continueExport', 'Continue'),
          cancel: nls.localize(
            'rockit/dataRepository/doNotContinueExport',
            'Do not continue',
          ),
        }).open()
        if (resume) {
          await this.handleExportToRemote({
            repository,
            capabilities,
            exportTarget: target,
            action: 'export',
          })
        } else {
          const message = nls.localize(
            'rockit/dataRepository/userDeclinedExportRecovery',
            'User chose not to continue the interrupted export.',
          )
          if (repository.providerId) {
            await this.providerService.executeForRepository(
              repository,
              'markTargetFailed',
              {
                repository,
                exportTarget: target,
                message,
              },
            )
          } else if (capabilities!.supportsArpRoCrateZipUpload) {
            await this.arpExportService.markExportTargetFailed(target, message)
          } else {
            await this.nativeExportService.markExportTargetFailed(target, message)
          }
        }
      }
    }
  }

  public async handleRepositoryOperations(): Promise<void> {
    const repositories = await this.storeService.loadRepositories()
    this.repositories = repositories
    this.update()
    const hasWorkspace = this.hasOpenWorkspace()
    const exportTargetsByRepositoryId = hasWorkspace
      ? await this.listAllExportTargets(repositories)
      : {}

    const selector = new DataRepositorySelectorDialog(
      repositories,
      this.storeService,
      this.dataverseService,
      this.capabilityService,
      this.providerService,
      this.crosswalkRegistryService,
      hasWorkspace,
      exportTargetsByRepositoryId,
      this.recentArpValidationError
        ? () => {
            void this.openRecentArpValidationResponse()
          }
        : undefined,
      async (repository, target, action) =>
        this.handleDeleteExportTarget(repository, target, action),
    )
    const repositorySelection = await selector.open()
    if (!repositorySelection) {
      return
    }
    if (repositorySelection.action === 'link') {
      await this.handleLinkLocalToRemote()
      return
    }
    if (repositorySelection.action === 'import') {
      await this.handleImportFromRemote(repositorySelection)
      return
    }
    await this.handleExportToRemote(repositorySelection)
  }

  public async handleExportToRemote(
    repositorySelection?: DataRepositorySelection,
  ): Promise<void> {
    if (this.hasUnsavedRoCrateChanges()) {
      this.messageService.warn(
        nls.localize(
          'rockit/dataRepository/unsavedExportBlocked',
          'Remote export is not possible while the RO-Crate has unsaved changes. Save the RO-Crate first, then export again.',
        ),
        { timeout: 10000 },
      )
      return
    }

    if (!repositorySelection) {
      const repositories = await this.storeService.loadRepositories()
      this.repositories = repositories
      this.update()
      const exportTargetsByRepositoryId = await this.listAllExportTargets(repositories)

      const selector = new DataRepositorySelectorDialog(
        repositories,
        this.storeService,
        this.dataverseService,
        this.capabilityService,
        this.providerService,
        this.crosswalkRegistryService,
        this.hasOpenWorkspace(),
        exportTargetsByRepositoryId,
        this.recentArpValidationError
          ? () => {
              void this.openRecentArpValidationResponse()
            }
          : undefined,
        async (repository, target, action) =>
          this.handleDeleteExportTarget(repository, target, action),
      )
      repositorySelection = await selector.open()

      if (!repositorySelection) {
        return // User cancelled
      }
      if (repositorySelection.action === 'link') {
        await this.handleLinkLocalToRemote()
        return
      }
      if (repositorySelection.action === 'import') {
        await this.handleImportFromRemote(repositorySelection)
        return
      }
    }
    const selectedRepo = repositorySelection.repository
    const capabilities = repositorySelection.capabilities
    const selectedExportTarget = repositorySelection.exportTarget
    if (!selectedRepo) {
      return
    }

    if (selectedRepo.providerId) {
      const operation: RepositoryOperation =
        repositorySelection.action === 'sync'
          ? 'sync'
          : selectedExportTarget
            ? 'update'
            : 'create'
      if (selectedRepo.providerId === 'arp' && operation === 'create') {
        await this.handlePluginArpCreate(selectedRepo)
        return
      }
      if (selectedRepo.providerId === 'dataverse' && operation === 'create') {
        await this.handlePluginDataverseCreate(selectedRepo)
        return
      }
      if (selectedRepo.providerId === 'arp' && operation === 'update' && selectedExportTarget) {
        await this.handlePluginArpUpdate(selectedRepo, selectedExportTarget)
        return
      }
      if (selectedRepo.providerId === 'arp' && operation === 'sync' && selectedExportTarget) {
        const syncOptions = repositorySelection.syncMode
          ? { metadataMode: repositorySelection.syncMode }
          : await new RepositorySyncOptionsDialog().open()
        if (!syncOptions) return
        await this.handlePluginArpSync(
          selectedRepo, selectedExportTarget, syncOptions.metadataMode)
        return
      }
      await this.executePluginRepositoryOperation(selectedRepo, operation, {
        repository: selectedRepo,
        exportTarget: selectedExportTarget,
        syncMode: repositorySelection.syncMode,
      })
      return
    }

    if (!capabilities) {
      return
    }

    if (!capabilities.supportsNativeDataverseApi) {
      this.messageService.error(
        nls.localize(
          'rockit/dataRepository/unsupportedRepository',
          "Repository '{0}' does not expose a supported Dataverse API.",
          selectedRepo.title,
        ),
        { timeout: 10000 },
      )
      return
    }
    if (
      repositorySelection.action === 'sync' &&
      capabilities.supportsArpRoCrateZipUpload &&
      selectedExportTarget
    ) {
      const syncOptions = repositorySelection.syncMode
        ? { metadataMode: repositorySelection.syncMode }
        : await new RepositorySyncOptionsDialog().open()
      if (!syncOptions) {
        return
      }
      const progress = await this.loadMaskService.showProgress({
        text: nls.localize(
          'rockit/dataRepository/syncingFromRemote',
          'Syncing from {0}...',
          selectedRepo.title,
        ),
      })
      let progressClosed = false
      const closeProgress = (): void => {
        if (!progressClosed) {
          progressClosed = true
          progress.cancel()
        }
      }
      try {
        const syncResult = await this.arpExportService.syncFromArp(
          selectedRepo,
          selectedExportTarget,
          syncOptions,
          (update) =>
            progress.report({
              message: update.message,
              work: {
                done: update.completedSteps,
                total: update.totalSteps,
              },
            }),
        )
        closeProgress()
        await this.roCrateLoader.refresh()
        await this.loadData()
        this.showTargetNotification(
          nls.localize(
            'rockit/dataRepository/arpSyncCompleted',
            'ARP sync completed for {0}. Downloaded {1} new file(s), replaced {2} changed file(s), and kept {3} local-only file(s).',
            syncResult.target,
            syncResult.downloadedFileCount,
            syncResult.replacedFileCount,
            syncResult.removedRemoteFileCount,
          ),
          syncResult.target,
          10000,
        )
        if (syncResult.unmappedEntityIds.length && syncResult.mappingFileName) {
          const previewLimit = 15
          const idPreview = syncResult.unmappedEntityIds
            .slice(0, previewLimit)
            .map((id) => `- ${id.length > 80 ? `${id.slice(0, 77)}...` : id}`)
            .join('\n')
          const remainingCount = syncResult.unmappedEntityIds.length - previewLimit
          this.messageService.warn(
            `${nls.localize('rockit/dataRepository/syncUnmappedIds', 'ARP sync completed, but {0} entity ID mapping(s) could not be inferred. Empty values remain in .rockit/{1}.', syncResult.unmappedEntityIds.length, syncResult.mappingFileName)}\n${idPreview}${remainingCount > 0 ? `\n- ${nls.localize('rockit/dataRepository/andMore', '...and {0} more', remainingCount)}` : ''}`,
            { timeout: 10000 },
          )
        }
      } catch (error) {
        await this.arpExportService.markActiveExportFailed(error)
        console.error('ARP sync failed:', error)
        this.messageService.error(
          nls.localize(
            'rockit/dataRepository/arpSyncFailed',
            'ARP sync failed: {0}',
            error instanceof Error ? error.message : String(error),
          ),
          { timeout: 10000 },
        )
      } finally {
        closeProgress()
      }
      return
    }
    if (
      repositorySelection.action === 'sync' &&
      !capabilities.supportsArpRoCrateZipUpload &&
      selectedExportTarget
    ) {
      const syncOptions = repositorySelection.syncMode
        ? { metadataMode: repositorySelection.syncMode }
        : await new RepositorySyncOptionsDialog().open()
      if (!syncOptions) {
        return
      }
      const progress = await this.loadMaskService.showProgress({
        text: nls.localize(
          'rockit/dataRepository/syncingFromRemote',
          'Syncing from {0}...',
          selectedRepo.title,
        ),
      })
      try {
        const syncResult = await this.nativeExportService.syncFromDataverse(
          selectedRepo,
          selectedExportTarget,
          syncOptions,
          (update) =>
            progress.report({
              message: update.message,
              work: {
                done: update.completedSteps,
                total: update.totalSteps,
              },
            }),
        )
        if (syncResult) {
          await this.roCrateLoader.refresh()
          await this.loadData()
          this.showTargetNotification(
            nls.localize(
              'rockit/dataRepository/dataverseSyncCompleted',
              'Dataverse sync completed for {0}. Downloaded {1} new file(s), replaced {2} changed file(s), and kept {3} unchanged file(s).',
              syncResult.target,
              syncResult.downloadedFileCount,
              syncResult.replacedFileCount,
              syncResult.keptLocalFileCount,
            ),
            syncResult.target,
            12000,
          )
        }
      } catch (error) {
        await this.nativeExportService.markActiveExportFailed(error)
        console.error('Native Dataverse sync failed:', error)
        this.messageService.error(
          nls.localize(
            'rockit/dataRepository/dataverseSyncFailed',
            'Dataverse sync failed: {0}',
            error instanceof Error ? error.message : String(error),
          ),
          { timeout: 10000 },
        )
      } finally {
        progress.cancel()
      }
      return
    }
    if (capabilities.supportsArpRoCrateZipUpload && selectedExportTarget) {
      const progress = await this.loadMaskService.showProgress({
        text: nls.localize(
          'rockit/dataRepository/updatingUploaded',
          'Updating the uploaded RO-Crate in {0}',
          selectedRepo.title,
        ),
      })
      try {
        const updateResult = await this.arpExportService.updateArp(
          selectedRepo,
          selectedExportTarget,
          (update) =>
            progress.report({
              message: update.message,
              work: {
                done: update.completedSteps,
                total: update.totalSteps,
              },
            }),
        )
        if (updateResult) {
          this.showTargetNotification(
            nls.localize(
              'rockit/dataRepository/arpUpdateCompleted',
              'ARP update completed for {0}. Uploaded {1} new file(s), replaced {2} changed file(s), and removed {3} file(s).',
              updateResult.target,
              updateResult.addedFileCount,
              updateResult.changedFileCount,
              updateResult.removedFileCount,
            ),
            updateResult.target,
            10000,
          )
          if (updateResult.unmappedEntityIds.length && updateResult.mappingFileName) {
            const previewLimit = 15
            const idPreview = updateResult.unmappedEntityIds
              .slice(0, previewLimit)
              .map((id) => `- ${id.length > 80 ? `${id.slice(0, 77)}...` : id}`)
              .join('\n')
            const remainingCount = updateResult.unmappedEntityIds.length - previewLimit
            this.messageService.warn(
              `${nls.localize('rockit/dataRepository/updateUnmappedIds', 'ARP update completed, but {0} entity ID mapping(s) could not be inferred. Empty values were written to .rockit/{1}.', updateResult.unmappedEntityIds.length, updateResult.mappingFileName)}\n${idPreview}${remainingCount > 0 ? `\n- ${nls.localize('rockit/dataRepository/andMore', '...and {0} more', remainingCount)}` : ''}`,
              { timeout: 10000 },
            )
          }
          return
        }
      } catch (error) {
        await this.arpExportService.markActiveExportFailed(error)
        console.error('ARP file update failed:', error)
        if (error instanceof ArpRoCrateValidationError) {
          progress.cancel()
          await this.showArpValidationFailure(error)
          return
        }
        this.messageService.error(
          nls.localize(
            'rockit/dataRepository/arpUpdateFailed',
            'ARP file update failed: {0}',
            error instanceof Error ? error.message : String(error),
          ),
          { timeout: 10000 },
        )
        return
      } finally {
        progress.cancel()
      }
    }

    if (!capabilities.supportsArpRoCrateZipUpload && selectedExportTarget) {
      const progress = await this.loadMaskService.showProgress({
        text: nls.localize(
          'rockit/dataRepository/updatingUploaded',
          'Updating the uploaded RO-Crate in {0}',
          selectedRepo.title,
        ),
      })
      try {
        const updateResult = await this.nativeExportService.updateDataset(
          selectedRepo,
          selectedExportTarget,
          (update) =>
            progress.report({
              message: update.message,
              work: {
                done: update.completedSteps,
                total: update.totalSteps,
              },
            }),
        )
        if (updateResult) {
          this.showTargetNotification(
            nls.localize(
              'rockit/dataRepository/dataverseUpdateCompleted',
              'Dataverse update completed for {0}. Uploaded {1} new file(s), replaced {2} changed file(s), and removed {3} file(s).',
              updateResult.target,
              updateResult.addedFileCount,
              updateResult.replacedFileCount,
              updateResult.removedFileCount,
            ),
            updateResult.target,
            10000,
          )
          return
        }
      } catch (error) {
        await this.nativeExportService.markActiveExportFailed(error)
        console.error('Native Dataverse update failed:', error)
        this.messageService.error(
          nls.localize(
            'rockit/dataRepository/dataverseUpdateFailed',
            'Dataverse update failed: {0}',
            error instanceof Error ? error.message : String(error),
          ),
          { timeout: 10000 },
        )
        return
      } finally {
        progress.cancel()
      }
    }

    if (capabilities.supportsArpRoCrateZipUpload) {
      const missingMetadata = await this.getMissingArpDatasetCreationMetadata()
      if (missingMetadata.length) {
        const documentationUrl = await this.getRepositoryExportDocumentationUrl()
        this.messageService.error(
          nls.localize(
            'rockit/dataRepository/missingCitationMetadata',
            'ARP export requires citation metadata before creating a Dataverse dataset: {0}. Fill these fields in the root Dataset citation metadata, then export again. [Learn more in the documentation]({1}).',
            missingMetadata.join(', '),
            documentationUrl,
          ),
          { timeout: 15000 },
        )
        return
      }
    }

    const dialog = new DataverseCollectionBrowserDialog(
      selectedRepo,
      this.collectionService,
    )
    const result = await dialog.open()

    if (result) {
      if (capabilities.supportsArpRoCrateZipUpload) {
        let metadataDefaults: NativeDataverseDatasetMetadata
        let metadataLanguageOptions: Array<{ value: string; label: string }>
        try {
          metadataDefaults =
            await this.nativeExportService.getDatasetCreationMetadataDefaults()
          metadataLanguageOptions =
            await this.arpExportService.getAllowedMetadataLanguages(
              selectedRepo,
              result.collection,
            )
        } catch (error) {
          console.error('Failed to prepare ARP dataset metadata dialog:', error)
          this.messageService.error(
            nls.localize(
              'rockit/dataRepository/arpExportPreparationFailed',
              'ARP export preparation failed: {0}',
              error instanceof Error ? error.message : String(error),
            ),
            { timeout: 10000 },
          )
          return
        }
        const metadataDialog = new NativeDataverseDatasetMetadataDialog(
          metadataDefaults,
          {
            title: nls.localize(
              'rockit/dataRepository/requiredArpMetadata',
              'Required ARP Dataset Metadata',
            ),
            metadataLanguageOptions,
            defaultMetadataLanguage:
              metadataDefaults.metadataLanguage ??
              metadataLanguageOptions.find((option) => option.value === 'en')?.value ??
              metadataLanguageOptions[0]?.value,
            requiredCitationFields:
              this.nativeExportService.requiredDatasetCreationFields(),
            subjectOptions: this.nativeExportService.datasetCreationSubjectOptions(),
          },
        )
        const datasetMetadata = await metadataDialog.open()
        if (!datasetMetadata) {
          return
        }
        const progress = await this.loadMaskService.showProgress({
          text: nls.localize(
            'rockit/dataRepository/exportingArp',
            'Exporting RO-Crate to {0}...',
            result.collection.name,
          ),
        })
        try {
          const exportResult = await this.arpExportService.exportToArp(
            selectedRepo,
            result.collection,
            datasetMetadata,
            (update) =>
              progress.report({
                message: update.message,
                work: {
                  done: update.completedSteps,
                  total: update.totalSteps,
                },
              }),
          )
          const target =
            exportResult.target ||
            exportResult.dataverseUrl ||
            exportResult.pid ||
            exportResult.requestUrl
          this.showTargetNotification(
            nls.localize(
              'rockit/dataRepository/zipExportCompleted',
              'RO-Crate ZIP export completed: {0}',
              target,
            ),
            target,
            8000,
          )
          if (exportResult.unmappedEntityIds.length) {
            const previewLimit = 15
            const idPreview = exportResult.unmappedEntityIds
              .slice(0, previewLimit)
              .map((id) => `- ${id.length > 80 ? `${id.slice(0, 77)}...` : id}`)
              .join('\n')
            const remainingCount = exportResult.unmappedEntityIds.length - previewLimit
            this.messageService.warn(
              `${nls.localize('rockit/dataRepository/exportUnmappedIds', 'RO-Crate export completed, but {0} entity ID mapping(s) could not be inferred. Empty values were written to .rockit/{1}.', exportResult.unmappedEntityIds.length, exportResult.mappingFileName)}\n${idPreview}${remainingCount > 0 ? `\n- ${nls.localize('rockit/dataRepository/andMore', '...and {0} more', remainingCount)}` : ''}`,
              { timeout: 10000 },
            )
          }
        } catch (error) {
          await this.arpExportService.markActiveExportFailed(error)
          console.error('RO-Crate export failed:', error)
          if (error instanceof ArpRoCrateValidationError) {
            progress.cancel()
            await this.showArpValidationFailure(error)
            return
          }
          this.messageService.error(
            nls.localize(
              'rockit/dataRepository/zipExportFailed',
              'RO-Crate ZIP export failed: {0}',
              error instanceof Error ? error.message : String(error),
            ),
            { timeout: 10000 },
          )
        } finally {
          progress.cancel()
        }
        return
      }

      let metadataDefaults: NativeDataverseDatasetMetadata
      try {
        metadataDefaults =
          await this.nativeExportService.getDatasetCreationMetadataDefaults()
      } catch (error) {
        console.error('Failed to load Dataverse dataset metadata defaults:', error)
        this.messageService.error(
          nls.localize(
            'rockit/dataRepository/dataversePreparationFailed',
            'Dataverse export preparation failed: {0}',
            error instanceof Error ? error.message : String(error),
          ),
          { timeout: 10000 },
        )
        return
      }
      const metadataDialog = new NativeDataverseDatasetMetadataDialog(metadataDefaults, {
        requiredCitationFields: this.nativeExportService.requiredDatasetCreationFields(),
        subjectOptions: this.nativeExportService.datasetCreationSubjectOptions(),
      })
      const datasetMetadata = await metadataDialog.open()
      if (!datasetMetadata) {
        return
      }
      const progress = await this.loadMaskService.showProgress({
        text: nls.localize(
          'rockit/dataRepository/creatingDataset',
          'Creating Dataverse dataset in {0}...',
          result.collection.name,
        ),
      })
      try {
        const creationResult = await this.nativeExportService.createDataset(
          selectedRepo,
          result.collection,
          datasetMetadata,
          (update) =>
            progress.report({
              message: update.message,
              work: {
                done: update.completedSteps,
                total: update.totalSteps,
              },
            }),
        )
        const createdDataset =
          creationResult.persistentId ||
          creationResult.datasetId ||
          creationResult.requestUrl
        this.showTargetNotification(
          nls.localize(
            'rockit/dataRepository/datasetCreated',
            'Dataverse dataset created: {0}. Uploaded {1} files.',
            creationResult.target || createdDataset,
            creationResult.uploadedFiles.length,
          ),
          String(creationResult.target || createdDataset),
          8000,
        )
        if (creationResult.unmappedEntityIds.length) {
          const previewLimit = 15
          const idPreview = creationResult.unmappedEntityIds
            .slice(0, previewLimit)
            .map((id) => `- ${id.length > 80 ? `${id.slice(0, 77)}...` : id}`)
            .join('\n')
          const remainingCount = creationResult.unmappedEntityIds.length - previewLimit
          this.messageService.warn(
            `${nls.localize('rockit/dataRepository/creationUnmappedIds', 'Dataverse dataset created, but {0} entity ID mapping(s) could not be inferred. Empty values were written to .rockit/{1}.', creationResult.unmappedEntityIds.length, creationResult.mappingFileName)}\n${idPreview}${remainingCount > 0 ? `\n- ${nls.localize('rockit/dataRepository/andMore', '...and {0} more', remainingCount)}` : ''}`,
            { timeout: 10000 },
          )
        }
      } catch (error) {
        await this.nativeExportService.markActiveExportFailed(error)
        console.error('Native Dataverse dataset creation failed:', error)
        this.messageService.error(
          nls.localize(
            'rockit/dataRepository/datasetCreationFailed',
            'Dataverse dataset creation failed: {0}',
            error instanceof Error ? error.message : String(error),
          ),
          { timeout: 10000 },
        )
      } finally {
        progress.cancel()
      }
    }
  }

  protected async showArpValidationFailure(
    error: ArpRoCrateValidationError,
  ): Promise<void> {
    this.recentArpValidationError = error
    this.update()
    const issueCount = error.validationErrors.reduce(
      (count, entityError) => count + entityError.errors.length,
      0,
    )
    const action = await this.messageService.error(
      nls.localize(
        'rockit/dataRepository/serverValidationFailed',
        'Server RO-Crate validation failed. The backend rejected the upload with {0} issue(s) across {1} entity/entities.',
        issueCount,
        error.validationErrors.length,
      ),
      { timeout: 0 },
      nls.localize('rockit/dataRepository/showIssues', 'Show issues'),
    )
    if (action === nls.localize('rockit/dataRepository/showIssues', 'Show issues')) {
      await this.openArpValidationResponse(error)
    }
  }

  protected async openRecentArpValidationResponse(): Promise<void> {
    if (!this.recentArpValidationError) {
      return
    }
    await this.openArpValidationResponse(this.recentArpValidationError)
  }

  protected async openArpValidationResponse(
    error: ArpRoCrateValidationError,
  ): Promise<void> {
    const dialog = new ArpRoCrateValidationErrorsDialog(
      error.validationErrors,
      error.requestUrl,
      error.payload,
    )
    await dialog.open()
  }

  protected handleAddRepository = async () => {
    const dialog = new DataRepositoryConfigDialog(
      this.dataverseService,
      undefined,
      this.providerService.listProviders(),
      this.providerService,
      await this.crosswalkRegistryService.list(),
    )
    const result = await dialog.open()
    if (result) {
      await this.storeService.saveRepository(result)
    }
  }

  protected handleEdit = async (repo: DataRepositoryConfig) => {
    const dialog = new DataRepositoryConfigDialog(
      this.dataverseService,
      repo,
      this.providerService.listProviders(),
      this.providerService,
      await this.crosswalkRegistryService.list(),
    )
    const result = await dialog.open()
    if (result) {
      await this.storeService.saveRepository(result)
    }
  }

  protected hasUnsavedRoCrateChanges(): boolean {
    const crate = this.appStateService.roCrate
    return (
      this.appStateService.dirty ||
      (!!crate && this.appStateService.isRoCrateDirty(crate))
    )
  }

  protected hasOpenWorkspace(): boolean {
    return this.workspaceService.tryGetRoots().length > 0
  }

  protected mergeExportTargets(
    ...targetMaps: Array<Record<string, DataRepositoryExportTarget[]>>
  ): Record<string, DataRepositoryExportTarget[]> {
    const merged: Record<string, DataRepositoryExportTarget[]> = {}
    for (const targetMap of targetMaps) {
      for (const [repositoryId, targets] of Object.entries(targetMap)) {
        const latestByMappingFile = new Map(
          (merged[repositoryId] ?? []).map((target) => [target.mappingFile, target]),
        )
        for (const target of targets) {
          const previous = latestByMappingFile.get(target.mappingFile)
          if (
            !previous ||
            (previous.lastSuccessfulActionAt ?? '').localeCompare(
              target.lastSuccessfulActionAt ?? '',
            ) < 0
          ) {
            latestByMappingFile.set(target.mappingFile, target)
          }
        }
        merged[repositoryId] = Array.from(latestByMappingFile.values()).sort((a, b) =>
          (b.lastSuccessfulActionAt ?? '').localeCompare(a.lastSuccessfulActionAt ?? ''),
        )
      }
    }
    return merged
  }

  protected async listAllExportTargets(
    repositories: DataRepositoryConfig[],
  ): Promise<Record<string, DataRepositoryExportTarget[]>> {
    const pluginTargets: Record<string, DataRepositoryExportTarget[]> = {}
    await Promise.all(
      repositories
        .filter(
          (repository) =>
            repository.providerId &&
            this.providerService.supports(repository, 'listTargets'),
        )
        .map(async (repository) => {
          pluginTargets[repository.id] =
            (await this.providerService.executeForRepository<
              { repository: DataRepositoryConfig },
              DataRepositoryExportTarget[]
            >(repository, 'listTargets', { repository })) ?? []
        }),
    )
    return this.mergeExportTargets(
      await this.arpExportService.listExportTargets(repositories.filter(
        repository => !repository.providerId || repository.providerId === 'arp')),
      await this.nativeExportService.listExportTargets(repositories.filter(
        repository => !repository.providerId || repository.providerId === 'dataverse')),
      pluginTargets,
    )
  }

  protected inferRepositoryFromDatasetUrl(
    repositories: DataRepositoryConfig[],
    datasetUrl: string,
  ): DataRepositoryConfig | undefined {
    let inputHost: string | undefined
    try {
      inputHost = new URL(datasetUrl.trim()).hostname.toLowerCase()
    } catch {
      return undefined
    }
    if (!inputHost || inputHost === 'hdl.handle.net' || inputHost === 'doi.org') {
      return undefined
    }
    return repositories.find((repository) => {
      try {
        return new URL(repository.baseUrl.trim()).hostname.toLowerCase() === inputHost
      } catch {
        return false
      }
    })
  }

  protected async handleDeleteExportTarget(
    repository: DataRepositoryConfig,
    target: DataRepositoryExportTarget,
    action: ExportDeleteAction,
  ): Promise<boolean> {
    const capabilities = repository.providerId
      ? {
          kind: repository.providerId === 'dataverse'
            ? 'dataverse' as const
            : repository.providerId === 'arp'
              ? 'arp-dataverse' as const
              : 'unknown' as const,
          supportsArpRoCrateZipUpload: false,
          supportsNativeDataverseApi: false,
        }
      : await this.capabilityService.detectRepositoryCapabilities(
          repository.baseUrl,
          repository.apiKey,
        )
    const dialog = new DataRepositoryExportDeleteDialog(target, action, capabilities.kind)
    if (!(await dialog.open())) {
      return false
    }

    const deleteRemote = action === 'delete'
    const loadMask = this.loadMaskService.show({
      message: deleteRemote
        ? nls.localize(
            'rockit/dataRepository/deletingRemoteDatasetFrom',
            'Deleting the remote dataset from {0}...',
            repository.title,
          )
        : nls.localize(
            'rockit/dataRepository/removingLocalExportLink',
            'Removing the local export link...',
          ),
      delay: 0,
    })
    try {
      await this.waitForLoadMaskPaint()
      if (deleteRemote && repository.providerId) {
        await this.providerService.executeForRepository(repository, 'delete', {
          repository,
          exportTarget: target,
        })
        await this.exportDeleteService.deleteExport(
          repository,
          capabilities,
          target,
          false,
        )
      } else {
        await this.exportDeleteService.deleteExport(
          repository,
          capabilities,
          target,
          deleteRemote,
        )
      }
      return true
    } catch (error) {
      console.error('Export deletion failed:', error)
      loadMask.dispose()
      const errorDialog = new DataRepositoryExportDeleteErrorDialog(
        error instanceof Error ? error.message : String(error),
      )
      await errorDialog.open()
      return false
    } finally {
      loadMask.dispose()
    }
  }

  protected async waitForLoadMaskPaint(): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (!settled) {
          settled = true
          resolve()
        }
      }
      setTimeout(finish, 50)
      requestAnimationFrame(() => requestAnimationFrame(finish))
    })
  }

  protected async executePluginRepositoryOperation(
    repository: DataRepositoryConfig,
    operation: RepositoryOperation,
    input: unknown,
  ): Promise<void> {
    const provider = this.providerService.getProviderForRepository(repository)
    try {
      const result = await this.providerService.executeForRepository(
        repository,
        operation,
        input,
      )
      const operationResult =
        result && typeof result === 'object'
          ? (result as { cancelled?: boolean; openedWorkspace?: boolean })
          : undefined
      if (operationResult?.cancelled) {
        return
      }
      if (
        operation === 'sync' ||
        (operation === 'import' && !operationResult?.openedWorkspace)
      ) {
        await this.roCrateLoader.refresh()
        await this.loadData()
      }
      this.messageService.info(
        nls.localize(
          'rockit/dataRepository/pluginOperationCompleted',
          '{0} completed the {1} operation.',
          provider?.displayName ?? repository.providerId ?? repository.title,
          operation,
        ),
      )
    } catch (error) {
      console.error(`Repository plugin '${operation}' operation failed:`, error)
      this.messageService.error(
        nls.localize(
          'rockit/dataRepository/pluginOperationFailed',
          '{0} failed: {1}',
          provider?.displayName ?? repository.providerId ?? repository.title,
          error instanceof Error ? error.message : String(error),
        ),
        { timeout: 10000 },
      )
    }
  }

  protected async handlePluginArpImport(
    repository: DataRepositoryConfig,
    recordUrl: string,
  ): Promise<void> {
    try {
      const download = await this.providerService.executeForRepository<
        { repository: DataRepositoryConfig; recordUrl: string },
        ArpProviderImportDownload
      >(repository, 'import', { repository, recordUrl })
      if (!download) {
        throw new Error('The ARP provider returned no import result.')
      }
      const result = await this.arpImportService.completeProviderImport(repository, download)
      if ('cancelled' in result) return
      this.messageService.info(
        nls.localize(
          'rockit/dataRepository/importedDataset',
          'Dataset imported to {0}. Extracted {1} file(s).',
          result.targetDirectory.path.fsPath(),
          result.extractedFileCount,
        ),
        { timeout: 10000 },
      )
    } catch (error) {
      console.error('ARP plugin import failed:', error)
      this.messageService.error(
        nls.localize(
          'rockit/dataRepository/importFailed',
          'Dataset import failed: {0}',
          error instanceof Error ? error.message : String(error),
        ),
        { timeout: 10000 },
      )
    }
  }

  protected async handlePluginArpCreate(repository: DataRepositoryConfig): Promise<void> {
    try {
      const missingMetadata = await this.getMissingArpDatasetCreationMetadata()
      if (missingMetadata.length) {
        this.messageService.error(
          nls.localize('rockit/dataRepository/missingCitationMetadata',
            'ARP export requires citation metadata before creating a Dataverse dataset: {0}. Fill these fields in the root Dataset citation metadata, then export again.',
            missingMetadata.join(', ')),
          { timeout: 15000 },
        )
        return
      }
      const selection = await new DataverseCollectionBrowserDialog(repository, this.collectionService).open()
      if (!selection) return
      const defaults = await this.nativeExportService.getDatasetCreationMetadataDefaults()
      let languages: Array<{ value: string; label: string }>
      try {
        const payload = await this.providerService.executeForRepository(repository, 'metadataLanguages', {
          repository, collectionId: selection.collection.alias || selection.collection.id,
        })
        languages = this.arpExportService.metadataLanguageOptionsFromPayload(payload)
      } catch (error) {
        console.warn('Could not load ARP metadata languages; using defaults.', error)
        languages = this.arpExportService.metadataLanguageOptionsFromPayload(undefined)
      }
      const metadata = await new NativeDataverseDatasetMetadataDialog(defaults, {
        title: nls.localize('rockit/dataRepository/requiredArpMetadata', 'Required ARP Dataset Metadata'),
        metadataLanguageOptions: languages,
        defaultMetadataLanguage: defaults.metadataLanguage ??
          languages.find(option => option.value === 'en')?.value ?? languages[0]?.value,
        requiredCitationFields: this.nativeExportService.requiredDatasetCreationFields(),
        subjectOptions: this.nativeExportService.datasetCreationSubjectOptions(),
      }).open()
      if (!metadata) return
      const result = await this.arpExportService.exportToArpWithProvider(
        repository, selection.collection, metadata,
        async input => {
          const response = await this.providerService.executeForRepository<
            typeof input, ArpProviderCreateResult | ArpProviderCreateValidationResult
          >(
            repository, 'create', input)
          if (!response) throw new Error('The ARP provider returned no creation result.')
          return response
        },
      )
      const target = result.target || result.dataverseUrl || result.pid || result.requestUrl
      this.showTargetNotification(
        nls.localize('rockit/dataRepository/zipExportCompleted', 'RO-Crate ZIP export completed: {0}', target),
        target, 8000)
      if (result.unmappedEntityIds.length) {
        this.messageService.warn(
          nls.localize('rockit/dataRepository/exportUnmappedIds',
            'RO-Crate export completed, but {0} entity ID mapping(s) could not be inferred. Empty values were written to .rockit/{1}.',
            result.unmappedEntityIds.length, result.mappingFileName),
          { timeout: 10000 },
        )
      }
    } catch (error) {
      await this.arpExportService.markActiveExportFailed(error)
      console.error('ARP provider export failed:', error)
      if (error instanceof ArpRoCrateValidationError) {
        await this.showArpValidationFailure(error)
        return
      }
      this.messageService.error(
        nls.localize('rockit/dataRepository/zipExportFailed', 'RO-Crate ZIP export failed: {0}',
          error instanceof Error ? error.message : String(error)),
        { timeout: 10000 },
      )
    }
  }

  protected async handlePluginDataverseCreate(
    repository: DataRepositoryConfig,
  ): Promise<void> {
    try {
      const selection = await new DataverseCollectionBrowserDialog(
        repository,
        this.collectionService,
      ).open()
      if (!selection) return
      const defaults = await this.nativeExportService.getDatasetCreationMetadataDefaults(repository)
      const metadata = await new NativeDataverseDatasetMetadataDialog(defaults, {
        requiredCitationFields: this.nativeExportService.requiredDatasetCreationFields(),
        subjectOptions: this.nativeExportService.datasetCreationSubjectOptions(),
      }).open()
      if (!metadata) return
      const result = await this.nativeExportService.exportToDataverseWithProvider(
        repository,
        selection.collection,
        metadata,
        async input => {
          const response = await this.providerService.executeForRepository<
            typeof input,
            DataverseProviderCreateResult
          >(repository, 'create', input)
          if (!response) {
            throw new Error('The Dataverse provider returned no creation result.')
          }
          return response
        },
      )
      const createdDataset =
        result.persistentId || result.datasetId || result.requestUrl
      this.showTargetNotification(
        nls.localize(
          'rockit/dataRepository/datasetCreated',
          'Dataverse dataset created: {0}. Uploaded {1} files.',
          result.target || createdDataset,
          result.uploadedFiles.length,
        ),
        String(result.target || createdDataset),
        8000,
      )
      if (result.unmappedEntityIds.length) {
        this.messageService.warn(
          nls.localize(
            'rockit/dataRepository/creationUnmappedIds',
            'Dataverse dataset created, but {0} entity ID mapping(s) could not be inferred. Empty values were written to .rockit/{1}.',
            result.unmappedEntityIds.length,
            result.mappingFileName,
          ),
          { timeout: 10000 },
        )
      }
    } catch (error) {
      console.error('Dataverse provider export failed:', error)
      this.messageService.error(
        nls.localize(
          'rockit/dataRepository/dataverseCreationFailed',
          'Dataverse dataset creation failed: {0}',
          error instanceof Error ? error.message : String(error),
        ),
        { timeout: 10000 },
      )
    }
  }

  protected async handlePluginArpUpdate(
    repository: DataRepositoryConfig,
    exportTarget: DataRepositoryExportTarget,
  ): Promise<void> {
    try {
      const result = await this.arpExportService.updateArpWithProvider(
        repository,
        exportTarget,
        async input => {
          const response = await this.providerService.executeForRepository<
            typeof input,
            unknown
          >(repository, 'update', input)
          if (!response) throw new Error('The ARP provider returned no update result.')
          return response
        },
      )
      if (!result) return
      this.showTargetNotification(
        nls.localize(
          'rockit/dataRepository/arpUpdateCompleted',
          'ARP update completed for {0}. Uploaded {1} new file(s), replaced {2} changed file(s), and removed {3} file(s).',
          result.target,
          result.addedFileCount,
          result.changedFileCount,
          result.removedFileCount,
        ),
        result.target,
        10000,
      )
      if (result.unmappedEntityIds.length && result.mappingFileName) {
        const previewLimit = 15
        const idPreview = result.unmappedEntityIds
          .slice(0, previewLimit)
          .map(id => `- ${id.length > 80 ? `${id.slice(0, 77)}...` : id}`)
          .join('\n')
        const remainingCount = result.unmappedEntityIds.length - previewLimit
        this.messageService.warn(
          `${nls.localize(
            'rockit/dataRepository/updateUnmappedIds',
            'ARP update completed, but {0} entity ID mapping(s) could not be inferred. Empty values were written to .rockit/{1}.',
            result.unmappedEntityIds.length,
            result.mappingFileName,
          )}\n${idPreview}${remainingCount > 0 ? `\n- ${nls.localize('rockit/dataRepository/andMore', '...and {0} more', remainingCount)}` : ''}`,
          { timeout: 10000 },
        )
      }
    } catch (error) {
      await this.arpExportService.markActiveExportFailed(error)
      console.error('ARP provider update failed:', error)
      this.messageService.error(
        nls.localize(
          'rockit/dataRepository/arpUpdateFailed',
          'ARP file update failed: {0}',
          error instanceof Error ? error.message : String(error),
        ),
        { timeout: 10000 },
      )
    }
  }

  protected async handlePluginArpSync(
    repository: DataRepositoryConfig,
    exportTarget: DataRepositoryExportTarget,
    metadataMode: RepositorySyncMode,
  ): Promise<void> {
    try {
      const result = await this.arpExportService.syncArpWithProvider(
        repository,
        exportTarget,
        metadataMode,
        async input => {
          const response = await this.providerService.executeForRepository<
            typeof input, unknown
          >(repository, 'sync', input)
          if (!response) throw new Error('The ARP provider returned no sync result.')
          return response
        },
      )
      await this.roCrateLoader.refresh()
      await this.loadData()
      this.showTargetNotification(
        nls.localize(
          'rockit/dataRepository/arpSyncCompleted',
          'ARP sync completed for {0}. Downloaded {1} new file(s), replaced {2} changed file(s), and kept {3} local-only file(s).',
          result.target,
          result.downloadedFileCount,
          result.replacedFileCount,
          result.removedRemoteFileCount,
        ),
        result.target,
        10000,
      )
      if (result.unmappedEntityIds.length && result.mappingFileName) {
        const previewLimit = 15
        const idPreview = result.unmappedEntityIds.slice(0, previewLimit)
          .map(id => `- ${id.length > 80 ? `${id.slice(0, 77)}...` : id}`).join('\n')
        const remainingCount = result.unmappedEntityIds.length - previewLimit
        this.messageService.warn(
          `${nls.localize(
            'rockit/dataRepository/syncUnmappedIds',
            'ARP sync completed, but {0} entity ID mapping(s) could not be inferred. Empty values remain in .rockit/{1}.',
            result.unmappedEntityIds.length,
            result.mappingFileName,
          )}\n${idPreview}${remainingCount > 0 ? `\n- ${nls.localize('rockit/dataRepository/andMore', '...and {0} more', remainingCount)}` : ''}`,
          { timeout: 10000 },
        )
      }
    } catch (error) {
      await this.arpExportService.markActiveExportFailed(error)
      console.error('ARP provider sync failed:', error)
      this.messageService.error(
        nls.localize(
          'rockit/dataRepository/arpSyncFailed',
          'ARP sync failed: {0}',
          error instanceof Error ? error.message : String(error),
        ),
        { timeout: 10000 },
      )
    }
  }

  protected async getMissingArpDatasetCreationMetadata(): Promise<string[]> {
    const metadata = await this.nativeExportService.getDatasetCreationMetadataDefaults()
    const requiredCitationFields =
      this.nativeExportService.requiredDatasetCreationFields()
    const missing: string[] = []
    if (requiredCitationFields.has('title') && !metadata.title.trim()) {
      missing.push(this.nativeExportService.datasetCreationFieldLabel('title'))
    }
    if (requiredCitationFields.has('author') && !metadata.authorNames.length) {
      missing.push(this.nativeExportService.datasetCreationFieldLabel('author'))
    }
    if (requiredCitationFields.has('datasetContact') && !metadata.contactEmails.length) {
      missing.push(this.nativeExportService.datasetCreationFieldLabel('datasetContact'))
    }
    if (requiredCitationFields.has('dsDescription') && !metadata.descriptions.length) {
      missing.push(this.nativeExportService.datasetCreationFieldLabel('dsDescription'))
    }
    if (requiredCitationFields.has('subject') && !metadata.subjects.length) {
      missing.push(this.nativeExportService.datasetCreationFieldLabel('subject'))
    }
    return missing
  }

  protected async getRepositoryExportDocumentationUrl(): Promise<string> {
    try {
      const appInfo = await this.applicationServer.getApplicationInfo()
      return buildDocumentationUrl(
        appInfo?.version ?? 'latest',
        ROCKIT_DOCUMENTATION_PAGES.REPOSITORY_EXPORT_IMPORT,
      )
    } catch (error) {
      console.warn('Failed to resolve the application version for documentation:', error)
      return buildDocumentationUrl(
        'latest',
        ROCKIT_DOCUMENTATION_PAGES.REPOSITORY_EXPORT_IMPORT,
      )
    }
  }

  // Handles single item deletion from the Action column
  protected handleDelete = async (repo: DataRepositoryConfig) => {
    const dialog = new DataRepositoryDeleteDialog(repo.title)
    const confirmed = await dialog.open()
    if (confirmed) {
      await this.storeService.deleteRepositories([repo.id])
    }
  }

  // Handles bulk deletion from the Toolbar
  protected handleDeleteSelected = async () => {
    const count = this.selectedKeys.length
    if (count === 0) return

    const dialog = new DataRepositoryDeleteDialog(count)
    const confirmed = await dialog.open()
    if (confirmed) {
      await this.storeService.deleteRepositories(
        this.selectedKeys.map((k) => k.toString()),
      )
      this.selectedKeys = []
    }
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg)
    this.node.innerHTML = ''
    this.render()
    this.loadData()
  }

  protected onUpdateRequest(msg: Message): void {
    super.onUpdateRequest(msg)
    this.render()
  }

  protected render(): void {
    if (!this.isAttached) return

    this.node.classList.add('data-repository-manager-widget')

    if (!this.reactRoot) {
      this.reactRoot = createRoot(this.node)
    }

    this.reactRoot.render(
      <div className="data-repo-layout-container">
        <DataRepositoryToolbar
          onImport={this.handleImport}
          onExport={this.handleExport}
          onConfigure={this.handleAddRepository}
          selectedCount={this.selectedKeys.length} // NEW
          onDeleteSelected={this.handleDeleteSelected} // NEW
        />
        <DataRepositoryTable
          repositories={this.repositories}
          isLoading={this.isLoading}
          onDelete={this.handleDelete}
          onEdit={this.handleEdit}
          selectedKeys={this.selectedKeys} // NEW
          onSelectionChange={this.handleSelectionChange} // NEW
        />
      </div>,
    )
  }

  protected onBeforeDetach(msg: Message): void {
    this.disposables.dispose()
    if (this.reactRoot) {
      this.reactRoot.unmount()
      this.reactRoot = undefined
    }
    super.onBeforeDetach(msg)
  }

  storeState(): object {
    return {}
  }
  restoreState(): void {}
}

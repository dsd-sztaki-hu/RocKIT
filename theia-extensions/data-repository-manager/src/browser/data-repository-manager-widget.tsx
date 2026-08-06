import { BaseWidget, Message, StatefulWidget } from '@theia/core/lib/browser'
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs'
import { ApplicationServer } from '@theia/core/lib/common/application-protocol'
import { DisposableCollection } from '@theia/core/lib/common/disposable'
import { MessageService } from '@theia/core/lib/common/message-service'
import { nls } from '@theia/core/lib/common/nls'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateLoaderContribution } from 'app-state/lib/browser/state/ro-crate-loader'
import { inject, injectable } from 'inversify'
import * as React from 'react'
import { createRoot, Root } from 'react-dom/client'
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
import {
  ArpRoCrateExportService,
  ArpRoCrateValidationError,
} from './services/arp-ro-crate-export-service'
import { ArpRoCrateImportService } from './services/arp-ro-crate-import-service'
import { ArpRoCrateLinkService } from './services/arp-ro-crate-link-service'
import { DataRepositoryExportDeleteService } from './services/data-repository-export-delete-service'
import { DataRepositoryStoreService } from './services/data-repository-store-service'
import { DataverseCapabilityService } from './services/dataverse-capability-service'
import { DataverseCollectionService } from './services/dataverse-collection-service'
import { DataverseService } from './services/dataverse-service'
import {
  NativeDataverseDatasetMetadata,
  NativeDataverseExportService,
} from './services/native-dataverse-export-service'
import { NativeDataverseImportService } from './services/native-dataverse-import-service'
import { RoCrateFileHashService } from './services/ro-crate-file-hash-service'
import {
  ZenodoExportService,
  ZenodoMetadataDialogCancelledError,
} from './services/zenodo-export-service'
import type { DataRepositoryCapabilities } from './types'
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
    @inject(RoCrateFileHashService)
    protected readonly fileHashService: RoCrateFileHashService,
    @inject(LoadMaskService)
    protected readonly loadMaskService: LoadMaskService,
    @inject(ZenodoExportService)
    protected readonly zenodoExportService: ZenodoExportService,
    @inject(AppStateService)
    protected readonly appStateService: AppStateService,
    @inject(RoCrateLoaderContribution)
    protected readonly roCrateLoader: RoCrateLoaderContribution,
    @inject(ApplicationServer)
    protected readonly applicationServer: ApplicationServer,
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

  protected handleSelectionChange = (keys: React.Key[]) => {
    this.selectedKeys = keys
    this.update() // Trigger React re-render
  }

  protected handleImport = () => {
    void this.handleImportFromRemote()
  }

  public async handleImportFromRemote(): Promise<void> {
    const repositories = await this.storeService.loadRepositories()
    this.repositories = repositories
    this.update()

    const selector = new DataRepositorySelectorDialog(
      repositories,
      this.storeService,
      this.dataverseService,
      this.capabilityService,
    )
    const repositorySelection = await selector.open()
    if (!repositorySelection) {
      return
    }

    const selectedRepo = repositorySelection.repository
    const capabilities = repositorySelection.capabilities
    if (!capabilities.supportsNativeDataverseApi) {
      this.messageService.warn(
        nls.localize(
          'rockit/dataRepository/importUnsupported',
          "Import is currently only implemented for Dataverse-based repositories. '{0}' does not expose a supported Dataverse API.",
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
    try {
      const result = capabilities.supportsArpRoCrateZipUpload
        ? await this.arpImportService.importFromDatasetUrl(
            selectedRepo,
            importInput.datasetUrl,
          )
        : await this.nativeImportService.importFromDatasetUrl(
            selectedRepo,
            importInput.datasetUrl,
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
      )
      const repositorySelection = await selector.open()
      if (!repositorySelection) {
        return
      }
      selectedRepo = repositorySelection.repository
      selectedCapabilities = repositorySelection.capabilities
    } else {
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
        const preview = await this.arpLinkService.previewLocalDatasetLink(
          selectedRepo,
          selectedCapabilities,
          linkInput.datasetUrl,
        )
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
        const result = await this.arpLinkService.linkLocalDatasetToRemote(
          selectedRepo,
          selectedCapabilities,
          linkInput.datasetUrl,
        )
        this.messageService.info(
          nls.localize(
            'rockit/dataRepository/linkedLocalDataset',
            'Linked local dataset to {0}. Wrote {1} entity mapping(s) to .rockit/{2}.',
            result.target,
            result.mappedEntityCount,
            result.mappingFileName,
          ),
          { timeout: 10000 },
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
        console.log('Local dataset linked to remote ARP dataset:', result)
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

  public async handleExportToRemote(): Promise<void> {
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

    try {
      await this.fileHashService.persistFileMetadata()
    } catch (error) {
      console.error('Failed to calculate file hashes before remote export:', error)
      this.messageService.error(
        nls.localize(
          'rockit/dataRepository/exportPreparationFailed',
          'Remote export preparation failed: {0}',
          error instanceof Error ? error.message : String(error),
        ),
        { timeout: 10000 },
      )
      return
    }

    const repositories = await this.storeService.loadRepositories()
    this.repositories = repositories
    this.update()
    const exportTargetsByRepositoryId = this.mergeExportTargets(
      await this.arpExportService.listExportTargets(repositories),
      await this.nativeExportService.listExportTargets(repositories),
      await this.zenodoExportService.listExportTargets(repositories),
    )

    // Show repository selector first, matching the UX requested.
    const selector = new DataRepositorySelectorDialog(
      repositories,
      this.storeService,
      this.dataverseService,
      this.capabilityService,
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
      return // User cancelled
    }
    const selectedRepo = repositorySelection.repository
    const capabilities = repositorySelection.capabilities
    const selectedExportTarget = repositorySelection.exportTarget

    if (capabilities.supportsZenodoApi) {
      if (repositorySelection.action === 'sync' && selectedExportTarget) {
        const syncOptions = await new RepositorySyncOptionsDialog().open()
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
          const syncResult = await this.zenodoExportService.syncFromZenodo(
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
          await this.roCrateLoader.refresh()
          await this.loadData()
          this.messageService.info(
            nls.localize(
              'rockit/dataRepository/zenodoSyncCompleted',
              'Zenodo sync completed for {0}. Downloaded {1} new file(s), replaced {2} changed file(s), and kept {3} unchanged file(s). Updated metadata fields: {4}.',
              syncResult.target,
              syncResult.downloadedFileCount,
              syncResult.replacedFileCount,
              syncResult.keptLocalFileCount,
              syncResult.updatedMetadataFields.length
                ? syncResult.updatedMetadataFields.join(', ')
                : nls.localize('rockit/dataRepository/none', 'none'),
            ),
            { timeout: 12000 },
          )
          console.log('Zenodo sync completed:', syncResult)
        } catch (error) {
          console.error('Zenodo sync failed:', error)
          this.messageService.error(
            nls.localize(
              'rockit/dataRepository/zenodoSyncFailed',
              'Zenodo sync failed: {0}',
              error instanceof Error ? error.message : String(error),
            ),
            { timeout: 10000 },
          )
        } finally {
          progress.cancel()
        }
        return
      }

      let preparedMetadata
      const metadataProgress = await this.loadMaskService.showProgress({
        text: nls.localize(
          'rockit/dataRepository/preparingZenodoMetadata',
          'Preparing Zenodo metadata for {0}...',
          selectedRepo.title,
        ),
      })
      let metadataProgressClosed = false
      const closeMetadataProgress = (): void => {
        if (!metadataProgressClosed) {
          metadataProgressClosed = true
          metadataProgress.cancel()
        }
      }
      try {
        preparedMetadata = await this.zenodoExportService.prepareDepositionMetadata(selectedRepo, {
          onLoadingLicenses: () =>
            metadataProgress.report({
              message: nls.localize(
                'rockit/dataRepository/loadingZenodoLicenses',
                'Loading Zenodo license options from {0}...',
                selectedRepo.title,
              ),
            }),
          onBeforeMetadataDialog: closeMetadataProgress,
        })
      } catch (error) {
        if (error instanceof ZenodoMetadataDialogCancelledError) {
          return
        }
        console.error('Zenodo metadata preparation failed:', error)
        this.messageService.error(
          nls.localize(
            'rockit/dataRepository/zenodoExportFailed',
            'Zenodo export failed: {0}',
            error instanceof Error ? error.message : String(error),
          ),
          { timeout: 10000 },
        )
        return
      } finally {
        closeMetadataProgress()
      }
      const progress = await this.loadMaskService.showProgress({
        text: selectedExportTarget
          ? nls.localize(
              'rockit/dataRepository/updatingZenodoIn',
              'Updating the Zenodo deposition in {0}...',
              selectedRepo.title,
            )
          : nls.localize(
              'rockit/dataRepository/uploadingRoCrateTo',
              'Uploading RO-Crate files to {0}...',
              selectedRepo.title,
            ),
      })
      try {
        if (selectedExportTarget) {
          const updateResult = await this.zenodoExportService.updateDeposition(
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
            preparedMetadata,
          )
          this.messageService.info(
            nls.localize(
              'rockit/dataRepository/zenodoUpdateCompleted',
              'Zenodo update completed for {0}. Uploaded {1} new file(s), replaced {2}, removed {3}, and kept {4} unchanged.{5}',
              updateResult.target,
              updateResult.addedFileCount,
              updateResult.replacedFileCount,
              updateResult.removedFileCount,
              updateResult.unchangedFileCount,
              updateResult.createdNewVersion
                ? nls.localize(
                    'rockit/dataRepository/zenodoNewVersionDraftUsed',
                    ' A new-version draft was used.',
                  )
                : '',
            ),
            { timeout: 12000 },
          )
          console.log('Zenodo deposition updated:', updateResult)
          return
        }

        const exportResult = await this.zenodoExportService.createDraftAndUploadRoCrate(
          selectedRepo,
          (update) =>
            progress.report({
              message: update.message,
              work: {
                done: update.completedSteps,
                total: update.totalSteps,
              },
            }),
          preparedMetadata,
        )
        this.messageService.info(
          nls.localize(
            'rockit/dataRepository/zenodoDraftCreated',
            'Zenodo draft deposition created: {0}. Uploaded {1} file(s).',
            exportResult.target,
            exportResult.uploadedFiles.length,
          ),
          { timeout: 10000 },
        )
        this.messageService.info(
          nls.localize(
            'rockit/dataRepository/zenodoMetadataPayloadUploaded',
            'RO-Crate metadata was converted to an in-memory Zenodo JSON payload and uploaded to the draft.',
          ),
          { timeout: 12000 },
        )
        console.log('RO-Crate files exported to Zenodo:', exportResult)
      } catch (error) {
        if (error instanceof ZenodoMetadataDialogCancelledError) {
          return
        }
        console.error('Zenodo RO-Crate export failed:', error)
        this.messageService.error(
          nls.localize(
            'rockit/dataRepository/zenodoExportFailed',
            'Zenodo export failed: {0}',
            error instanceof Error ? error.message : String(error),
          ),
          { timeout: 10000 },
        )
      } finally {
        progress.cancel()
      }
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
      const confirmed = await new ConfirmDialog({
        title: nls.localize('rockit/dataRepository/syncFromRemote', 'Sync from remote'),
        msg: nls.localize(
          'rockit/dataRepository/syncFromRemoteWarning',
          'By continuing, the local version of this dataset might be overwritten.\n\nThe local ro-crate-metadata.json will be replaced with the remote version, and changed remote files may overwrite matching local files. Local files removed remotely will stay in the workspace but may become orphaned.',
        ),
      }).open()
      if (!confirmed) {
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
        const syncResult = await this.arpExportService.syncFromArp(
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
        await this.roCrateLoader.refresh()
        await this.loadData()
        this.messageService.info(
          nls.localize(
            'rockit/dataRepository/arpSyncCompleted',
            'ARP sync completed for {0}. Downloaded {1} new file(s), replaced {2} changed file(s), and kept {3} local-only file(s).',
            syncResult.target,
            syncResult.downloadedFileCount,
            syncResult.replacedFileCount,
            syncResult.removedRemoteFileCount,
          ),
          { timeout: 10000 },
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
        console.log('ARP sync completed:', syncResult)
      } catch (error) {
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
          this.messageService.info(
            nls.localize(
              'rockit/dataRepository/arpUpdateCompleted',
              'ARP update completed for {0}. Uploaded {1} new file(s), replaced {2} changed file(s), and removed {3} file(s).',
              updateResult.target,
              updateResult.addedFileCount,
              updateResult.changedFileCount,
              updateResult.removedFileCount,
            ),
            { timeout: 10000 },
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
          console.log('ARP file update completed:', updateResult)
          return
        }
      } catch (error) {
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
          this.messageService.info(
            nls.localize(
              'rockit/dataRepository/dataverseUpdateCompleted',
              'Dataverse update completed for {0}. Uploaded {1} new file(s), replaced {2} changed file(s), and removed {3} file(s).',
              updateResult.target,
              updateResult.addedFileCount,
              updateResult.replacedFileCount,
              updateResult.removedFileCount,
            ),
            { timeout: 10000 },
          )
          console.log('Native Dataverse update completed:', updateResult)
          return
        }
      } catch (error) {
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
            requiredCitationFields: this.nativeExportService.requiredDatasetCreationFields(),
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
          this.messageService.info(
            nls.localize(
              'rockit/dataRepository/zipExportCompleted',
              'RO-Crate ZIP export completed: {0}',
              target,
            ),
            {
              timeout: 8000,
            },
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
          console.log('RO-Crate exported to ARP:', exportResult)
        } catch (error) {
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
        this.messageService.info(
          nls.localize(
            'rockit/dataRepository/datasetCreated',
            'Dataverse dataset created: {0}. Uploaded {1} files.',
            creationResult.target || createdDataset,
            creationResult.uploadedFiles.length,
          ),
          { timeout: 8000 },
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
        console.log('Dataverse dataset created through native API:', creationResult)
      } catch (error) {
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
    const dialog = new DataRepositoryConfigDialog(this.dataverseService)
    const result = await dialog.open()
    if (result) {
      await this.storeService.saveRepository(result)
    }
  }

  protected handleEdit = async (repo: DataRepositoryConfig) => {
    const dialog = new DataRepositoryConfigDialog(this.dataverseService, repo)
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
          if (!previous || previous.syncedAt.localeCompare(target.syncedAt) < 0) {
            latestByMappingFile.set(target.mappingFile, target)
          }
        }
        merged[repositoryId] = Array.from(latestByMappingFile.values()).sort((a, b) =>
          b.syncedAt.localeCompare(a.syncedAt),
        )
      }
    }
    return merged
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
    const capabilities = await this.capabilityService.detectRepositoryCapabilities(
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
      await this.exportDeleteService.deleteExport(
        repository,
        capabilities,
        target,
        deleteRemote,
      )
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

  protected async getMissingArpDatasetCreationMetadata(): Promise<string[]> {
    const metadata = await this.nativeExportService.getDatasetCreationMetadataDefaults()
    const requiredCitationFields = this.nativeExportService.requiredDatasetCreationFields()
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

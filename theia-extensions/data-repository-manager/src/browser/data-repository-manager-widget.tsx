import { BaseWidget, Message, StatefulWidget } from '@theia/core/lib/browser'
import { DisposableCollection } from '@theia/core/lib/common/disposable'
import { MessageService } from '@theia/core/lib/common/message-service'
import { inject, injectable } from 'inversify'
import * as React from 'react'
import { createRoot, Root } from 'react-dom/client'
import { DataRepositoryConfigDialog } from './components/data-repository-config-dialog'
import { DataRepositoryDeleteDialog } from './components/data-repository-delete-dialog'
import { DataRepositorySelectorDialog } from './components/data-repository-selector-dialog'
import { DataRepositoryTable } from './components/data-repository-table'
import { DataRepositoryToolbar } from './components/data-repository-toolbar'
import { DataverseCollectionBrowserDialog } from './components/dataverse-collection-browser-dialog'
import { NativeDataverseDatasetMetadataDialog } from './components/native-dataverse-dataset-metadata-dialog'
import { ArpRoCrateExportService } from './services/arp-ro-crate-export-service'
import { DataRepositoryStoreService } from './services/data-repository-store-service'
import { DataverseCapabilityService } from './services/dataverse-capability-service'
import { DataverseCollectionService } from './services/dataverse-collection-service'
import { DataverseService } from './services/dataverse-service'
import {
  NativeDataverseDatasetMetadata,
  NativeDataverseExportService,
} from './services/native-dataverse-export-service'
import { RoCrateFileHashService } from './services/ro-crate-file-hash-service'
import { DataRepositoryConfig } from './types'
import './styles/index.css'

export const DATA_REPOSITORY_MANAGER_WIDGET_ID = 'data-repository-manager:widget'
export const DATA_REPOSITORY_MANAGER_LABEL = 'Data Repository Manager'

@injectable()
export class DataRepositoryManagerWidget extends BaseWidget implements StatefulWidget {
  static readonly ID = DATA_REPOSITORY_MANAGER_WIDGET_ID
  static readonly LABEL = DATA_REPOSITORY_MANAGER_LABEL

  private reactRoot: Root | undefined
  protected repositories: DataRepositoryConfig[] = []
  protected isLoading = true
  protected selectedKeys: React.Key[] = []
  protected readonly disposables = new DisposableCollection()

  constructor(
    @inject(MessageService) protected readonly messageService: MessageService,
    @inject(DataRepositoryStoreService)
    protected readonly storeService: DataRepositoryStoreService,
    @inject(DataverseService) protected readonly dataverseService: DataverseService,
    @inject(DataverseCollectionService)
    protected readonly collectionService: DataverseCollectionService,
    @inject(NativeDataverseExportService)
    protected readonly nativeExportService: NativeDataverseExportService,
    @inject(ArpRoCrateExportService)
    protected readonly arpExportService: ArpRoCrateExportService,
    @inject(DataverseCapabilityService)
    protected readonly capabilityService: DataverseCapabilityService,
    @inject(RoCrateFileHashService)
    protected readonly fileHashService: RoCrateFileHashService,
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
    this.messageService.info('Import placeholder clicked!', { timeout: 5000 })
  }

  protected handleExport = () => {
    this.handleExportToRemote()
  }

  public async handleExportToRemote(): Promise<void> {
    try {
      await this.fileHashService.persistFileMetadata()
    } catch (error) {
      console.error('Failed to calculate file hashes before remote export:', error)
      this.messageService.error(
        `Remote export preparation failed: ${error instanceof Error ? error.message : String(error)}`,
        { timeout: 10000 },
      )
      return
    }

    const repositories = await this.storeService.loadRepositories()
    this.repositories = repositories
    this.update()

    // Show repository selector first, matching the UX requested.
    const selector = new DataRepositorySelectorDialog(
      repositories,
      this.storeService,
      this.dataverseService,
      this.capabilityService,
    )
    const repositorySelection = await selector.open()

    if (!repositorySelection) {
      return // User cancelled
    }
    const selectedRepo = repositorySelection.repository
    const capabilities = repositorySelection.capabilities

    if (!capabilities.supportsNativeDataverseApi) {
      this.messageService.error(
        `Repository '${selectedRepo.title}' does not expose a supported Dataverse API.`,
        { timeout: 10000 },
      )
      return
    }

    if (capabilities.supportsArpRoCrateZipUpload) {
      const progress = await this.messageService.showProgress({
        text: `Updating the uploaded RO-Crate in ${selectedRepo.title}`,
      })
      try {
        const updateResult =
          await this.arpExportService.updateArp(selectedRepo, (update) =>
            progress.report({
              message: `${Math.round((update.completedSteps / update.totalSteps) * 100)}% - ${update.message}`,
              work: {
                done: update.completedSteps,
                total: update.totalSteps,
              },
            }),
          )
        if (updateResult) {
          this.messageService.info(
            `ARP update completed for ${updateResult.target}. Uploaded ${updateResult.addedFileCount} new file(s), replaced ${updateResult.changedFileCount} changed file(s), and removed ${updateResult.removedFileCount} file(s).`,
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
              `ARP update completed, but ${updateResult.unmappedEntityIds.length} entity ID mapping(s) could not be inferred. Empty values were written to .aroma/${updateResult.mappingFileName}.\n${idPreview}${remainingCount > 0 ? `\n- ...and ${remainingCount} more` : ''}`,
              { timeout: 10000 },
            )
          }
          console.log('ARP file update completed:', updateResult)
          return
        }
      } catch (error) {
        console.error('ARP file update failed:', error)
        this.messageService.error(
          `ARP file update failed: ${error instanceof Error ? error.message : String(error)}`,
          { timeout: 10000 },
        )
        return
      } finally {
        progress.cancel()
      }
    }

    const dialog = new DataverseCollectionBrowserDialog(
      selectedRepo,
      this.collectionService,
    )
    const result = await dialog.open()

    if (result) {
      if (capabilities.supportsArpRoCrateZipUpload) {
        const progress = await this.messageService.showProgress({
          text: `Exporting RO-Crate ZIP to ${result.collection.name}...`,
        })
        try {
          const exportResult = await this.arpExportService.exportToArp(
            selectedRepo,
            result.collection,
          )
          const target =
            exportResult.target ||
            exportResult.dataverseUrl ||
            exportResult.pid ||
            exportResult.requestUrl
          this.messageService.info(`RO-Crate ZIP export completed: ${target}`, {
            timeout: 8000,
          })
          if (exportResult.unmappedEntityIds.length) {
            const previewLimit = 15
            const idPreview = exportResult.unmappedEntityIds
              .slice(0, previewLimit)
              .map((id) => `- ${id.length > 80 ? `${id.slice(0, 77)}...` : id}`)
              .join('\n')
            const remainingCount = exportResult.unmappedEntityIds.length - previewLimit
            this.messageService.warn(
              `RO-Crate export completed, but ${exportResult.unmappedEntityIds.length} entity ID mapping(s) could not be inferred. Empty values were written to .aroma/${exportResult.mappingFileName}.\n${idPreview}${remainingCount > 0 ? `\n- ...and ${remainingCount} more` : ''}`,
              { timeout: 10000 },
            )
          }
          console.log('RO-Crate ZIP exported to ARP:', exportResult)
        } catch (error) {
          console.error('RO-Crate ZIP export failed:', error)
          this.messageService.error(
            `RO-Crate ZIP export failed: ${error instanceof Error ? error.message : String(error)}`,
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
          `Dataverse export preparation failed: ${error instanceof Error ? error.message : String(error)}`,
          { timeout: 10000 },
        )
        return
      }
      const metadataDialog = new NativeDataverseDatasetMetadataDialog(metadataDefaults)
      const datasetMetadata = await metadataDialog.open()
      if (!datasetMetadata) {
        return
      }
      const progress = await this.messageService.showProgress({
        text: `Creating Dataverse dataset in ${result.collection.name}...`,
      })
      try {
        const creationResult = await this.nativeExportService.createDataset(
          selectedRepo,
          result.collection,
          datasetMetadata,
          (update) =>
            progress.report({
              message: `${Math.round((update.completedSteps / update.totalSteps) * 100)}% - ${update.message}`,
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
          `Dataverse dataset created: ${creationResult.target || createdDataset}. Uploaded ${creationResult.uploadedFiles.length} files.`,
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
            `Dataverse dataset created, but ${creationResult.unmappedEntityIds.length} entity ID mapping(s) could not be inferred. Empty values were written to .aroma/${creationResult.mappingFileName}.\n${idPreview}${remainingCount > 0 ? `\n- ...and ${remainingCount} more` : ''}`,
            { timeout: 10000 },
          )
        }
        console.log('Dataverse dataset created through native API:', creationResult)
      } catch (error) {
        console.error('Native Dataverse dataset creation failed:', error)
        this.messageService.error(
          `Dataverse dataset creation failed: ${error instanceof Error ? error.message : String(error)}`,
          { timeout: 10000 },
        )
      } finally {
        progress.cancel()
      }
    }
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

    const dialog = new DataRepositoryDeleteDialog(`${count} selected repositories`)
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

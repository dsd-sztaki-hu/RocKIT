import { BaseWidget, Message, StatefulWidget } from '@theia/core/lib/browser'
import { ApplicationServer } from '@theia/core/lib/common/application-protocol'
import { DisposableCollection } from '@theia/core/lib/common/disposable'
import { MessageService } from '@theia/core/lib/common/message-service'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { inject, injectable } from 'inversify'
import * as React from 'react'
import { createRoot, Root } from 'react-dom/client'
import {
  buildDocumentationUrl,
  ROCKIT_DOCUMENTATION_PAGES,
} from 'rockit-common/lib/browser'
import { DataRepositoryConfigDialog } from './components/data-repository-config-dialog'
import { DataRepositoryDeleteDialog } from './components/data-repository-delete-dialog'
import { DataRepositorySelectorDialog } from './components/data-repository-selector-dialog'
import { DataRepositoryTable } from './components/data-repository-table'
import { DataRepositoryToolbar } from './components/data-repository-toolbar'
import { DataverseCollectionBrowserDialog } from './components/dataverse-collection-browser-dialog'
import { ArpRoCrateImportDialog } from './components/arp-ro-crate-import-dialog'
import { ArpRoCrateValidationErrorsDialog } from './components/arp-ro-crate-validation-errors-dialog'
import { NativeDataverseDatasetMetadataDialog } from './components/native-dataverse-dataset-metadata-dialog'
import {
  ArpRoCrateExportService,
  ArpRoCrateValidationError,
} from './services/arp-ro-crate-export-service'
import { ArpRoCrateImportService } from './services/arp-ro-crate-import-service'
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
import { ZenodoExportService } from './services/zenodo-export-service'
import { DataRepositoryConfig, DataRepositoryExportTarget } from './types'
import './styles/index.css'

type RoCrateEntity = Record<string, unknown>

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
  protected recentArpValidationError: ArpRoCrateValidationError | undefined
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
    @inject(ArpRoCrateImportService)
    protected readonly arpImportService: ArpRoCrateImportService,
    @inject(NativeDataverseImportService)
    protected readonly nativeImportService: NativeDataverseImportService,
    @inject(DataverseCapabilityService)
    protected readonly capabilityService: DataverseCapabilityService,
    @inject(RoCrateFileHashService)
    protected readonly fileHashService: RoCrateFileHashService,
    @inject(ZenodoExportService)
    protected readonly zenodoExportService: ZenodoExportService,
    @inject(AppStateService)
    protected readonly appStateService: AppStateService,
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
        `Import is currently only implemented for Dataverse-based repositories. '${selectedRepo.title}' does not expose a supported Dataverse API.`,
        { timeout: 10000 },
      )
      return
    }

    const importDialog = new ArpRoCrateImportDialog(
      capabilities.supportsArpRoCrateZipUpload
        ? undefined
        : {
            title: 'Import Dataverse Dataset',
            description:
              'Enter the dataset persistent ID or dataset URL for the Dataverse dataset to import.',
            placeholder: 'doi:10.70122/FK2/N2XGBJ',
          },
    )
    const importInput = await importDialog.open()
    if (!importInput) {
      return
    }

    const progress = await this.messageService.showProgress({
      text: `Importing dataset from ${selectedRepo.title}...`,
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
          `Dataverse dataset imported to ${result.targetDirectory.path.fsPath()}. Extracted ${result.extractedFileCount} file(s). No ro-crate-metadata.json was included, so the workspace can create one after opening.`,
          { timeout: 10000 },
        )
      } else {
        this.messageService.info(
          `Dataset imported to ${result.targetDirectory.path.fsPath()}. Extracted ${result.extractedFileCount} file(s).`,
          { timeout: 10000 },
        )
      }
    } catch (error) {
      console.error('Remote dataset import failed:', error)
      this.messageService.error(
        `Dataset import failed: ${error instanceof Error ? error.message : String(error)}`,
        { timeout: 10000 },
      )
    } finally {
      progress.cancel()
    }
  }

  protected handleExport = () => {
    this.handleExportToRemote()
  }

  public async handleExportToRemote(): Promise<void> {
    if (this.hasUnsavedRoCrateChanges()) {
      this.messageService.warn(
        'Remote export is not possible while the RO-Crate has unsaved changes. Save the RO-Crate first, then export again.',
        { timeout: 10000 },
      )
      return
    }

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
    )
    const repositorySelection = await selector.open()

    if (!repositorySelection) {
      return // User cancelled
    }
    const selectedRepo = repositorySelection.repository
    const capabilities = repositorySelection.capabilities
    const selectedExportTarget = repositorySelection.exportTarget

    if (capabilities.supportsZenodoApi) {
      const progress = await this.messageService.showProgress({
        text: `Uploading RO-Crate files to ${selectedRepo.title}...`,
      })
      try {
        const exportResult =
          await this.zenodoExportService.createDraftAndUploadRoCrate(
            selectedRepo,
            (update) =>
              progress.report({
                message: `${Math.round((update.completedSteps / update.totalSteps) * 100)}% - ${update.message}`,
                work: {
                  done: update.completedSteps,
                  total: update.totalSteps,
                },
              }),
          )
        this.messageService.info(
          `Zenodo draft deposition created: ${exportResult.target}. Uploaded ${exportResult.uploadedFiles.length} file(s).`,
          { timeout: 10000 },
        )
        this.messageService.info(
          'Zenodo metadata defaults were applied: upload type dataset, access right open, and license cc-zero. These can be changed in Zenodo.',
          { timeout: 12000 },
        )
        console.log('RO-Crate files exported to Zenodo:', exportResult)
      } catch (error) {
        console.error('Zenodo RO-Crate export failed:', error)
        this.messageService.error(
          `Zenodo export failed: ${error instanceof Error ? error.message : String(error)}`,
          { timeout: 10000 },
        )
      } finally {
        progress.cancel()
      }
      return
    }

    if (!capabilities.supportsNativeDataverseApi) {
      this.messageService.error(
        `Repository '${selectedRepo.title}' does not expose a supported Dataverse API.`,
        { timeout: 10000 },
      )
      return
    }

    if (capabilities.supportsArpRoCrateZipUpload && selectedExportTarget) {
      const progress = await this.messageService.showProgress({
        text: `Updating the uploaded RO-Crate in ${selectedRepo.title}`,
      })
      try {
        const updateResult =
          await this.arpExportService.updateArp(selectedRepo, selectedExportTarget, (update) =>
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
              `ARP update completed, but ${updateResult.unmappedEntityIds.length} entity ID mapping(s) could not be inferred. Empty values were written to .rockit/${updateResult.mappingFileName}.\n${idPreview}${remainingCount > 0 ? `\n- ...and ${remainingCount} more` : ''}`,
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
          `ARP file update failed: ${error instanceof Error ? error.message : String(error)}`,
          { timeout: 10000 },
        )
        return
      } finally {
        progress.cancel()
      }
    }

    if (!capabilities.supportsArpRoCrateZipUpload) {
      const progress = await this.messageService.showProgress({
        text: `Updating the uploaded RO-Crate in ${selectedRepo.title}`,
      })
      try {
        const updateResult = await this.nativeExportService.updateDataset(
          selectedRepo,
          selectedExportTarget,
          (update) =>
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
            `Dataverse update completed for ${updateResult.target}. Uploaded ${updateResult.addedFileCount} new file(s), replaced ${updateResult.replacedFileCount} changed file(s), and removed ${updateResult.removedFileCount} file(s).`,
            { timeout: 10000 },
          )
          console.log('Native Dataverse update completed:', updateResult)
          return
        }
      } catch (error) {
        console.error('Native Dataverse update failed:', error)
        this.messageService.error(
          `Dataverse update failed: ${error instanceof Error ? error.message : String(error)}`,
          { timeout: 10000 },
        )
        return
      } finally {
        progress.cancel()
      }
    }

    if (capabilities.supportsArpRoCrateZipUpload) {
      const missingMetadata = this.getMissingArpDatasetCreationMetadata()
      if (missingMetadata.length) {
        const documentationUrl = await this.getRepositoryExportDocumentationUrl()
        this.messageService.error(
          `ARP export requires required citation metadata before creating a Dataverse dataset: ${missingMetadata.join(', ')}. Fill these fields in the root Dataset citation metadata, then export again. [Learn more in the documentation](${documentationUrl}).`,
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
              `RO-Crate export completed, but ${exportResult.unmappedEntityIds.length} entity ID mapping(s) could not be inferred. Empty values were written to .rockit/${exportResult.mappingFileName}.\n${idPreview}${remainingCount > 0 ? `\n- ...and ${remainingCount} more` : ''}`,
              { timeout: 10000 },
            )
          }
          console.log('RO-Crate ZIP exported to ARP:', exportResult)
        } catch (error) {
          console.error('RO-Crate ZIP export failed:', error)
          if (error instanceof ArpRoCrateValidationError) {
            progress.cancel()
            await this.showArpValidationFailure(error)
            return
          }
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
            `Dataverse dataset created, but ${creationResult.unmappedEntityIds.length} entity ID mapping(s) could not be inferred. Empty values were written to .rockit/${creationResult.mappingFileName}.\n${idPreview}${remainingCount > 0 ? `\n- ...and ${remainingCount} more` : ''}`,
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
      `Server RO-Crate validation failed. The backend validation endpoint rejected the upload with ${issueCount} issue${issueCount === 1 ? '' : 's'} across ${error.validationErrors.length} entit${error.validationErrors.length === 1 ? 'y' : 'ies'}.`,
      { timeout: 0 },
      'Show issues',
    )
    if (action === 'Show issues') {
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
    return this.appStateService.dirty || (!!crate && this.appStateService.isRoCrateDirty(crate))
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
        merged[repositoryId] = Array.from(latestByMappingFile.values())
          .sort((a, b) => b.syncedAt.localeCompare(a.syncedAt))
      }
    }
    return merged
  }

  protected getMissingArpDatasetCreationMetadata(): string[] {
    const crate = this.appStateService.roCrate
    const graph = this.readGraph(crate)
    const root = graph.find((entity) => entity['@id'] === './')
    if (!root) {
      return ['Root Dataset']
    }

    const missing: string[] = []
    if (!this.firstMeaningfulString(root.title, root.name)) {
      missing.push('Title')
    }
    if (!this.hasCompleteAuthors(root, graph)) {
      missing.push('Author Name')
    }
    if (!this.hasCompleteContactEmails(root, graph)) {
      missing.push('Point of Contact Email')
    }
    if (!this.hasCompleteDescriptions(root, graph)) {
      missing.push('Description Text')
    }
    if (!this.readStrings(root.subject).length) {
      missing.push('Subject')
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

  protected hasCompleteAuthors(root: RoCrateEntity, graph: RoCrateEntity[]): boolean {
    const authorReferences = this.resolveEntityReferences(root.author, graph)
    const authorEntities = this.uniqueEntities([
      ...authorReferences.entities,
      ...this.entitiesWithType(graph, 'author'),
    ])
    if (
      authorEntities.some(
        (author) => !this.firstMeaningfulString(author.authorName),
      )
    ) {
      return false
    }
    return (
      authorEntities.length > 0 ||
      authorReferences.literals.some((value) => !this.looksLikeEntityId(value))
    )
  }

  protected hasCompleteContactEmails(
    root: RoCrateEntity,
    graph: RoCrateEntity[],
  ): boolean {
    const contactReferences = this.resolveEntityReferences(
      root.datasetContact ?? root.contactPoint,
      graph,
    )
    const contactEntities = this.uniqueEntities([
      ...contactReferences.entities,
      ...this.entitiesWithType(graph, 'datasetContact'),
    ])
    if (
      contactEntities.some(
        (contact) =>
          !this.firstMeaningfulString(contact.datasetContactEmail) ||
          this.readStrings(contact.datasetContactEmail).some(
            (email) => !this.isValidEmail(email),
          ),
      )
    ) {
      return false
    }
    return (
      contactEntities.length > 0 ||
      this.readStrings(root.datasetContactEmail).some((email) =>
        this.isValidEmail(email),
      ) ||
      contactReferences.literals.some(
        (value) => !this.looksLikeEntityId(value) && this.isValidEmail(value),
      )
    )
  }

  protected hasCompleteDescriptions(root: RoCrateEntity, graph: RoCrateEntity[]): boolean {
    const descriptionReferences = this.resolveEntityReferences(root.dsDescription, graph)
    const descriptionEntities = this.uniqueEntities([
      ...descriptionReferences.entities,
      ...this.entitiesWithType(graph, 'dsDescription'),
    ])
    if (
      descriptionEntities.some(
        (description) =>
          !this.firstMeaningfulString(description.dsDescriptionValue),
      )
    ) {
      return false
    }
    return (
      descriptionEntities.length > 0 ||
      this.firstMeaningfulString(root.description) !== undefined ||
      descriptionReferences.literals.some((value) => !this.looksLikeEntityId(value))
    )
  }

  protected resolveEntityReferences(
    value: unknown,
    graph: RoCrateEntity[],
  ): { entities: RoCrateEntity[]; literals: string[] } {
    if (Array.isArray(value)) {
      const resolved = value.map((item) => this.resolveEntityReferences(item, graph))
      return {
        entities: resolved.flatMap((item) => item.entities),
        literals: this.uniqueStrings(resolved.flatMap((item) => item.literals)),
      }
    }
    if (value && typeof value === 'object') {
      const entity = value as RoCrateEntity
      const linkedEntity = this.readStrings(entity['@id'])
        .map((id) => graph.find((graphEntity) => graphEntity['@id'] === id))
        .find((graphEntity): graphEntity is RoCrateEntity => !!graphEntity)
      return { entities: [linkedEntity ?? entity], literals: [] }
    }
    const literals = this.readStrings(value)
    const entities = literals
      .map((id) => graph.find((graphEntity) => graphEntity['@id'] === id))
      .filter((entity): entity is RoCrateEntity => !!entity)
    const resolvedEntityIds = new Set(
      entities.flatMap((entity) => this.readStrings(entity['@id'])),
    )
    return {
      entities,
      literals: literals.filter((literal) => !resolvedEntityIds.has(literal)),
    }
  }

  protected readGraph(crate: unknown): RoCrateEntity[] {
    if (!crate || typeof crate !== 'object' || Array.isArray(crate)) {
      return []
    }
    const graph = (crate as Record<string, unknown>)['@graph']
    return Array.isArray(graph)
      ? graph.filter(
          (entity): entity is RoCrateEntity =>
            !!entity && typeof entity === 'object' && !Array.isArray(entity),
        )
      : []
  }

  protected firstMeaningfulString(...values: unknown[]): string | undefined {
    return values
      .flatMap((value) => this.readStrings(value))
      .find((value) => value !== './' && value !== '.')
  }

  protected readStrings(value: unknown): string[] {
    if (typeof value === 'string') {
      return value.trim() ? [value.trim()] : []
    }
    if (Array.isArray(value)) {
      return this.uniqueStrings(value.flatMap((item) => this.readStrings(item)))
    }
    return []
  }

  protected uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter((value) => value.trim() !== '')))
  }

  protected uniqueEntities(entities: RoCrateEntity[]): RoCrateEntity[] {
    const seen = new Set<string>()
    const unique: RoCrateEntity[] = []
    for (const entity of entities) {
      const key = this.readStrings(entity['@id'])[0]
      if (key && seen.has(key)) {
        continue
      }
      if (key) {
        seen.add(key)
      }
      unique.push(entity)
    }
    return unique
  }

  protected entitiesWithType(graph: RoCrateEntity[], typeName: string): RoCrateEntity[] {
    return graph.filter((entity) => this.readStrings(entity['@type']).includes(typeName))
  }

  protected looksLikeEntityId(value: string): boolean {
    return (
      value.startsWith('#') ||
      value.startsWith('./') ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
    )
  }

  protected isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
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

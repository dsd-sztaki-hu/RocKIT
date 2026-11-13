// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { CommandService } from '@theia/core/lib/common'
import { nls } from '@theia/core/lib/common/nls'
import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import URI from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service'
import { inject, injectable } from 'inversify'
import { CrosswalkRegistry } from 'crosswalk-manager/lib/browser/crosswalk-registry'

import {
  RepositoryOperation,
  RepositoryOperationInvocation,
  RepositoryProviderRegistry,
} from './repository-provider-registry'
import { DataRepositoryConfig } from './types'
import { RepositoryCrosswalkService } from './services/repository-crosswalk-service'
import { mergeRoCratesForSync } from './services/ro-crate-sync-merge'
import { RepositorySyncMode } from './types'
import { RepositoryOperationProgressService } from './repository-operation-progress'
import {
  appendExportLogEvent,
  normalizeExportLogEntries,
  serializeExportLogEntries,
} from './services/export-log'

type JsonObject = Record<string, unknown>

/**
 * Application-side entry point for repository operations.
 *
 * RocKIT calls this service without knowing which extension implements the
 * operation. The registered command id is the serializable bridge into the
 * VS Code/Theia plugin host.
 */
@injectable()
export class RepositoryProviderService {
  @inject(RepositoryOperationProgressService)
  protected readonly operationProgressService: RepositoryOperationProgressService

  beginOperationProgress(repository: DataRepositoryConfig, operation: RepositoryOperation, message?: string) {
    return this.operationProgressService.begin(repository, operation, message)
  }

  withOperationProgress<T>(repository: DataRepositoryConfig, operation: RepositoryOperation, task: () => Promise<T>): Promise<T> {
    return this.operationProgressService.run(repository, operation, task)
  }

  reportOperationProgress(value: import('./repository-operation-progress').RepositoryProgressReport): void {
    this.operationProgressService.report(value)
  }

  updateOperationProgress(repository: DataRepositoryConfig, operation: RepositoryOperation, message: string): void {
    const context = this.operationProgressService?.contextFor(repository, operation)
    if (context) this.operationProgressService.report({ ...context, message })
  }

  withUserInput<T>(task: () => Promise<T>): Promise<T> {
    return this.operationProgressService.withUserInput(task)
  }
  constructor(
    @inject(RepositoryProviderRegistry)
    protected readonly registry: RepositoryProviderRegistry,
    @inject(CommandService)
    protected readonly commandService: CommandService,
    @inject(CrosswalkRegistry)
    protected readonly crosswalkRegistryService: CrosswalkRegistry,
    @inject(RepositoryCrosswalkService)
    protected readonly crosswalkService: RepositoryCrosswalkService,
    @inject(FileService)
    protected readonly fileService: FileService,
    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService,
  ) {}

  listProviders() {
    return this.registry.list()
  }

  getProviderForRepository(repository: DataRepositoryConfig) {
    return repository.providerId ? this.registry.get(repository.providerId) : undefined
  }

  supports(repository: DataRepositoryConfig, operation: RepositoryOperation): boolean {
    return Boolean(this.getProviderForRepository(repository)?.operations[operation])
  }

  async executeForRepository<TInput = unknown, TResult = unknown>(
    repository: DataRepositoryConfig,
    operation: RepositoryOperation,
    input?: TInput,
  ): Promise<TResult | undefined> {
    if (!repository.providerId) {
      throw new Error(
        `Repository connection '${repository.id}' is not associated with an extension provider.`,
      )
    }
    let crosswalkId = this.crosswalkIdFromInput(input)
    const zenodoCrosswalks = repository.providerId === 'zenodo' && operation === 'create'
      ? (await this.crosswalkRegistryService.list()).filter((crosswalk) =>
          crosswalk.repositories?.some(
            (repositoryType) => repositoryType.toLocaleLowerCase() === 'zenodo',
          ),
        )
      : []
    if (!crosswalkId && zenodoCrosswalks.length) {
      crosswalkId = zenodoCrosswalks[0].id
    }
    let operationInput: unknown = input
    if (
      crosswalkId &&
      ['create', 'update', 'sync', 'import', 'link'].includes(operation)
    ) {
      if (!(await this.crosswalkRegistryService.read(crosswalkId))) {
        throw new Error(
          `The selected crosswalk '${crosswalkId}' is no longer registered.`,
        )
      }
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error(`The '${operation}' repository operation requires an object input.`)
      }
      operationInput = {
        ...input,
        crosswalkId,
      }
    }
    if (repository.providerId === 'zenodo' && ['create', 'update'].includes(operation)) {
      const metadataUri = this.workspaceMetadataUri()
      const crate = await this.readCrate(metadataUri)
      const prepared = crosswalkId
        ? await this.crosswalkService.prepareRepositoryMetadata({
            repositoryType: 'zenodo',
            crosswalkId,
            crate,
            forUpdate: operation === 'update',
            crosswalkOptions: operation === 'create'
              ? zenodoCrosswalks.map((crosswalk) => ({
                  value: crosswalk.id,
                  label: crosswalk.name,
                }))
              : undefined,
          })
        : { metadata: this.unmappedRootMetadata(crate), crosswalkId: undefined }
      crosswalkId = prepared.crosswalkId
      const nextOperationInput = { ...(operationInput as JsonObject) }
      delete nextOperationInput.crosswalkId
      operationInput = {
        ...nextOperationInput,
        ...(crosswalkId ? { crosswalkId } : {}),
        repositoryMetadata: prepared.metadata,
      }
    }

    const result = await this.execute<unknown, TResult>({
      providerId: repository.providerId,
      operation,
      input: operationInput,
    })
    this.updateOperationProgress(repository, operation, nls.localize('rockit/dataRepository/progress/finishing', 'Updating local repository data...'))
    if (repository.providerId === 'zenodo' && result && operation === 'import') {
      return this.completeZenodoImport(repository, result as JsonObject, crosswalkId) as TResult
    }
    if (repository.providerId === 'zenodo' && result && operation === 'sync') {
      return this.completeZenodoSync(repository, result as JsonObject, crosswalkId) as TResult
    }
    return result
  }

  protected async completeZenodoImport(
    repository: DataRepositoryConfig,
    result: JsonObject,
    crosswalkId?: string,
  ): Promise<JsonObject> {
    if (result.cancelled) return result
    const workspaceUri = this.requireUri(result.importedWorkspaceUri)
    const crate = this.requireObject(result.crate, 'imported RO-Crate')
    const importedCrate = crosswalkId
      ? (await this.crosswalkService.applyRepositoryMetadata({
          repositoryType: 'zenodo',
          crosswalkId,
          crate,
          metadata: this.requireObject(result.repositoryMetadata, 'Zenodo metadata'),
        })).crate
      : crate
    await this.writeCrate(workspaceUri.resolve('ro-crate-metadata.json'), importedCrate)
    await this.completeZenodoLog(
      workspaceUri, repository, result, importedCrate, 'update', crosswalkId)
    void this.workspaceService.open(workspaceUri, { preserveWindow: false })
    const { crate: _crate, repositoryMetadata: _metadata, ...summary } = result
    return { ...summary, openedWorkspace: true }
  }

  protected async completeZenodoSync(
    repository: DataRepositoryConfig,
    result: JsonObject,
    crosswalkId?: string,
  ): Promise<JsonObject> {
    const localCrate = this.requireObject(result.localCrate, 'local RO-Crate')
    const remoteCrate = this.requireObject(result.remoteCrate, 'remote RO-Crate')
    const mapped = crosswalkId
      ? await this.crosswalkService.applyRepositoryMetadata({
          repositoryType: 'zenodo',
          crosswalkId,
          crate: remoteCrate,
          metadata: this.requireObject(result.repositoryMetadata, 'Zenodo metadata'),
        })
      : { crate: remoteCrate, updatedFields: [] }
    const mode = result.metadataSource
    if (!['complete', 'remote-additions', 'local-additions'].includes(String(mode))) {
      throw new Error('The repository returned an invalid synchronization mode.')
    }
    const merged = mergeRoCratesForSync(localCrate, mapped.crate, mode as RepositorySyncMode)
    const metadataUri = this.workspaceMetadataUri()
    await this.writeCrate(metadataUri, merged)
    await this.completeZenodoLog(
      metadataUri.parent, repository, result, merged, 'sync', crosswalkId)
    const { localCrate: _local, remoteCrate: _remote, repositoryMetadata: _metadata, ...summary } = result
    return { ...summary, updatedMetadataFields: mapped.updatedFields }
  }

  protected workspaceMetadataUri(): URI {
    const root = this.workspaceService.tryGetRoots()?.[0]?.resource
    if (!root) throw new Error('Open an RO-Crate workspace before exporting or syncing.')
    return root.resolve('ro-crate-metadata.json')
  }

  protected async readCrate(uri: URI): Promise<JsonObject> {
    const content = await this.fileService.readFile(uri)
    return this.requireObject(JSON.parse(content.value.toString()), 'local RO-Crate')
  }

  protected unmappedRootMetadata(crate: JsonObject): JsonObject {
    const graph = crate['@graph']
    if (!Array.isArray(graph)) {
      throw new Error('The RO-Crate does not contain an @graph array.')
    }
    const root = graph.find(entity =>
      entity && typeof entity === 'object' && !Array.isArray(entity) && entity['@id'] === './',
    )
    if (!root) {
      throw new Error('The RO-Crate does not contain a root dataset entity.')
    }
    return Object.fromEntries(
      Object.entries(root).filter(([field]) => !field.startsWith('@')),
    )
  }

  protected async writeCrate(uri: URI, crate: JsonObject): Promise<void> {
    await this.fileService.writeFile(uri, BinaryBuffer.fromString(`${JSON.stringify(crate, null, 2)}\n`))
  }

  protected async completeZenodoLog(
    workspaceUri: URI,
    repository: DataRepositoryConfig,
    result: JsonObject,
    crate: JsonObject,
    action: 'update' | 'sync',
    crosswalkId?: string,
  ): Promise<void> {
    const logUri = workspaceUri.resolve('.rockit/export-log.json')
    const entries = normalizeExportLogEntries(
      JSON.parse((await this.fileService.readFile(logUri)).value.toString()),
    )
    const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : []
    const root = graph.find(entity => this.requireObject(entity, 'RO-Crate entity')['@id'] === './') as JsonObject | undefined
    const next = appendExportLogEvent(entries, {
      pid: String(result.remoteId || ''),
      target: String(result.landingPage || ''),
      repository: repository.baseUrl.replace(/\/+$/, ''),
      mappingFile: String(result.mappingFile || ''),
      crosswalkFile: crosswalkId,
      syncType: action,
      status: 'success',
      lastSuccessfulActionAt: new Date().toISOString(),
      datasetName: typeof root?.name === 'string' ? root.name : undefined,
    })
    await this.fileService.writeFile(
      logUri,
      BinaryBuffer.fromString(`${JSON.stringify(serializeExportLogEntries(next), null, 2)}\n`),
    )
  }

  protected requireObject(value: unknown, description: string): JsonObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`The repository did not return a valid ${description}.`)
    }
    return value as JsonObject
  }

  protected crosswalkIdFromInput(input: unknown): string | undefined {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
    const record = input as JsonObject
    if (typeof record.crosswalkId === 'string' && record.crosswalkId.trim()) {
      return record.crosswalkId.trim()
    }
    const target = record.exportTarget
    if (target && typeof target === 'object' && !Array.isArray(target)) {
      const value = (target as JsonObject).crosswalkFile
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return undefined
  }

  protected requireUri(value: unknown): URI {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error('The repository did not return an import workspace.')
    }
    return new URI(value)
  }

  async execute<TInput = unknown, TResult = unknown>(
    invocation: RepositoryOperationInvocation<TInput>,
  ): Promise<TResult | undefined> {
    const provider = this.registry.get(invocation.providerId)
    if (!provider) {
      throw new Error(`Repository provider '${invocation.providerId}' is not registered.`)
    }

    const commandId = provider.operations[invocation.operation]
    if (!commandId) {
      throw new Error(
        `Repository provider '${invocation.providerId}' does not support '${invocation.operation}'.`,
      )
    }

    const repository = (invocation.input as { repository?: DataRepositoryConfig })?.repository
    const progressContext = repository && this.operationProgressService?.contextFor(repository, invocation.operation)
    const input = progressContext ? { ...(invocation.input as object), progressContext } : invocation.input
    return this.commandService.executeCommand<TResult>(commandId, input)
  }
}

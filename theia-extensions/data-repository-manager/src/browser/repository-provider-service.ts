// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { CommandService } from '@theia/core/lib/common'
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
    let operationInput: unknown = input
    if (
      repository.crosswalkId &&
      ['create', 'update', 'sync', 'import', 'link'].includes(operation)
    ) {
      if (!(await this.crosswalkRegistryService.read(repository.crosswalkId))) {
        throw new Error(
          `The selected crosswalk '${repository.crosswalkId}' is no longer registered.`,
        )
      }
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error(`The '${operation}' repository operation requires an object input.`)
      }
      operationInput = {
        ...input,
        crosswalkId: repository.crosswalkId,
      }
    }
    if (repository.providerId === 'zenodo' && ['create', 'update'].includes(operation)) {
      const metadataUri = this.workspaceMetadataUri()
      const crate = await this.readCrate(metadataUri)
      const repositoryMetadata = repository.crosswalkId
        ? await this.crosswalkService.prepareRepositoryMetadata({
            repositoryType: 'zenodo',
            crosswalkId: repository.crosswalkId,
            crate,
            forUpdate: operation === 'update',
          })
        : this.unmappedRootMetadata(crate)
      operationInput = { ...(operationInput as JsonObject), repositoryMetadata }
    }

    const result = await this.execute<unknown, TResult>({
      providerId: repository.providerId,
      operation,
      input: operationInput,
    })
    if (repository.providerId === 'zenodo' && result && operation === 'import') {
      return this.completeZenodoImport(repository, result as JsonObject) as TResult
    }
    if (repository.providerId === 'zenodo' && result && operation === 'sync') {
      return this.completeZenodoSync(repository, result as JsonObject) as TResult
    }
    return result
  }

  protected async completeZenodoImport(repository: DataRepositoryConfig, result: JsonObject): Promise<JsonObject> {
    if (result.cancelled) return result
    const workspaceUri = this.requireUri(result.importedWorkspaceUri)
    const crate = this.requireObject(result.crate, 'imported RO-Crate')
    const importedCrate = repository.crosswalkId
      ? (await this.crosswalkService.applyRepositoryMetadata({
          repositoryType: 'zenodo',
          crosswalkId: repository.crosswalkId,
          crate,
          metadata: this.requireObject(result.repositoryMetadata, 'Zenodo metadata'),
        })).crate
      : crate
    await this.writeCrate(workspaceUri.resolve('ro-crate-metadata.json'), importedCrate)
    await this.completeZenodoLog(workspaceUri, repository, result, importedCrate, 'update')
    void this.workspaceService.open(workspaceUri, { preserveWindow: false })
    const { crate: _crate, repositoryMetadata: _metadata, ...summary } = result
    return { ...summary, openedWorkspace: true }
  }

  protected async completeZenodoSync(repository: DataRepositoryConfig, result: JsonObject): Promise<JsonObject> {
    const localCrate = this.requireObject(result.localCrate, 'local RO-Crate')
    const remoteCrate = this.requireObject(result.remoteCrate, 'remote RO-Crate')
    const mapped = repository.crosswalkId
      ? await this.crosswalkService.applyRepositoryMetadata({
          repositoryType: 'zenodo',
          crosswalkId: repository.crosswalkId,
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
    await this.completeZenodoLog(metadataUri.parent, repository, result, merged, 'sync')
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
      crosswalkFile: repository.crosswalkId,
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

    return this.commandService.executeCommand<TResult>(commandId, invocation.input)
  }
}

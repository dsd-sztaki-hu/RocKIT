// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

// src/browser/services/metadata-schema-manager-service.ts

import { injectable, inject, postConstruct } from 'inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { URI } from '@theia/core/lib/common/uri';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { nls } from '@theia/core/lib/common';

import { AppStateService } from 'app-state/lib/browser/state/app-state-service';
import { CedarTemplateToDescriboProfileConverter } from 'cedar-template-converter';
import type { ProfileHealthIssue, ProfileHealthStatus, SchemaInfo, SchemaIndex, RemoteSchemaProviderConfig } from '../types';
import { SchemaApi } from './schema-api';
import type { MetadataSchemaManager as MetadataSchemaManagerContract } from 'rockit-common/lib/browser';
import {
  buildRedirectDerivedCandidates,
  buildSchemaFetchCandidates,
} from 'rockit-common/lib/common/schema-url-resolution';
import { RemoteSchemaProviderStoreService } from './remote-schema-provider-store-service';
import { MissingSchemasDialog } from '../components/missing-schemas-dialog'; 
import { LoadMaskService } from 'rockit-loadmask/lib/browser/loadmask-service';
import {
  CedarProfileLanguage,
  toCedarProfileLanguage,
  toLocalizedConvertedProfilePath,
} from './cedar-profile-language';

export const SCHEMA_FIELD_NAME = 'schema:name';
export const SCHEMA_FIELD_VERSION = 'pav:version';
export const SCHEMA_FIELD_ID = '@id';
export const SCHEMA_FIELD_CREATED_ON = 'pav:createdOn';
export const SCHEMA_FIELD_UPDATED_ON = 'pav:lastUpdatedOn';
const MSG_TIMEOUT = 5000;

export interface TaskProgress {
  report(progress: { message?: string; work?: { done: number; total: number } }): void;
  cancel(): void;
}

@injectable()
export class SchemaManagerService implements FrontendApplicationContribution, MetadataSchemaManagerContract {
  
  @inject(AppStateService) protected readonly appStateService!: AppStateService;
  @inject(FileService) protected readonly fileService!: FileService;
  @inject(MessageService) protected readonly messageService!: MessageService;
  @inject(LoadMaskService) protected readonly loadMaskService!: LoadMaskService;
  @inject(EnvVariablesServer) protected readonly envVariablesServer!: EnvVariablesServer;
  @inject(RemoteSchemaProviderStoreService) public readonly providerStoreService!: RemoteSchemaProviderStoreService; 

  private isChecking = false;
  private indexMutex: Promise<void> = Promise.resolve();

  private pendingSchemas = new Map<string, SchemaInfo>();
  private abortControllers = new Map<string, AbortController>();

  private arpProdPrefix = 'https://repo.schema.researchdata.hu/templates/';
  private arpDevPrefix = 'https://repo.cedardev.dsd.sztaki.hu/templates/';
  private arpW3idProd = 'https://w3id.org/arp/schema/';
  private arpW3idDev = 'https://w3id.org/arp/dev/schema/';

  private readonly onDidChangeSchemasEmitter = new Emitter<void>();
  readonly onDidChangeSchemas: Event<void> = this.onDidChangeSchemasEmitter.event;

  private readonly onOpenRemoteBrowserEmitter = new Emitter<RemoteSchemaProviderConfig>();
  readonly onOpenRemoteBrowser: Event<RemoteSchemaProviderConfig> = this.onOpenRemoteBrowserEmitter.event;

  @postConstruct()
  init() {
    this.loadEnvVariables();

    this.appStateService.onDidChangeSelector(state => state.roCrate)(
      (newCrate) => {
        if (newCrate) this.checkAndDownloadSchemas(newCrate);
      }
    );

    this.appStateService.onDidChangeSelector((state: any) => state.profileList)(
      (newList) => {
        if (newList) this.syncProfileListFlags(newList);
      }
    );

    this.onDidChangeSchemas(() => {
      const state = this.appStateService.getState() as any;
      if (state.profileList) {
        this.syncProfileListFlags(state.profileList);
      }
    });
  }

  private async syncProfileListFlags(profileList: any[]): Promise<void> {
    if (!Array.isArray(profileList) || profileList.length === 0) return;

    const schemas = await this.loadAllSchemas();
    let isChanged = false;
    let hasMissingSchemas = false;

    const updatedProfileList = profileList.map(profile => {
      const matchedSchema = schemas.find(s => s.conformsTo === profile.id || s.aux.reference === profile.id);
      const newFlag = matchedSchema ? (matchedSchema.status || 'ok') : 'missing';

      if (newFlag === 'missing') {
        hasMissingSchemas = true;
      }

      if (profile.flag !== newFlag) {
        isChanged = true;
        return { ...profile, flag: newFlag };
      }
      return profile;
    });

    if (isChanged) {
      this.appStateService.updateState({ profileList: updatedProfileList } as any);
    }

    if (hasMissingSchemas && !this.isChecking) {
      const currentCrate = this.appStateService.roCrate;
      if (currentCrate) {
        this.checkAndDownloadSchemas(currentCrate).catch(err => {
          console.error('[SchemaManager] Background schema recovery failed:', err);
        });
      }
    }
  }

  private async loadEnvVariables() {
    const prodPrefix = await this.envVariablesServer.getValue('ARP_PROD_PREFIX');
    if (prodPrefix?.value) this.arpProdPrefix = prodPrefix.value;
    
    const devPrefix = await this.envVariablesServer.getValue('ARP_DEV_PREFIX');
    if (devPrefix?.value) this.arpDevPrefix = devPrefix.value;
    
    const w3idProd = await this.envVariablesServer.getValue('ARP_W3ID_PROD');
    if (w3idProd?.value) this.arpW3idProd = w3idProd.value;
    
    const w3idDev = await this.envVariablesServer.getValue('ARP_W3ID_DEV');
    if (w3idDev?.value) this.arpW3idDev = w3idDev.value;
  }

  async onStart(): Promise<void> {
    // Initialize the one-time default provider before the user opens any schema UI.
    await this.providerStoreService.loadProviders();
    await this.synchronizeIndex();

    const currentCrate = this.appStateService.roCrate;
    if (currentCrate) this.checkAndDownloadSchemas(currentCrate);
  }

  private async synchronizeIndex(): Promise<void> {
    await (this.indexMutex = this.indexMutex.then(async () => {
      const root = await this.getRockitRootUri();
      if (!root) return;

      const index = await this.loadIndex();
      const validProfiles: SchemaInfo[] = [];
      let indexChanged = false;
      for (const profile of index.profiles) {
        const sourceUri = root.resolve(profile.files.sourcePath);
        const convertedUri = root.resolve(profile.files.convertedPath);
        
        const sourceExists = await this.fileService.exists(sourceUri);
        const convertedExists = await this.fileService.exists(convertedUri);

        if (sourceExists && profile.type === 'cedar') {
          try {
            if (await this.ensureCedarConvertedProfiles(root, profile)) {
              indexChanged = true;
            }
            validProfiles.push(profile);
          } catch (error) {
            // Keep the raw template and index entry. A later language-specific
            // read can retry conversion without forcing another download.
            console.warn(
              `[SchemaManager] Failed to generate localized profiles for ${profile.name}`,
              error,
            );
            validProfiles.push(profile);
          }
          continue;
        }

        if (sourceExists && convertedExists) {
          validProfiles.push(profile);
        } else {
          console.warn(`[SchemaManager] Removing corrupted index entry: ${profile.name}`);
          indexChanged = true;
          if (sourceExists) await this.fileService.delete(sourceUri);
          if (convertedExists) await this.fileService.delete(convertedUri);
        }
      }

      index.profiles = validProfiles;

      const cedarDir = root.resolve('metadata-schemas/cedar');
      if (await this.fileService.exists(cedarDir)) {
        const stat = await this.fileService.resolve(cedarDir);
        if (stat && stat.children) {
          for (const file of stat.children) {
            if (!file.name.endsWith('.json')) continue;
            
            const relativeCedarPath = `metadata-schemas/cedar/${file.name}`;
            const isIndexed = index.profiles.some(p => p.files.sourcePath === relativeCedarPath);
            
            if (!isIndexed) {
              try {
                const content = await this.fileService.read(file.resource);
                const parsedRaw = JSON.parse(content.value);
                
                const schemaName = parsedRaw[SCHEMA_FIELD_NAME];
                const schemaVersion = parsedRaw[SCHEMA_FIELD_VERSION] || '1.0.0';
                const schemaId = parsedRaw[SCHEMA_FIELD_ID] || ''; 
                const createdAt = parsedRaw[SCHEMA_FIELD_CREATED_ON] || null;
                const updatedAt = parsedRaw[SCHEMA_FIELD_UPDATED_ON] || null;

                if (!schemaName) continue;

                const conformsTo = this.deriveConformsToFromId(schemaId);
                
                let convertedEnglish: string;
                let convertedHungarian: string;
                try { 
                  convertedEnglish = this.convertCedarTemplate(content.value, 'en');
                  convertedHungarian = this.convertCedarTemplate(content.value, 'hu');
                } catch (convErr) { 
                  continue; 
                }
                
                const relativeRoCratePath = `metadata-schemas/ro-crate/${file.name}`;
                const relativeHungarianPath = toLocalizedConvertedProfilePath(
                  relativeRoCratePath,
                  'hu',
                );
                const roCrateUri = root.resolve(relativeRoCratePath);
                const hungarianUri = root.resolve(relativeHungarianPath);
                if (!await this.fileService.exists(roCrateUri.parent)) {
                  await this.fileService.createFolder(roCrateUri.parent);
                }
                if (!await this.fileService.exists(hungarianUri.parent)) {
                  await this.fileService.createFolder(hungarianUri.parent);
                }
                await Promise.all([
                  this.fileService.write(roCrateUri, convertedEnglish),
                  this.fileService.write(hungarianUri, convertedHungarian),
                ]);

                const idMatch = schemaId.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
                const uuidId = idMatch ? idMatch[1] : schemaId;

                const sourceMatch = file.name.match(/_(local|remote)_/);
                const source = sourceMatch ? sourceMatch[1] as 'local' | 'remote' : 'local';

                const newSchemaInfo: SchemaInfo = {
                  id: this.generateUniqueId(),
                  name: schemaName,
                  version: schemaVersion,
                  source: source,
                  type: 'cedar',
                  files: {
                    sourcePath: relativeCedarPath,
                    convertedPath: relativeRoCratePath,
                    convertedPaths: {
                      en: relativeRoCratePath,
                      hu: relativeHungarianPath,
                    },
                  },
                  aux: {
                    templateUuid: uuidId,
                    reference: schemaId,
                  },
                  conformsTo: conformsTo,
                  downloadUrl: '',
                  createdAt: createdAt,
                  updatedAt: updatedAt,
                  downloadedAt: new Date().toISOString(),
                  status: 'ok'
                };

                index.profiles.push(newSchemaInfo);
                indexChanged = true;
              } catch (e) {
                console.warn(`[SchemaManager] Failed to recover file ${file.name}`, e);
              }
            }
          }
        }
      }

      if (indexChanged) {
        this.rebuildConformsToIndex(index);
        await this.saveIndex(index);
        this.onDidChangeSchemasEmitter.fire();
      }
    }).catch(err => {
      console.error("[SchemaManager] Synchronization failed", err);
    }));
  }

  private async processInChunks<T>(
    items: T[], 
    chunkSize: number, 
    iteratorFn: (item: T) => Promise<void>, 
    progressCb?: (completed: number) => void
  ) {
    let completed = 0;
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (item) => {
        try {
          await iteratorFn(item);
        } catch (e) {
          console.error("Error processing item in chunk:", e);
        } finally {
          completed++;
          if (progressCb) progressCb(completed);
        }
      }));
      await new Promise(r => setTimeout(r, 0));
    }
  }

  public clearFailedPendingSchemas(): void {
    for (const [id, schema] of this.pendingSchemas.entries()) {
      if (schema.status === 'failed') {
        this.pendingSchemas.delete(id);
        this.abortControllers.delete(id);
      }
    }
    this.onDidChangeSchemasEmitter.fire();
  }

  public async retrySchema(id: string): Promise<void> {
    const schema = this.pendingSchemas.get(id);
    if (!schema || schema.status !== 'failed') return;
    if (!schema.downloadUrl) {
        schema.statusMessage = nls.localize(
          'rockit/schemaManager/cannotRetryWithoutUrl',
          'Cannot retry: No URL provided.',
        );
        this.onDidChangeSchemasEmitter.fire();
        return;
    }

    schema.status = 'downloading';
    schema.statusMessage = nls.localize(
      'rockit/schemaManager/retryingConnection',
      'Retrying connection...',
    );
    
    const controller = new AbortController();
    this.abortControllers.set(id, controller);
    
    this.onDidChangeSchemasEmitter.fire();

    try {
      const provider = await this.determineProviderForUrl(schema.downloadUrl);
      const apiKey = this.providerApiKey(provider);
      const proxyUrl = this.providerProxyUrl(provider);
      const { content, finalUrl } = await this.resolveJsonProfileUrl(
        schema.downloadUrl,
        provider,
        apiKey,
        controller.signal,
      );

      schema.status = 'processing';
      schema.statusMessage = nls.localize('rockit/schemaManager/converting', 'Converting to RO-Crate...');
      this.onDidChangeSchemasEmitter.fire();
      
      const schemaName = await this.processAndSaveSchema(content, 'remote', undefined, {
        downloadUrl: finalUrl,
        conformsTo: schema.conformsTo || ''
      });
      
      this.pendingSchemas.delete(id);
      this.abortControllers.delete(id);
      this.onDidChangeSchemasEmitter.fire();
      
      this.messageService.info(nls.localize(
        'rockit/schemaManager/importedName',
        'Successfully imported: {0}',
        schemaName,
      ), { timeout: MSG_TIMEOUT });

    } catch (error: any) {
      if (error.name === 'AbortError' || error.message === 'Aborted') {
        this.pendingSchemas.delete(id);
        this.abortControllers.delete(id);
        this.onDidChangeSchemasEmitter.fire();
      } else {
        schema.status = 'failed';
        schema.statusMessage = error.message || nls.localize(
          'rockit/validation/unknownError',
          'Unknown error',
        );
        this.abortControllers.delete(id);
        this.onDidChangeSchemasEmitter.fire();
      }
    }
  }

  public async browseRemoteSchemas(provider: RemoteSchemaProviderConfig): Promise<void> {
    this.onOpenRemoteBrowserEmitter.fire(provider);
  }

  public async downloadRemoteSchema(templateId: string, provider?: RemoteSchemaProviderConfig): Promise<void> {
    let apiKey = provider?.accessMode === 'apiKey' ? provider?.apiKey : undefined;
    let domainBase = provider?.domainBase || provider?.baseUrl;

    if (!provider) {
      throw new Error(nls.localize(
        'rockit/schemaManager/noRemoteProvider',
        'No Remote Provider context available for download.',
      ));
    } else {
       domainBase = domainBase!.replace(/(^\w+:|^)\/\//, '').replace(/\/+$/, '');
    }

    const api = new SchemaApi({
        domainBase: domainBase,
        apiKey: apiKey,
        proxyUrl: this.providerProxyUrl(provider)
    });

    const url = `https://resource.${domainBase}/templates/${encodeURIComponent(templateId)}`;

    const isDuplicate = Array.from(this.pendingSchemas.values()).some(s => s.downloadUrl === url && s.status !== 'failed');
    if (isDuplicate) throw new Error(nls.localize(
      'rockit/schemaManager/downloadInProgress',
      'Download already in progress.',
    ));

    const id = this.generateUniqueId();
    const controller = new AbortController();
    this.abortControllers.set(id, controller);

    const pendingSchema: SchemaInfo = {
      id,
      name: nls.localize('rockit/schemaManager/remoteTemplate', 'Remote Template'),
      version: '...',
      source: 'remote',
      type: 'cedar',
      files: { sourcePath: '', convertedPath: '' },
      aux: { reference: templateId },
      conformsTo: '',
      downloadUrl: url,
      createdAt: null, updatedAt: null, downloadedAt: new Date().toISOString(),
      status: 'downloading',
      statusMessage: nls.localize(
        'rockit/schemaManager/connectingTo',
        'Connecting to {0}...',
        provider.title,
      )
    };
    this.pendingSchemas.set(id, pendingSchema);
    this.onDidChangeSchemasEmitter.fire();

    try {
      const schemaContent = await new Promise<any>((resolve, reject) => {
        const abortHandler = () => reject(new Error('Aborted'));
        controller.signal.addEventListener('abort', abortHandler);
        
        api.downloadSchema(templateId).then(res => {
            controller.signal.removeEventListener('abort', abortHandler);
            if (!controller.signal.aborted) resolve(res);
        }).catch(err => {
            controller.signal.removeEventListener('abort', abortHandler);
            reject(err);
        });
      });

      if (controller.signal.aborted) throw new Error('Aborted');

      const rawString = typeof schemaContent === 'string' 
        ? schemaContent 
        : JSON.stringify(schemaContent, null, 2);

      pendingSchema.status = 'processing';
      pendingSchema.statusMessage = nls.localize('rockit/schemaManager/converting', 'Converting to RO-Crate...');
      this.onDidChangeSchemasEmitter.fire();

      const name = await this.processAndSaveSchema(rawString, 'remote', undefined, {
        downloadUrl: url, 
        conformsTo: '' 
      });
      
      this.pendingSchemas.delete(id);
      this.abortControllers.delete(id);
      this.onDidChangeSchemasEmitter.fire();

      this.messageService.info(nls.localize(
        'rockit/schemaManager/addedSchema',
        'Successfully added schema: {0}',
        name,
      ), { timeout: MSG_TIMEOUT });

    } catch (error: any) {
      if (error.message === 'Aborted' || error.name === 'AbortError') {
        this.pendingSchemas.delete(id);
        this.abortControllers.delete(id);
        this.onDidChangeSchemasEmitter.fire();
        throw new Error('Aborted');
      } else {
        pendingSchema.status = 'failed';
        pendingSchema.statusMessage = error.message || nls.localize(
          'rockit/validation/unknownError',
          'Unknown error',
        );
        this.abortControllers.delete(id);
        this.onDidChangeSchemasEmitter.fire();
        throw error;
      }
    }
  }

  private async fetchWithAuthFallback(url: string, apiKey?: string, signal?: AbortSignal, proxyUrl?: string): Promise<{ content: string, finalUrl: string }> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Accept': 'application/json' 
    };

    const fetchAttempt = async (useKey: boolean): Promise<Response> => {
      const currentHeaders: Record<string, string> = { ...headers as Record<string, string> };
      if (useKey && apiKey) {
        currentHeaders['Authorization'] = `apiKey ${apiKey}`;
      }
      const actualUrl = proxyUrl ? proxyUrl + encodeURIComponent(url) : url;
      return fetch(actualUrl, { method: 'GET', headers: currentHeaders, signal });
    };

    let response: Response;
    if (apiKey && !proxyUrl) {
      response = await fetchAttempt(true);
      if (response.status === 401 || response.status === 403) {
        response = await fetchAttempt(false);
      }
    } else {
      response = await fetchAttempt(false);
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(nls.localize(
          'rockit/schemaManager/unauthorizedAccess',
          'Unauthorized access to {0}. Please configure a Remote Provider.',
          url,
        ));
      }
      if (response.status === 404) {
        throw new Error(nls.localize(
          'rockit/schemaManager/resourceNotFound',
          'Resource not found at {0}.',
          url,
        ));
      }
      throw new Error(nls.localize(
        'rockit/schemaManager/fetchFailed',
        'Fetch failed: {0} {1}',
        response.status,
        response.statusText,
      ));
    }

    const content = await response.text();
    return { content, finalUrl: response.url };
  }

  private async resolveJsonProfileUrl(
    url: string,
    provider?: RemoteSchemaProviderConfig,
    apiKey?: string,
    signal?: AbortSignal,
  ): Promise<{ content: string, finalUrl: string }> {
    const configuredProviders = await this.loadSchemaResolveProviders();
    const rankedProviders = this.rankSchemaResolveProviders(url, configuredProviders, provider);
    let lastError: unknown;
    const attempted = new Set<string>();
    const queue: Array<{ candidate: string; provider?: RemoteSchemaProviderConfig }> = [];

    this.enqueueSchemaResolveCandidates(queue, attempted, url, rankedProviders);
    while (queue.length > 0) {
      const entry = queue.shift()!;
      const attemptKey = this.schemaResolveAttemptKey(entry.candidate, entry.provider);
      if (attempted.has(attemptKey)) {
        continue;
      }
      attempted.add(attemptKey);

      const effectiveKey = apiKey || this.providerApiKey(entry.provider);
      const proxyUrl = this.providerProxyUrl(entry.provider);
      try {
        const result = await this.fetchWithAuthFallback(
          entry.candidate,
          effectiveKey,
          signal,
          proxyUrl,
        );
        try {
          JSON.parse(result.content);
          return result;
        } catch {
          const redirectProviders = this.rankSchemaResolveProviders(
            result.finalUrl,
            configuredProviders,
            entry.provider,
          );
          this.enqueueRedirectCandidates(queue, attempted, result.finalUrl, redirectProviders);
          lastError = new Error(
            `The URL ${entry.candidate} resolved to non-JSON content at ${result.finalUrl}.`,
          );
        }
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`The URL ${url} could not be resolved to a JSON schema endpoint.`);
  }

  private async loadSchemaResolveProviders(): Promise<RemoteSchemaProviderConfig[]> {
    try {
      return await this.providerStoreService.loadProviders();
    } catch {
      return [];
    }
  }

  private rankSchemaResolveProviders(
    url: string,
    providers: RemoteSchemaProviderConfig[],
    preferred?: RemoteSchemaProviderConfig,
  ): Array<RemoteSchemaProviderConfig | undefined> {
    const ranked: Array<RemoteSchemaProviderConfig | undefined> = [undefined];
    const seen = new Set<string>();
    const push = (candidate?: RemoteSchemaProviderConfig) => {
      if (!candidate) {
        return;
      }
      const key = this.schemaResolveProviderKey(candidate);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      ranked.push(candidate);
    };

    push(preferred);
    const targetHost = this.safeSchemaResolveHost(url);
    for (const candidate of providers) {
      const providerHosts = [
        candidate.domainBase,
        candidate.baseUrl,
        candidate.resourceBaseUrl,
        candidate.dataverseProxyBaseUrl,
      ]
        .map((value) => this.safeSchemaResolveHost(value))
        .filter((value): value is string => Boolean(value));
      if (
        targetHost &&
        providerHosts.some(
          (providerHost) =>
            targetHost.includes(providerHost) || providerHost.includes(targetHost),
        )
      ) {
        push(candidate);
      }
    }
    for (const candidate of providers) {
      push(candidate);
    }
    return ranked;
  }

  private enqueueSchemaResolveCandidates(
    queue: Array<{ candidate: string; provider?: RemoteSchemaProviderConfig }>,
    attempted: Set<string>,
    url: string,
    providers: Array<RemoteSchemaProviderConfig | undefined>,
  ): void {
    for (const candidateProvider of providers) {
      for (const candidate of buildSchemaFetchCandidates(url, candidateProvider)) {
        const key = this.schemaResolveAttemptKey(candidate, candidateProvider);
        if (
          !attempted.has(key) &&
          !queue.some(
            (entry) => this.schemaResolveAttemptKey(entry.candidate, entry.provider) === key,
          )
        ) {
          queue.push({ candidate, provider: candidateProvider });
        }
      }
    }
  }

  private enqueueRedirectCandidates(
    queue: Array<{ candidate: string; provider?: RemoteSchemaProviderConfig }>,
    attempted: Set<string>,
    finalUrl: string,
    providers: Array<RemoteSchemaProviderConfig | undefined>,
  ): void {
    for (const candidateProvider of providers) {
      for (const candidate of buildRedirectDerivedCandidates(finalUrl, candidateProvider)) {
        const key = this.schemaResolveAttemptKey(candidate, candidateProvider);
        if (
          !attempted.has(key) &&
          !queue.some(
            (entry) => this.schemaResolveAttemptKey(entry.candidate, entry.provider) === key,
          )
        ) {
          queue.push({ candidate, provider: candidateProvider });
        }
      }
    }
  }

  private schemaResolveAttemptKey(
    candidate: string,
    provider?: RemoteSchemaProviderConfig,
  ): string {
    return `${this.schemaResolveProviderKey(provider)}::${candidate}`;
  }

  private schemaResolveProviderKey(provider?: RemoteSchemaProviderConfig): string {
    if (!provider) {
      return 'direct';
    }
    return (
      provider.id ||
      provider.domainBase ||
      provider.baseUrl ||
      provider.resourceBaseUrl ||
      'provider'
    );
  }

  private safeSchemaResolveHost(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }
    try {
      return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase();
    } catch {
      return undefined;
    }
  }

  private async resolveConformanceUrl(url: string, apiKey?: string, signal?: AbortSignal): Promise<{ content: string, finalUrl: string }> {
    const provider = await this.determineProviderForUrl(url);
    return this.resolveJsonProfileUrl(url, provider, apiKey, signal);
  }

  private async determineProviderForUrl(url: string): Promise<RemoteSchemaProviderConfig | undefined> {
    try {
      const providers = await this.providerStoreService.loadProviders();
      const targetHost = new URL(url).hostname.toLowerCase();

      const matchedProvider = providers.find(p => {
        try {
          const sourceUrl = p.domainBase || p.baseUrl;
          const providerHost = new URL(/^https?:\/\//i.test(sourceUrl) ? sourceUrl : `https://${sourceUrl}`).hostname.toLowerCase();
          const domainHost = sourceUrl.replace(/(^\w+:|^)\/\//, '').replace(/\/+$/, '').toLowerCase();
          return targetHost.includes(providerHost) || providerHost.includes(targetHost) || targetHost.includes(domainHost);
        } catch { return false; }
      });

      return matchedProvider;
    } catch (e) {
      console.error("Error determining provider for URL", e);
    }
    return undefined;
  }

  private providerApiKey(provider?: RemoteSchemaProviderConfig): string | undefined {
    const accessMode = provider?.accessMode || (provider?.apiKey ? 'apiKey' : 'dataverseProxy');
    return accessMode === 'apiKey' ? provider?.apiKey : undefined;
  }

  private providerProxyUrl(provider?: RemoteSchemaProviderConfig): string | undefined {
    const accessMode = provider?.accessMode || (provider?.apiKey ? 'apiKey' : 'dataverseProxy');
    if (accessMode !== 'dataverseProxy') return undefined;
    const baseUrl = provider?.dataverseProxyBaseUrl || this.deriveDataverseProxyBaseUrl(provider?.domainBase || provider?.baseUrl || '');
    return `${baseUrl.replace(/\/+$/, '')}/api/arp/cedarResourceProxy?url=`;
  }

  private deriveDataverseProxyBaseUrl(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return 'https://repo.researchdata.hu';
    try {
      const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
      const parts = url.hostname.split('.');
      const first = parts[0]?.toLowerCase();
      if (first === 'schema') {
        parts[0] = 'repo';
      } else if (['cedar', 'resource', 'open', 'openview'].includes(first)) {
        parts.shift();
        if (parts[0]?.toLowerCase() === 'schema') {
          parts[0] = 'repo';
        } else {
          parts.unshift('repo');
        }
      } else if (first !== 'repo') {
        parts.unshift('repo');
      }
      url.hostname = parts.join('.');
      url.pathname = '';
      url.search = '';
      url.hash = '';
      return url.origin;
    } catch {
      return trimmed;
    }
  }

  public async importFromUrl(url: string, progress: TaskProgress): Promise<string> {
    const isDuplicate = Array.from(this.pendingSchemas.values()).some(s => s.downloadUrl === url && s.status !== 'failed');
    if (isDuplicate) throw new Error(nls.localize(
      'rockit/schemaManager/downloadInProgress',
      'Download already in progress.',
    ));

    const id = this.generateUniqueId();
    const controller = new AbortController();
    this.abortControllers.set(id, controller);

    const pendingSchema: SchemaInfo = {
      id,
      name: url,
      version: '...',
      source: 'remote',
      type: 'cedar',
      files: { sourcePath: '', convertedPath: '' },
      aux: { reference: url },
      conformsTo: '',
      downloadUrl: url,
      createdAt: null, updatedAt: null, downloadedAt: new Date().toISOString(),
      status: 'downloading',
      statusMessage: nls.localize(
        'rockit/schemaManager/resolvingAccess',
        'Resolving access...',
      )
    };
    
    this.pendingSchemas.set(id, pendingSchema);
    this.onDidChangeSchemasEmitter.fire();
    
    try {
      progress.report({
        message: nls.localize(
          'rockit/schemaManager/resolvingAccess',
          'Resolving access...',
        ),
        work: { done: 10, total: 100 },
      });
      const provider = await this.determineProviderForUrl(url);
      const apiKey = this.providerApiKey(provider);
      const proxyUrl = this.providerProxyUrl(provider);
      
      pendingSchema.statusMessage = nls.localize(
        'rockit/schemaManager/downloadingSchema',
        'Downloading schema...',
      );
      this.onDidChangeSchemasEmitter.fire();
      progress.report({
        message: nls.localize(
          'rockit/schemaManager/downloadingEllipsis',
          'Downloading...',
        ),
        work: { done: 30, total: 100 },
      });

      const { content, finalUrl } = await this.resolveJsonProfileUrl(
        url,
        provider,
        apiKey,
        controller.signal,
      );

      pendingSchema.status = 'processing';
      pendingSchema.statusMessage = nls.localize(
        'rockit/schemaManager/converting',
        'Converting to RO-Crate...',
      );
      this.onDidChangeSchemasEmitter.fire();
      progress.report({
        message: nls.localize('rockit/schemaManager/processing', 'Processing...'),
        work: { done: 60, total: 100 },
      });
      
      const schemaName = await this.processAndSaveSchema(content, 'remote', undefined, {
        downloadUrl: finalUrl,
        conformsTo: '' 
      });
      
      this.pendingSchemas.delete(id);
      this.abortControllers.delete(id);
      this.onDidChangeSchemasEmitter.fire();
      progress.report({ work: { done: 100, total: 100 } });
      
      return schemaName;

    } catch (error: any) {
      if (error.name === 'AbortError' || error.message === 'Aborted') {
        this.pendingSchemas.delete(id);
        this.abortControllers.delete(id);
        this.onDidChangeSchemasEmitter.fire();
        throw new Error('Aborted');
      } else {
        pendingSchema.status = 'failed';
        pendingSchema.statusMessage = error.message || nls.localize(
          'rockit/validation/unknownError',
          'Unknown error',
        );
        this.abortControllers.delete(id);
        this.onDidChangeSchemasEmitter.fire();
        throw error;
      }
    }
  }

  protected async checkAndDownloadSchemas(roCrate: any): Promise<void> {
    if (this.isChecking || !roCrate || !roCrate['@graph']) return;
    this.isChecking = true;
    
    try {
      if (!navigator.onLine) return;
      const requiredIds = this.extractSchemaIds(roCrate);
      
      if (requiredIds.size === 0) return;
      
      const missingIds = await this.filterMissingSchemas(Array.from(requiredIds));
      if (missingIds.length === 0) return;

      await new Promise<void>((resolve) => {
        const dialog = new MissingSchemasDialog(missingIds.length);
        dialog.open().then(() => resolve());
      });

      await this.loadMaskService.showProgress({
        text: nls.localize('rockit/schemaManager/resolvingMissing', 'Resolving Missing Profiles...'),
      })
        .then(async (progress: TaskProgress) => {
          try {
            const total = missingIds.length;
            progress.report({
              message: nls.localize('rockit/schemaManager/starting', 'Starting...'),
              work: { done: 0, total },
            });

            await this.processInChunks(missingIds, 5, async (conformsToUrl) => {
              const isDuplicate = Array.from(this.pendingSchemas.values()).some(s => s.downloadUrl === conformsToUrl && s.status !== 'failed');
              if (isDuplicate) return;

              const id = this.generateUniqueId();
              const controller = new AbortController();
              this.abortControllers.set(id, controller);

              const pendingSchema: SchemaInfo = {
                id,
                name: conformsToUrl,
                version: '...',
                source: 'remote',
                type: 'cedar',
                files: { sourcePath: '', convertedPath: '' },
                aux: { reference: conformsToUrl },
                conformsTo: conformsToUrl,
                downloadUrl: conformsToUrl,
                createdAt: null, updatedAt: null, downloadedAt: new Date().toISOString(),
                status: 'downloading',
                statusMessage: nls.localize(
                  'rockit/schemaManager/autoResolvingDependency',
                  'Auto-resolving dependency...',
                )
              };
              this.pendingSchemas.set(id, pendingSchema);
              this.onDidChangeSchemasEmitter.fire();

              try { 
                const { content, finalUrl } = await this.resolveConformanceUrl(conformsToUrl, undefined, controller.signal);
                
                pendingSchema.status = 'processing';
                pendingSchema.statusMessage = nls.localize(
                  'rockit/schemaManager/converting',
                  'Converting to RO-Crate...',
                );
                this.onDidChangeSchemasEmitter.fire();

                await this.processAndSaveSchema(content, 'remote', undefined, {
                  conformsTo: conformsToUrl,
                  downloadUrl: finalUrl
                });
                
                this.pendingSchemas.delete(id);
                this.abortControllers.delete(id);
              } catch (e: any) { 
                if (e.message === 'Aborted' || e.name === 'AbortError') {
                  this.pendingSchemas.delete(id);
                  this.abortControllers.delete(id);
                } else {
                  pendingSchema.status = 'failed';
                  pendingSchema.statusMessage = e.message || nls.localize(
                    'rockit/validation/unknownError',
                    'Unknown error',
                  );
                  this.abortControllers.delete(id);
                  console.error(`Failed to resolve schema ${conformsToUrl}`, e); 
                }
              } finally {
                this.onDidChangeSchemasEmitter.fire();
              }
            }, (completed) => {
              progress.report({
                message: nls.localize(
                  'rockit/schemaManager/processedCount',
                  'Processed ({0}/{1})...',
                  completed,
                  total,
                ),
                work: { done: completed, total },
              });
            });

          } finally { progress.cancel(); }
        });
      
      this.onDidChangeSchemasEmitter.fire();
    } catch (error) {
      console.error('[SchemaManager] Error verifying schemas:', error);
    } finally {
      this.isChecking = false;
    }
  }

  private extractSchemaIds(roCrate: any): Set<string> {
    const requiredIds = new Set<string>();
    const graph = Array.isArray(roCrate['@graph']) ? roCrate['@graph'] : [roCrate];
    
    for (const entity of graph) {
      if (!entity.conformsTo) continue;
      const conformsArray = Array.isArray(entity.conformsTo) ? entity.conformsTo : [entity.conformsTo];
      
      for (const item of conformsArray) {
        let id = typeof item === 'string' ? item : item['@id'];
        if (id && typeof id === 'string' && id.includes('/schema/')) {
          requiredIds.add(id);
        }
      }
    }
    return requiredIds;
  }

  public async getProfileHealthForCrate(roCrate: any): Promise<ProfileHealthStatus> {
    const requiredIds = this.extractSchemaIds(roCrate);
    if (requiredIds.size === 0) {
      return { requiredCount: 0, okCount: 0, issues: [] };
    }

    const profiles = await this.loadAllSchemas();
    const issues: ProfileHealthIssue[] = [];
    let okCount = 0;

    for (const conformsTo of requiredIds) {
      const matchingProfiles = profiles.filter(profile =>
        profile.aux.reference === conformsTo ||
        profile.conformsTo === conformsTo ||
        profile.downloadUrl === conformsTo
      );

      const availableProfile = matchingProfiles.find(profile => !profile.status || profile.status === 'ok');
      if (availableProfile) {
        okCount += 1;
        continue;
      }

      const failedProfile = matchingProfiles.find(profile => profile.status === 'failed');
      if (failedProfile) {
        issues.push({
          conformsTo,
          status: 'failed',
          profileName: failedProfile.name,
          message: failedProfile.statusMessage || nls.localize(
            'rockit/schemaManager/referencedProfileDownloadFailed',
            'Referenced profile could not be downloaded.',
          )
        });
        continue;
      }

      const matching = matchingProfiles[0];
      if (!matching) {
        issues.push({
          conformsTo,
          status: 'missing',
          message: nls.localize(
            'rockit/schemaManager/referencedProfileUnavailable',
            'Referenced profile is not available locally.',
          )
        });
        continue;
      }
    }

    return { requiredCount: requiredIds.size, okCount, issues };
  }

  public async getSchemaByConformsTo(conformsToUrl: string): Promise<SchemaInfo | undefined> {
    const all = await this.loadAllSchemas();
    return all.find(s => s.conformsTo === conformsToUrl || s.aux.reference === conformsToUrl);
  }

  protected async filterMissingSchemas(ids: string[]): Promise<string[]> {
    const localSchemas = await this.loadAllSchemas();
    return ids.filter(reqId => {
      const exists = localSchemas.some(local => 
        local.aux.reference === reqId || 
        local.conformsTo === reqId
      );
      return !exists;
    });
  }

  public async importFiles(fileUris: URI[], progress: TaskProgress): Promise<{ success: number; fail: number }> {
    let success = 0;
    let fail = 0;
    const total = fileUris.length;
    progress.report({
      message: nls.localize('rockit/schemaManager/readingFiles', 'Reading Files...'),
      work: { done: 0, total },
    });
    
    for (let i = 0; i < total; i++) {
      const fileUri = fileUris[i];
      const fileName = fileUri.path.base;
      try {
        const content = await this.fileService.read(fileUri);
        await this.processAndSaveSchema(content.value, 'local', fileName, {
          downloadUrl: '',
          conformsTo: ''
        });
        success++;
      } catch (error) {
        fail++;
        console.error(`Import failed for ${fileName}`, error);
      }
      progress.report({ work: { done: i + 1, total } });
    }
    if (success > 0) this.onDidChangeSchemasEmitter.fire();
    return { success, fail };
  }

  public async getConvertedProfileContent(sourceRelativePath: string): Promise<any> {
    try {
      const root = await this.getRockitRootUri();
      if (!root) throw new Error(nls.localize(
        'rockit/schemaManager/rootConfigurationMissing',
        'Root directory configuration missing',
      ));

      let convertedRelativePath = sourceRelativePath.replace(
        'metadata-schemas/cedar/',
        'metadata-schemas/ro-crate/',
      );
      const language = this.getConversionLanguage();

      await (this.indexMutex = this.indexMutex.then(async () => {
        const index = await this.loadIndex();
        const profile = index.profiles.find((candidate) => {
          const paths = candidate.files.convertedPaths;
          return candidate.files.convertedPath === convertedRelativePath ||
            paths?.en === convertedRelativePath ||
            paths?.hu === convertedRelativePath;
        });
        if (!profile || profile.type !== 'cedar') {
          return;
        }
        const changed = await this.ensureCedarConvertedProfiles(root, profile);
        convertedRelativePath = this.getConvertedProfilePaths(profile)[language];
        if (changed) {
          this.rebuildConformsToIndex(index);
          await this.saveIndex(index);
        }
      }));

      const roCrateUri = root.resolve(convertedRelativePath);
      
      if (!await this.fileService.exists(roCrateUri)) throw new Error(nls.localize(
        'rockit/schemaManager/convertedProfileNotFound',
        'Converted profile file not found.',
      ));
      const content = await this.fileService.read(roCrateUri);
      return JSON.parse(content.value);
    } catch (error) {
      console.error('Failed to load converted profile:', error);
      throw error;
    }
  }

  private async generateHash(str: string): Promise<string> {
    try {
      const msgBuffer = new TextEncoder().encode(str);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 8);
    } catch (e) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = Math.imul(31, hash) + char | 0;
      }
      return Math.abs(hash).toString(16).padStart(8, '0');
    }
  }

  private generateUniqueId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  public deriveConformsToFromId(schemaId: string): string {
    if (schemaId.startsWith(this.arpProdPrefix)) {
      const uuid = schemaId.substring(this.arpProdPrefix.length);
      return this.arpW3idProd + uuid;
    }
    if (schemaId.startsWith(this.arpDevPrefix)) {
      const uuid = schemaId.substring(this.arpDevPrefix.length);
      return this.arpW3idDev + uuid;
    }
    return schemaId;
  }

  protected async getRockitRootUri(): Promise<URI | null> {
    const result =
      (await this.envVariablesServer.getValue('ROCKIT_ROOT_PATH')) ||
      undefined;
    if (!result?.value) return null;
    const normalized = result.value.replace(/\\/g, '/');
    return normalized.match(/^[a-zA-Z]:/) ? new URI('file:///' + normalized) : new URI('file://' + normalized);
  }

  protected async getIndexUri(): Promise<URI | null> {
    const root = await this.getRockitRootUri();
    if (!root) return null;
    
    const envVar =
      (await this.envVariablesServer.getValue('ROCKIT_METADATA_SCHEMA_INDEX_FILE')) ||
      undefined;
    const fileName = envVar?.value || 'metadata-schema-index.json';
    
    return root.resolve(fileName);
  }

  protected async loadIndex(): Promise<SchemaIndex> {
    const uri = await this.getIndexUri();
    const defaultIndex: SchemaIndex = { profiles: [], conformsToIndex: {} };
    if (!uri) return defaultIndex;
    if (await this.fileService.exists(uri)) {
      try {
        const content = await this.fileService.read(uri);
        const parsed = JSON.parse(content.value);
        
        if (Array.isArray(parsed)) {
          const migratedIndex: SchemaIndex = { profiles: parsed, conformsToIndex: {} };
          this.rebuildConformsToIndex(migratedIndex);
          return migratedIndex;
        }
        
        return parsed as SchemaIndex;
      } catch (e) {
        console.error('Failed to parse schema index', e);
        return defaultIndex;
      }
    }
    return defaultIndex;
  }

  protected async saveIndex(index: SchemaIndex): Promise<void> {
    const uri = await this.getIndexUri();
    if (!uri) return;
    if (!await this.fileService.exists(uri.parent)) {
      await this.fileService.createFolder(uri.parent);
    }
    await this.fileService.write(uri, JSON.stringify(index, null, 4));
  }

  private rebuildConformsToIndex(index: SchemaIndex): void {
    index.conformsToIndex = {};
    for (const profile of index.profiles) {
      if (profile.conformsTo) {
        if (!index.conformsToIndex[profile.conformsTo]) {
          index.conformsToIndex[profile.conformsTo] = [];
        }
        if (!index.conformsToIndex[profile.conformsTo].includes(profile.id)) {
          index.conformsToIndex[profile.conformsTo].push(profile.id);
        }
      }
    }
  }

  private async processAndSaveSchema(
    rawContent: string, 
    type: 'local' | 'remote', 
    originalFileName?: string,
    metadata?: { conformsTo: string, downloadUrl: string }
  ): Promise<string> {
    let parsedRaw: any;
    try { 
      parsedRaw = JSON.parse(rawContent); 
    } catch (e) { 
      throw new Error(nls.localize(
        'rockit/schemaManager/invalidJson',
        'Invalid JSON format',
      ));
    }

    const schemaName = parsedRaw[SCHEMA_FIELD_NAME];
    const schemaVersion = parsedRaw[SCHEMA_FIELD_VERSION] || '1.0.0';
    const schemaId = parsedRaw[SCHEMA_FIELD_ID] || ''; 
    
    const createdAt = parsedRaw[SCHEMA_FIELD_CREATED_ON] || null;
    const updatedAt = parsedRaw[SCHEMA_FIELD_UPDATED_ON] || null;
    const downloadedAt = new Date().toISOString();
    
    if (!schemaName) {
      throw new Error(nls.localize(
        'rockit/schemaManager/missingRequiredField',
        'Missing required field: {0}',
        SCHEMA_FIELD_NAME,
      ));
    }

    let conformsTo = metadata?.conformsTo || '';
    if (!conformsTo && schemaId) {
      conformsTo = this.deriveConformsToFromId(schemaId);
    }
    const downloadUrl = metadata?.downloadUrl || '';

    const uniqueHash = await this.generateHash(schemaId + type);
    const safeName = schemaName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const fileName = `${safeName}_v${schemaVersion}_${type}_${uniqueHash}.json`;

    let convertedEnglish: string;
    let convertedHungarian: string;
    try { 
      convertedEnglish = this.convertCedarTemplate(rawContent, 'en');
      convertedHungarian = this.convertCedarTemplate(rawContent, 'hu');
    } catch (convErr) { 
      throw new Error(nls.localize(
        'rockit/schemaManager/conversionFailed',
        'Conversion logic failed: {0}',
        String(convErr),
      ));
    }

    const root = await this.getRockitRootUri();
    if (!root) throw new Error(nls.localize(
      'rockit/schemaManager/rootConfigurationMissing',
      'Root directory configuration missing',
    ));

    const relativeCedarPath = `metadata-schemas/cedar/${fileName}`;
    const relativeRoCratePath = `metadata-schemas/ro-crate/${fileName}`;
    const relativeHungarianPath = toLocalizedConvertedProfilePath(
      relativeRoCratePath,
      'hu',
    );

    const cedarUri = root.resolve(relativeCedarPath);
    const roCrateUri = root.resolve(relativeRoCratePath);
    const hungarianUri = root.resolve(relativeHungarianPath);

    if (!await this.fileService.exists(cedarUri.parent)) await this.fileService.createFolder(cedarUri.parent);
    if (!await this.fileService.exists(roCrateUri.parent)) await this.fileService.createFolder(roCrateUri.parent);
    if (!await this.fileService.exists(hungarianUri.parent)) await this.fileService.createFolder(hungarianUri.parent);

    await Promise.all([
      this.fileService.write(cedarUri, rawContent),
      this.fileService.write(roCrateUri, convertedEnglish),
      this.fileService.write(hungarianUri, convertedHungarian),
    ]);

    const idMatch = schemaId.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    const uuidId = idMatch ? idMatch[1] : schemaId;

    const newSchemaInfo: SchemaInfo = {
      id: this.generateUniqueId(),
      name: schemaName,
      version: schemaVersion,
      source: type,
      type: 'cedar',
      files: {
        sourcePath: relativeCedarPath,
        convertedPath: relativeRoCratePath,
        convertedPaths: {
          en: relativeRoCratePath,
          hu: relativeHungarianPath,
        },
      },
      aux: {
        templateUuid: uuidId,
        reference: schemaId,
      },
      conformsTo: conformsTo,
      downloadUrl: downloadUrl,
      createdAt: createdAt,
      updatedAt: updatedAt,
      downloadedAt: downloadedAt,
      status: 'ok'
    };

    await (this.indexMutex = this.indexMutex.then(async () => {
      const index = await this.loadIndex();
      
      const existingSchema = index.profiles.find(s => s.aux.reference === schemaId && s.source === type);
      if (existingSchema && existingSchema.createdAt && !newSchemaInfo.createdAt) {
        newSchemaInfo.createdAt = existingSchema.createdAt;
      }

      index.profiles = index.profiles.filter(s => !(s.aux.reference === schemaId && s.source === type));
      index.profiles.push(newSchemaInfo);
      
      this.rebuildConformsToIndex(index);
      await this.saveIndex(index);
    }).catch(err => {
      console.error("Failed to update index:", err);
      throw err;
    }));

    return schemaName;
  }

  private getConversionLanguage(): CedarProfileLanguage {
    return toCedarProfileLanguage(
      nls.localization?.languageId ?? nls.locale ?? nls.defaultLocale,
    );
  }

  private convertCedarTemplate(
    rawContent: string,
    language: CedarProfileLanguage = this.getConversionLanguage(),
  ): string {
    return new CedarTemplateToDescriboProfileConverter(language)
      .processCedarTemplate(rawContent);
  }

  private getConvertedProfilePaths(profile: SchemaInfo): Record<CedarProfileLanguage, string> {
    const canonicalPath = profile.files.convertedPath;
    return {
      en: canonicalPath,
      hu:
        profile.files.convertedPaths?.hu ||
        toLocalizedConvertedProfilePath(canonicalPath, 'hu'),
    };
  }

  /**
   * Generates missing language variants from the canonical raw CEDAR file.
   * The historic convertedPath is always rewritten as English during migration
   * so non-UI consumers keep a stable, backwards-compatible profile.
   */
  private async ensureCedarConvertedProfiles(
    root: URI,
    profile: SchemaInfo,
  ): Promise<boolean> {
    const paths = this.getConvertedProfilePaths(profile);
    const previousLanguage = profile.aux.conversionLanguage;
    const expectedPaths = { en: paths.en, hu: paths.hu };
    const pathsChanged =
      profile.files.convertedPaths?.en !== expectedPaths.en ||
      profile.files.convertedPaths?.hu !== expectedPaths.hu;
    const englishUri = root.resolve(paths.en);
    const hungarianUri = root.resolve(paths.hu);
    const [englishExists, hungarianExists] = await Promise.all([
      this.fileService.exists(englishUri),
      this.fileService.exists(hungarianUri),
    ]);
    const regenerateEnglish = !englishExists || previousLanguage === 'hu';
    const regenerateHungarian = !hungarianExists;

    if (regenerateEnglish || regenerateHungarian) {
      const sourceContent = await this.fileService.read(root.resolve(profile.files.sourcePath));
      const writes: Promise<unknown>[] = [];
      if (regenerateEnglish) {
        if (!await this.fileService.exists(englishUri.parent)) {
          await this.fileService.createFolder(englishUri.parent);
        }
        writes.push(this.fileService.write(
          englishUri,
          this.convertCedarTemplate(sourceContent.value, 'en'),
        ));
      }
      if (regenerateHungarian) {
        if (!await this.fileService.exists(hungarianUri.parent)) {
          await this.fileService.createFolder(hungarianUri.parent);
        }
        writes.push(this.fileService.write(
          hungarianUri,
          this.convertCedarTemplate(sourceContent.value, 'hu'),
        ));
      }
      await Promise.all(writes);
    }

    profile.files.convertedPaths = expectedPaths;
    if (profile.aux.conversionLanguage !== undefined) {
      delete profile.aux.conversionLanguage;
    }
    return pathsChanged || previousLanguage !== undefined || regenerateEnglish || regenerateHungarian;
  }

  public async loadAllSchemas(): Promise<SchemaInfo[]> {
    const index = await this.loadIndex();
    
    const pending = Array.from(this.pendingSchemas.values()).reverse();
    const persisted = index.profiles.map(p => ({ ...p, status: p.status || 'ok' as const }));
    
    return [...pending, ...persisted];
  }

  public async deleteSchemas(schemaIds: string[]): Promise<number> {
    let count = 0;
    const idsToDelete = new Set(schemaIds);
    let schemasToDelete: SchemaInfo[] = [];

    for (const id of schemaIds) {
      if (this.pendingSchemas.has(id)) {
        this.abortControllers.get(id)?.abort();
        this.abortControllers.delete(id);
        this.pendingSchemas.delete(id);
        idsToDelete.delete(id);
        count++;
      }
    }

    if (idsToDelete.size > 0) {
      await (this.indexMutex = this.indexMutex.then(async () => {
        const index = await this.loadIndex();
        schemasToDelete = index.profiles.filter(s => idsToDelete.has(s.id));
      }));

      const root = await this.getRockitRootUri();

      if (root) {
        for (const schema of schemasToDelete) {
          try {
            const sourceUri = root.resolve(schema.files.sourcePath);
            if (await this.fileService.exists(sourceUri)) {
              await this.fileService.delete(sourceUri);
            }

            const convertedPaths = new Set([
              schema.files.convertedPath,
              ...Object.values(schema.files.convertedPaths ?? {}),
            ].filter((path): path is string => Boolean(path)));
            for (const convertedPath of convertedPaths) {
              const convertedUri = root.resolve(convertedPath);
              if (await this.fileService.exists(convertedUri)) {
                await this.fileService.delete(convertedUri);
              }
            }
            count++;
          } catch (err) { 
            console.error(`Failed to delete files for schema ${schema.id}`, err); 
          }
        }
      }

      await (this.indexMutex = this.indexMutex.then(async () => {
        const index = await this.loadIndex();
        index.profiles = index.profiles.filter(s => !idsToDelete.has(s.id));
        this.rebuildConformsToIndex(index);
        await this.saveIndex(index);
      }));
    }

    if (count > 0) this.onDidChangeSchemasEmitter.fire();
    return count;
  }

  // Below here are legacy methods, please dont change without consulting with the team
  public async getMergedProfile(crate: Record<string, any>, newProfile: Record<string, any>, profile: Record<string, any>, profileUrl?: string) {
    const graph = Array.isArray(crate?.["@graph"]) ? crate["@graph"] : []
    const normalizedProfileUrl = typeof profileUrl === 'string' ? profileUrl.trim() : ''
    const targetClassNames = new Set<string>()

    for (const entity of graph) {
      if (!entity || typeof entity !== 'object') {
        continue
      }

      const entityType = Array.isArray(entity["@type"]) ? entity["@type"][0] : entity["@type"]
      if (!entityType || entityType === 'CreativeWork') {
        continue
      }

      const rawConformsTo = entity['conformsTo']
      const conformsTos = rawConformsTo
        ? (Array.isArray(rawConformsTo) ? rawConformsTo : [rawConformsTo])
        : []
      if (conformsTos.length === 0) {
        continue
      }

      if (normalizedProfileUrl) {
        const hasMatchingConformsTo = conformsTos.some((value: any) => {
          if (typeof value === 'string') {
            return value.trim() === normalizedProfileUrl
          }
          if (value && typeof value === 'object') {
            const idValue = (value as any)['@id'] ?? (value as any).id
            return typeof idValue === 'string' && idValue.trim() === normalizedProfileUrl
          }
          return false
        })
        if (!hasMatchingConformsTo) {
          continue
        }
      }

      targetClassNames.add(String(entityType))
    }

    for (const className of targetClassNames) {
      try {
        this.addProfileToClass(
          newProfile,
          className,
          profile,
          normalizedProfileUrl || undefined,
        )
      } catch (error) {
        console.error(error)
        throw error
      }
    }
    return profile
  }

  public async getMergedProfileForClass(
    newProfile: Record<string, any>,
    profile: Record<string, any>,
    className: string,
    profileUrl?: string,
  ) {
    const normalizedClassName = typeof className === 'string' ? className.trim() : ''
    if (!normalizedClassName || normalizedClassName === 'CreativeWork') {
      return profile
    }

    this.addProfileToClass(
      newProfile,
      normalizedClassName,
      profile,
      typeof profileUrl === 'string' && profileUrl.trim() ? profileUrl.trim() : undefined,
    )
    return profile
  }

  protected addProfileToClass(profileToAdd: Record<string, any>, className: string, rootProfile: Record<string, any>, profileUrl?: string) {
    if (!profileToAdd || !profileToAdd.classes || !profileToAdd.classes.Dataset) {
      console.warn('Invalid profileToAdd structure:', profileToAdd);
      return;
    }
    const datasetInputs = Array.isArray(profileToAdd.classes.Dataset.inputs)
      ? profileToAdd.classes.Dataset.inputs
      : []
    let theClass = rootProfile.classes[className]
    if (!theClass) {
      theClass = { inputs: [] }
      rootProfile.classes[className] = theClass
    }
    theClass.definition = "override"
    let name = this.nameWithoutMetadataSuffix(profileToAdd.metadata.name)
    let desc: string | null = profileToAdd.metadata.description
    if (name == this.nameWithoutMetadataSuffix(desc)) { desc = null }
    const groupedInputs = datasetInputs.map((input: Record<string, any>) => ({
      ...input,
      group: name ?? input.group,
    }))
    const existingInputs = Array.isArray(theClass.inputs) ? theClass.inputs : []
    const inputKey = (input: Record<string, any>) =>
      `${String(input?.name ?? '')}|${String(input?.group ?? '')}|${JSON.stringify(input?.type ?? '')}`
    const seenInputKeys = new Set(existingInputs.map((input: Record<string, any>) => inputKey(input)))
    for (const input of groupedInputs) {
      const key = inputKey(input)
      if (seenInputKeys.has(key)) {
        continue
      }
      existingInputs.push(input)
      seenInputKeys.add(key)
    }
    theClass.inputs = existingInputs
    let layouts = rootProfile.layouts
    if (!layouts) { layouts = rootProfile.layouts = [] }
    let selectedLayout = layouts.find((layout: any) => layout.appliesTo.includes(className))
    let language = rootProfile.localisation?.language || "en"
    if (!selectedLayout) {
      selectedLayout = {
        appliesTo: [className],
        "about": { label: language == "hu" ? "Alapadatok" : "About", },
        "overflow": { label: language == "hu" ? "Egyéb" : "Other", }
      }
      layouts.push(selectedLayout)
    }
    selectedLayout[name!] = { label: name!, description: desc, url: profileUrl || undefined }
    const overflow = selectedLayout["overflow"];
    delete selectedLayout["overflow"]
    selectedLayout["overflow"] = overflow
    for (let className in profileToAdd.classes) {
      if (className != "Dataset" && !rootProfile.classes[className]) {
        rootProfile.classes[className] = profileToAdd.classes[className]
      }
    }
    if (!rootProfile.localisation) { rootProfile.localisation = {} }
    rootProfile.localisation = { ...rootProfile.localisation, ...profileToAdd.localisation }
  }

  public nameWithoutMetadataSuffix(name: string | null) {
    if (!name || name == "") {
      return null;
    }
    return name.replace(/ (metadata|metaadatok|metaadatai|metaadat)$/i, '');
  }
}

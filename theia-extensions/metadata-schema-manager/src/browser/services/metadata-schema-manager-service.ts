// src/browser/services/metadata-schema-manager-service.ts

import { injectable, inject, postConstruct } from 'inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { URI } from '@theia/core/lib/common/uri';
import { Emitter, Event } from '@theia/core/lib/common/event';

import { AppStateService } from 'app-state/lib/browser/state/app-state-service';
import { CedarTemplateToDescriboProfileConverter } from 'cedar-template-converter';
import type { SchemaInfo, SchemaIndex, RemoteSchemaProviderConfig } from '../types';
import { SchemaApi } from './schema-api';
import type { MetadataSchemaManager as MetadataSchemaManagerContract } from 'aroma2-common/lib/browser';
import { RemoteSchemaProviderStoreService } from './remote-schema-provider-store-service';
import { MissingSchemasDialog } from '../components/missing-schemas-dialog'; 

export const SCHEMA_FIELD_NAME = 'schema:name';
export const SCHEMA_FIELD_VERSION = 'pav:version';
export const SCHEMA_FIELD_ID = '@id';
export const SCHEMA_FIELD_CREATED_ON = 'pav:createdOn';
export const SCHEMA_FIELD_UPDATED_ON = 'pav:lastUpdatedOn';
const MSG_TIMEOUT = 5000;

// Local interface for better type safety with Theia's progress reporting
export interface TaskProgress {
    report(progress: { message?: string; work?: { done: number; total: number } }): void;
    cancel(): void;
}

@injectable()
export class SchemaManagerService implements FrontendApplicationContribution, MetadataSchemaManagerContract {
    
    @inject(AppStateService) protected readonly appStateService!: AppStateService;
    @inject(FileService) protected readonly fileService!: FileService;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(EnvVariablesServer) protected readonly envVariablesServer!: EnvVariablesServer;
    @inject(RemoteSchemaProviderStoreService) public readonly providerStoreService!: RemoteSchemaProviderStoreService; 

    private readonly converter = new CedarTemplateToDescriboProfileConverter();
    private isChecking = false;
    private indexMutex: Promise<void> = Promise.resolve();

    // Default Configuration Fallbacks (overridden dynamically via env vars)
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
        // Run self-healing synchronization on startup
        await this.synchronizeIndex();

        const currentCrate = this.appStateService.roCrate;
        if (currentCrate) this.checkAndDownloadSchemas(currentCrate);
    }

    /**
     * Self-healing function to ensure the index and file system are perfectly synced.
     */
    private async synchronizeIndex(): Promise<void> {
        await (this.indexMutex = this.indexMutex.then(async () => {
            const root = await this.getAromaRootUri();
            if (!root) return;

            const index = await this.loadIndex();
            const validProfiles: SchemaInfo[] = [];
            let indexChanged = false;

            // --- CASE 1: Prune Orphaned Index Entries ---
            for (const profile of index.profiles) {
                const sourceUri = root.resolve(profile.files.sourcePath);
                const convertedUri = root.resolve(profile.files.convertedPath);
                
                const sourceExists = await this.fileService.exists(sourceUri);
                const convertedExists = await this.fileService.exists(convertedUri);

                if (sourceExists && convertedExists) {
                    validProfiles.push(profile);
                } else {
                    console.warn(`[SchemaManager] Removing corrupted index entry: ${profile.name}`);
                    indexChanged = true;
                    // Clean up partial remnants so it downloads fresh next time
                    if (sourceExists) await this.fileService.delete(sourceUri);
                    if (convertedExists) await this.fileService.delete(convertedUri);
                }
            }

            index.profiles = validProfiles;

            // --- CASE 2: Discover Unindexed Files ---
            const cedarDir = root.resolve('metadata-schemas/cedar');
            if (await this.fileService.exists(cedarDir)) {
                const stat = await this.fileService.resolve(cedarDir);
                if (stat && stat.children) {
                    for (const file of stat.children) {
                        if (!file.name.endsWith('.json')) continue;
                        
                        const relativeCedarPath = `metadata-schemas/cedar/${file.name}`;
                        const isIndexed = index.profiles.some(p => p.files.sourcePath === relativeCedarPath);
                        
                        if (!isIndexed) {
                            console.log(`[SchemaManager] Discovered unindexed schema file: ${file.name}`);
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
                                
                                // Regenerate missing RO-Crate file to ensure parity
                                let convertedContent: string;
                                try { 
                                    convertedContent = this.converter.processCedarTemplate(content.value); 
                                } catch (convErr) { 
                                    continue; // Skip if it can't be converted
                                }
                                
                                const relativeRoCratePath = `metadata-schemas/ro-crate/${file.name}`;
                                const roCrateUri = root.resolve(relativeRoCratePath);
                                if (!await this.fileService.exists(roCrateUri.parent)) {
                                    await this.fileService.createFolder(roCrateUri.parent);
                                }
                                await this.fileService.write(roCrateUri, convertedContent);

                                const idMatch = schemaId.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
                                const uuidId = idMatch ? idMatch[1] : schemaId;

                                // Guess source from filename format
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
                                        convertedPath: relativeRoCratePath
                                    },
                                    aux: {
                                        templateUuid: uuidId,
                                        reference: schemaId
                                    },
                                    conformsTo: conformsTo,
                                    downloadUrl: '',
                                    createdAt: createdAt,
                                    updatedAt: updatedAt,
                                    downloadedAt: new Date().toISOString()
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

            // Save if anything was repaired
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
            // Yield to main thread
            await new Promise(r => setTimeout(r, 0));
        }
    }

    public async browseRemoteSchemas(provider: RemoteSchemaProviderConfig): Promise<void> {
        this.onOpenRemoteBrowserEmitter.fire(provider);
    }

    public async downloadRemoteSchema(templateId: string, provider?: RemoteSchemaProviderConfig): Promise<void> {
        try {
            let apiKey = provider?.apiKey;
            let domainBase = provider?.domainBase || provider?.baseUrl;

            if (!provider) {
                throw new Error('No Remote Provider context available for download.');
            } else {
                 domainBase = domainBase!.replace(/(^\w+:|^)\/\//, '').replace(/\/+$/, '');
            }

            const api = new SchemaApi({
                domainBase: domainBase,
                apiKey: apiKey
            });

            this.messageService.info(`Downloading schema from ${provider.title}...`, { timeout: MSG_TIMEOUT });
            
            const schemaContent = await api.downloadSchema(templateId);
            const rawString = typeof schemaContent === 'string' 
                ? schemaContent 
                : JSON.stringify(schemaContent, null, 2);

            const name = await this.processAndSaveSchema(rawString, 'remote', undefined, {
                downloadUrl: templateId, 
                conformsTo: '' 
            });
            
            this.onDidChangeSchemasEmitter.fire();
            this.messageService.info(`Successfully added schema: ${name}`, { timeout: MSG_TIMEOUT });

        } catch (error) {
            console.error('Download failed:', error);
            this.messageService.error(`Download failed: ${error instanceof Error ? error.message : error}`, { timeout: MSG_TIMEOUT });
            throw error;
        }
    }

    private async determineApiKeyForUrl(url: string): Promise<string | undefined> {
        try {
            const providers = await this.providerStoreService.loadProviders();
            const targetHost = new URL(url).hostname.toLowerCase();

            const matchedProvider = providers.find(p => {
                try {
                    const sourceUrl = p.domainBase || p.baseUrl;
                    const providerHost = new URL(sourceUrl).hostname.toLowerCase();
                    return targetHost.includes(providerHost) || providerHost.includes(targetHost);
                } catch { return false; }
            });

            if (matchedProvider && matchedProvider.apiKey) {
                return matchedProvider.apiKey;
            }
        } catch (e) {
            console.error("Error determining API key for URL", e);
        }
        return undefined;
    }

    public async importFromUrl(url: string, progress: TaskProgress): Promise<string> {
        progress.report({ message: 'Resolving access...', work: { done: 10, total: 100 } });
        
        try {
            const apiKey = await this.determineApiKeyForUrl(url);
            progress.report({ message: 'Downloading...', work: { done: 30, total: 100 } });

            const { content, finalUrl } = await this.fetchWithAuthFallback(url, apiKey);

            try {
                JSON.parse(content);
            } catch (e) {
                throw new Error('The URL returned invalid content (likely HTML instead of JSON).');
            }

            progress.report({ message: 'Processing...', work: { done: 60, total: 100 } });
            
            const schemaName = await this.processAndSaveSchema(content, 'remote', undefined, {
                downloadUrl: finalUrl,
                conformsTo: '' 
            });
            
            progress.report({ work: { done: 100, total: 100 } });
            this.onDidChangeSchemasEmitter.fire();
            return schemaName;

        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    private async fetchWithAuthFallback(url: string, apiKey?: string): Promise<{ content: string, finalUrl: string }> {
        const headers: HeadersInit = {
            'Content-Type': 'application/json',
            'Accept': 'application/json' 
        };

        const fetchAttempt = async (useKey: boolean): Promise<Response> => {
            const currentHeaders: Record<string, string> = { ...headers as Record<string, string> };
            if (useKey && apiKey) {
                currentHeaders['Authorization'] = `apiKey ${apiKey}`;
            }
            return fetch(url, { method: 'GET', headers: currentHeaders });
        };

        let response: Response;
        if (apiKey) {
            response = await fetchAttempt(true);
            if (response.status === 401 || response.status === 403) {
                response = await fetchAttempt(false);
            }
        } else {
            response = await fetchAttempt(false);
        }

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new Error(`Unauthorized access to ${url}. Please configure a Remote Provider.`);
            }
            if (response.status === 404) {
                throw new Error(`Resource not found at ${url}.`);
            }
            throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
        }

        const content = await response.text();
        return { content, finalUrl: response.url };
    }

    private async resolveConformanceUrl(url: string, apiKey?: string): Promise<{ content: string, finalUrl: string }> {
        const effectiveKey = apiKey || await this.determineApiKeyForUrl(url);
        const { content, finalUrl } = await this.fetchWithAuthFallback(url, effectiveKey);

        try {
            JSON.parse(content);
            return { content, finalUrl };
        } catch (e) { /* HTML fallback logic */ }

        let fixedUrl = finalUrl;
        if (finalUrl.includes('openview.')) {
            fixedUrl = finalUrl.replace('openview.', 'open.');
        } else if (finalUrl.includes('/artifacts/')) {
             fixedUrl = finalUrl.replace('/artifacts/', '/templates/');
        }

        if (fixedUrl !== finalUrl) {
            const retry = await this.fetchWithAuthFallback(fixedUrl, effectiveKey);
            try {
                JSON.parse(retry.content);
                return retry; 
            } catch (e) {
                throw new Error(`Could not resolve JSON from ${url}.`);
            }
        }

        throw new Error(`The URL ${url} returned HTML, and no JSON endpoint could be determined.`);
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

            await this.messageService.showProgress({ text: 'Resolving Missing Schemas...' })
                .then(async (progress: TaskProgress) => {
                    try {
                        const total = missingIds.length;
                        progress.report({ message: 'Starting...', work: { done: 0, total } });

                        await this.processInChunks(missingIds, 5, async (conformsToUrl) => {
                            try { 
                                const { content, finalUrl } = await this.resolveConformanceUrl(conformsToUrl);
                                await this.processAndSaveSchema(content, 'remote', undefined, {
                                    conformsTo: conformsToUrl,
                                    downloadUrl: finalUrl
                                });
                            }
                            catch (e) { 
                                console.error(`Failed to resolve schema ${conformsToUrl}`, e); 
                                this.messageService.warn(`Could not download schema: ${conformsToUrl}`);
                            }
                        }, (completed) => {
                            progress.report({ message: `Processed (${completed}/${total})...`, work: { done: completed, total } });
                        });

                    } finally { progress.cancel(); }
                });
            
            this.onDidChangeSchemasEmitter.fire();
            this.messageService.info('Schema synchronization finished.', { timeout: MSG_TIMEOUT });

        } catch (error) {
            console.error('[SchemaManager] Error verifying schemas:', error);
            this.messageService.error('Error during schema sync. See console.', { timeout: MSG_TIMEOUT });
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
        progress.report({ message: 'Reading Files...', work: { done: 0, total } });
        
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
            const root = await this.getAromaRootUri();
            if (!root) throw new Error('Root directory configuration missing');
            
            const convertedRelativePath = sourceRelativePath.replace('metadata-schemas/cedar/', 'metadata-schemas/ro-crate/');
            const roCrateUri = root.resolve(convertedRelativePath);
            
            if (!await this.fileService.exists(roCrateUri)) throw new Error('Converted profile file not found.');
            const content = await this.fileService.read(roCrateUri);
            return JSON.parse(content.value);
        } catch (error) {
            console.error('Failed to load converted profile:', error);
            throw error;
        }
    }

    /**
     * Utilizes standard Web Crypto APIs to securely generate hashes.
     * Includes a pure JS fallback for extremely restricted offline environments.
     */
    private async generateHash(str: string): Promise<string> {
        try {
            const msgBuffer = new TextEncoder().encode(str);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 8);
        } catch (e) {
            // Offline fallback if crypto.subtle is unavailable
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = Math.imul(31, hash) + char | 0;
            }
            return Math.abs(hash).toString(16).padStart(8, '0');
        }
    }

    /**
     * Utilizes standard Web Crypto APIs to securely generate UUID v4 strings.
     * Includes a pure JS fallback for extremely restricted offline environments.
     */
    private generateUniqueId(): string {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        // Offline fallback
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

    protected async getAromaRootUri(): Promise<URI | null> {
        const result = await this.envVariablesServer.getValue('AROMA_ROOT_PATH');
        if (!result?.value) return null;
        const normalized = result.value.replace(/\\/g, '/');
        return normalized.match(/^[a-zA-Z]:/) ? new URI('file:///' + normalized) : new URI('file://' + normalized);
    }

    protected async getIndexUri(): Promise<URI | null> {
        const root = await this.getAromaRootUri();
        if (!root) return null;
        
        const envVar = await this.envVariablesServer.getValue('AROMA_METADATA_SCHEMA_INDEX_FILE');
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
            throw new Error('Invalid JSON format'); 
        }

        const schemaName = parsedRaw[SCHEMA_FIELD_NAME];
        const schemaVersion = parsedRaw[SCHEMA_FIELD_VERSION] || '1.0.0';
        const schemaId = parsedRaw[SCHEMA_FIELD_ID] || ''; 
        
        const createdAt = parsedRaw[SCHEMA_FIELD_CREATED_ON] || null;
        const updatedAt = parsedRaw[SCHEMA_FIELD_UPDATED_ON] || null;
        const downloadedAt = new Date().toISOString();
        
        if (!schemaName) {
            throw new Error(`Missing required field: ${SCHEMA_FIELD_NAME}`);
        }

        let conformsTo = metadata?.conformsTo || '';
        if (!conformsTo && schemaId) {
            conformsTo = this.deriveConformsToFromId(schemaId);
        }
        const downloadUrl = metadata?.downloadUrl || '';

        const uniqueHash = await this.generateHash(schemaId + type);
        const safeName = schemaName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        const fileName = `${safeName}_v${schemaVersion}_${type}_${uniqueHash}.json`;

        let convertedContent: string;
        try { 
            convertedContent = this.converter.processCedarTemplate(rawContent); 
        } catch (convErr) { 
            throw new Error(`Conversion logic failed: ${convErr}`); 
        }

        const root = await this.getAromaRootUri();
        if (!root) throw new Error('Root directory configuration missing');

        // Relative paths to store in the JSON
        const relativeCedarPath = `metadata-schemas/cedar/${fileName}`;
        const relativeRoCratePath = `metadata-schemas/ro-crate/${fileName}`;

        // Absolute URIs for file writing
        const cedarUri = root.resolve(relativeCedarPath);
        const roCrateUri = root.resolve(relativeRoCratePath);

        if (!await this.fileService.exists(cedarUri.parent)) await this.fileService.createFolder(cedarUri.parent);
        if (!await this.fileService.exists(roCrateUri.parent)) await this.fileService.createFolder(roCrateUri.parent);

        await Promise.all([
            this.fileService.write(cedarUri, rawContent),
            this.fileService.write(roCrateUri, convertedContent)
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
                convertedPath: relativeRoCratePath
            },
            aux: {
                templateUuid: uuidId,
                reference: schemaId
            },
            conformsTo: conformsTo,
            downloadUrl: downloadUrl,
            createdAt: createdAt,
            updatedAt: updatedAt,
            downloadedAt: downloadedAt
        };

        // Ensure single-threaded access to the index file
        await (this.indexMutex = this.indexMutex.then(async () => {
            const index = await this.loadIndex();
            
            const existingSchema = index.profiles.find(s => s.aux.reference === schemaId && s.source === type);
            // Only inherit created date if the new one doesn't have it natively
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

    public async loadAllSchemas(): Promise<SchemaInfo[]> {
        const index = await this.loadIndex();
        return index.profiles;
    }

    public async deleteSchemas(schemaIds: string[]): Promise<number> {
        let count = 0;
        const idsToDelete = new Set(schemaIds);
        let schemasToDelete: SchemaInfo[] = [];

        // Read phase
        await (this.indexMutex = this.indexMutex.then(async () => {
            const index = await this.loadIndex();
            schemasToDelete = index.profiles.filter(s => idsToDelete.has(s.id));
        }));

        const root = await this.getAromaRootUri();

        // File deletion outside of mutex block to prevent blocking reads
        if (root) {
            for (const schema of schemasToDelete) {
                try {
                    const sourceUri = root.resolve(schema.files.sourcePath);
                    if (await this.fileService.exists(sourceUri)) {
                        await this.fileService.delete(sourceUri);
                    }

                    const convertedUri = root.resolve(schema.files.convertedPath);
                    if (await this.fileService.exists(convertedUri)) {
                        await this.fileService.delete(convertedUri);
                    }
                    count++;
                } catch (err) { 
                    console.error(`Failed to delete files for schema ${schema.id}`, err); 
                }
            }
        }

        // Write phase
        await (this.indexMutex = this.indexMutex.then(async () => {
            const index = await this.loadIndex();
            index.profiles = index.profiles.filter(s => !idsToDelete.has(s.id));
            this.rebuildConformsToIndex(index);
            await this.saveIndex(index);
        }));

        if (count > 0) this.onDidChangeSchemasEmitter.fire();
        return count;
    }

    // Below here are legacy methods, please do not modify these methods because these are used as it is right now.
    
    public async getMergedProfile(crate: Record<string, any>, newProfile: Record<string, any>, profile: Record<string, any>, profileUrl?: string) {
        const entities: any = Object.values(crate["@graph"]).filter((entity: any) => entity["@type"] != "CreativeWork")
        for (const entity of entities) {
            const entityType = Array.isArray(entity["@type"]) ? entity["@type"][0] : entity["@type"]
            const conformsTos = entity['conformsTo'] ? (Array.isArray(entity['conformsTo']) ? entity['conformsTo'] : [entity['conformsTo']]) : undefined;
            if (!conformsTos) { continue }
            try {
                this.addProfileToClass(newProfile, entityType, profile, profileUrl)
            } catch (error) {
                console.error(error)
                throw error
            }
        }
        return profile
    }

    protected addProfileToClass(profileToAdd: Record<string, any>, className: string, rootProfile: Record<string, any>, profileUrl?: string) {
        if (!profileToAdd || !profileToAdd.classes || !profileToAdd.classes.Dataset) {
            console.warn('Invalid profileToAdd structure:', profileToAdd);
            return;
        }
        const inputs = profileToAdd.classes.Dataset.inputs
        let theClass = rootProfile.classes[className]
        if (!theClass) {
            theClass = { inputs: [] }
            rootProfile.classes[className] = theClass
        }
        theClass.definition = "override"
        let name = this.nameWithoutMetadataSuffix(profileToAdd.metadata.name)
        let desc: string | null = profileToAdd.metadata.description
        if (name == this.nameWithoutMetadataSuffix(desc)) { desc = null }
        profileToAdd.classes["Dataset"].inputs.forEach((input: Record<string, any>) => input.group = name)
        theClass.inputs = [...theClass.inputs, ...inputs]
        let layouts = rootProfile.layouts
        if (!layouts) { layouts = rootProfile.layouts = [] }
        let selectedLayout = layouts.find((layout: any) => layout.appliesTo.includes(className))
        let language = rootProfile.localisation?.language || "en"
        if (!selectedLayout) {
            selectedLayout = {
                appliesTo: [className],
                "about": { label: language == "hu" ? "Alap" : "About", },
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
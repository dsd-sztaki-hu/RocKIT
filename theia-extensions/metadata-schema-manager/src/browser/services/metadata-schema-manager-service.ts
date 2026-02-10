import { injectable, inject, postConstruct } from 'inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { URI } from '@theia/core/lib/common/uri';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { AppStateService } from 'app-state/lib/browser/state/app-state-service';
import { Modal } from 'antd';

import { CedarTemplateToDescriboProfileConverter } from 'cedar-template-converter';
import type { SchemaInfo, RemoteSchemaProviderConfig } from '../types';
import { SchemaApi } from './schema-api';
import type { MetadataSchemaManager as MetadataSchemaManagerContract } from 'aroma2-common/lib/browser';
import { RemoteSchemaProviderStoreService } from './remote-schema-provider-store-service'; 

export const SCHEMA_FIELD_NAME = 'schema:name';
export const SCHEMA_FIELD_VERSION = 'pav:version';
export const SCHEMA_FIELD_ID = '@id';

const AROMA_METADATA_FIELD = '_aromaMetadata'; 
const MSG_TIMEOUT = 5000;

@injectable()
export class SchemaManagerService implements FrontendApplicationContribution, MetadataSchemaManagerContract {
    
    @inject(AppStateService) protected readonly appStateService!: AppStateService;
    @inject(FileService) protected readonly fileService!: FileService;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(EnvVariablesServer) protected readonly envVariablesServer!: EnvVariablesServer;
    @inject(RemoteSchemaProviderStoreService) public readonly providerStoreService!: RemoteSchemaProviderStoreService; 

    private readonly converter = new CedarTemplateToDescriboProfileConverter();
    private isChecking = false;

    private readonly onDidChangeSchemasEmitter = new Emitter<void>();
    readonly onDidChangeSchemas: Event<void> = this.onDidChangeSchemasEmitter.event;

    private readonly onOpenRemoteBrowserEmitter = new Emitter<RemoteSchemaProviderConfig>();
    readonly onOpenRemoteBrowser: Event<RemoteSchemaProviderConfig> = this.onOpenRemoteBrowserEmitter.event;

    @postConstruct()
    init() {
        this.appStateService.onDidChangeSelector(state => state.roCrate)(
            (newCrate) => {
                if (newCrate) this.checkAndDownloadSchemas(newCrate);
            }
        );
    }

    onStart(): void {
        const currentCrate = this.appStateService.roCrate;
        if (currentCrate) this.checkAndDownloadSchemas(currentCrate);
    }

    // --- HELPER: Concurrency Limiter ---
    private async processInChunks<T>(items: T[], chunkSize: number, iteratorFn: (item: T) => Promise<void>, progressCb?: (completed: number) => void) {
        let completed = 0;
        for (let i = 0; i < items.length; i += chunkSize) {
            const chunk = items.slice(i, i + chunkSize);
            // Process chunk in parallel
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
            // Optional: Small yield to event loop to keep UI responsive between chunks
            await new Promise(r => setTimeout(r, 0));
        }
    }

    public async browseRemoteSchemas(provider: RemoteSchemaProviderConfig): Promise<void> {
        this.onOpenRemoteBrowserEmitter.fire(provider);
    }

    public async downloadRemoteSchema(templateId: string, provider?: RemoteSchemaProviderConfig): Promise<void> {
        try {
            let apiKey = provider?.apiKey;
            let domainBase = provider?.baseUrl;

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
                downloadUrl: provider.baseUrl,
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
                    let providerHost = new URL(p.baseUrl).hostname.toLowerCase();
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

    public async importFromUrl(url: string, progress: any): Promise<string> {
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
            const currentHeaders = { ...headers };
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
        } catch (e) { /* ignore HTML here, proceed to fix */ }

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
                Modal.info({
                    title: 'Missing Metadata Schemas',
                    content: `The RO-Crate references ${missingIds.length} missing schema(s). Downloading now...`,
                    okText: 'OK', onOk: () => resolve(), maskClosable: false
                });
            });

            await this.messageService.showProgress({ text: 'Resolving Missing Schemas...' })
                .then(async progress => {
                    try {
                        const total = missingIds.length;
                        progress.report({ message: 'Starting...', work: { done: 0, total } });

                        // FIX: Use processInChunks instead of Promise.all to prevent UI Freeze
                        // Download 5 schemas at a time max
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
                // FIX: Handle both string URLs and object format {"@id": "..."}
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
        return all.find(s => s.conformsTo === conformsToUrl || s.reference === conformsToUrl);
    }

    protected async filterMissingSchemas(ids: string[]): Promise<string[]> {
        // Optimize: Load local schemas once
        const localSchemas = await this.loadAllSchemas();
        return ids.filter(reqId => {
            const exists = localSchemas.some(local => 
                local.reference === reqId || 
                local.conformsTo === reqId
            );
            return !exists;
        });
    }

    public async importFiles(fileUris: URI[], progress: any): Promise<{ success: number; fail: number }> {
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

    public async getConvertedProfileContent(sourcePath: string): Promise<any> {
        try {
            const roCratePathStr = sourcePath.replace('/metadata-schemas/cedar/', '/metadata-schemas/ro-crate/');
            const roCrateUri = new URI(roCratePathStr);
            if (!await this.fileService.exists(roCrateUri)) throw new Error('Converted profile file not found.');
            const content = await this.fileService.read(roCrateUri);
            return JSON.parse(content.value);
        } catch (error) {
            console.error('Failed to load converted profile:', error);
            throw error;
        }
    }

    private simpleHash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16);
    }

    public deriveConformsToFromId(schemaId: string): string {
        const PROD_PREFIX = 'https://repo.schema.researchdata.hu/templates/';
        const DEV_PREFIX = 'https://repo.cedardev.dsd.sztaki.hu/templates/';
        
        const W3ID_PROD = 'https://w3id.org/arp/schema/';
        const W3ID_DEV = 'https://w3id.org/arp/dev/schema/';

        if (schemaId.startsWith(PROD_PREFIX)) {
            const uuid = schemaId.substring(PROD_PREFIX.length);
            return W3ID_PROD + uuid;
        }
        if (schemaId.startsWith(DEV_PREFIX)) {
            const uuid = schemaId.substring(DEV_PREFIX.length);
            return W3ID_DEV + uuid;
        }
        return schemaId;
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
        const schemaVersion = parsedRaw[SCHEMA_FIELD_VERSION];
        const schemaId = parsedRaw[SCHEMA_FIELD_ID] || ''; 
        
        if (!schemaName || !schemaVersion) {
            throw new Error(`Missing required fields: ${SCHEMA_FIELD_NAME} or ${SCHEMA_FIELD_VERSION}`);
        }

        if (metadata) {
            if (!metadata.conformsTo) {
                metadata.conformsTo = this.deriveConformsToFromId(schemaId);
            }
            parsedRaw[AROMA_METADATA_FIELD] = metadata;
            rawContent = JSON.stringify(parsedRaw, null, 2);
        }

        let fileName = originalFileName;
        if (!fileName || type === 'remote') {
            const uniqueHash = this.simpleHash(schemaId);
            const safeName = schemaName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
            fileName = `remote_${safeName}_v${schemaVersion}_${uniqueHash}.json`;
        }

        let convertedContent: string;
        try { 
            convertedContent = this.converter.processCedarTemplate(rawContent); 
        } catch (convErr) { 
            throw new Error(`Conversion logic failed: ${convErr}`); 
        }

        const root = await this.getAromaRootUri();
        if (!root) throw new Error('Root directory configuration missing');

        const cedarUri = root.resolve(`metadata-schemas/cedar/${type}/${fileName}`);
        const roCrateUri = root.resolve(`metadata-schemas/ro-crate/${type}/${fileName}`);

        await Promise.all([
            this.fileService.write(cedarUri, rawContent),
            this.fileService.write(roCrateUri, convertedContent)
        ]);

        return schemaName;
    }

    public async loadAllSchemas(): Promise<SchemaInfo[]> {
        const schemas: SchemaInfo[] = [];
        for (const source of ['local', 'remote'] as const) {
            const cedarDir = await this.getCedarDir(source);
            if (!cedarDir || !await this.fileService.exists(cedarDir)) continue;
            
            const stat = await this.fileService.resolve(cedarDir);
            if (!stat?.children) continue;

            for (const file of stat.children) {
                if (!file.name.endsWith('.json')) continue;
                try {
                    const content = await this.fileService.read(file.resource);
                    const parsed = JSON.parse(content.value);
                    
                    const schemaName = parsed[SCHEMA_FIELD_NAME];
                    const schemaVersion = parsed[SCHEMA_FIELD_VERSION];
                    const schemaId = parsed[SCHEMA_FIELD_ID];
                    const extraMeta = parsed[AROMA_METADATA_FIELD] || {};

                    if (schemaName && schemaVersion) {
                        schemas.push({ 
                            name: schemaName, 
                            version: schemaVersion, 
                            reference: schemaId || '', 
                            source, 
                            path: file.resource.toString(),
                            conformsTo: extraMeta.conformsTo || '',
                            downloadUrl: extraMeta.downloadUrl || ''
                        });
                    }
                } catch { /* ignore */ }
            }
        }
        return schemas;
    }

    public async deleteSchemas(cedarPaths: string[]): Promise<number> {
        let count = 0;
        for (const pathStr of cedarPaths) {
            try {
                const cedarUri = new URI(pathStr);
                await this.fileService.delete(cedarUri);
                const roCratePathStr = pathStr.replace('/metadata-schemas/cedar/', '/metadata-schemas/ro-crate/');
                const roCrateUri = new URI(roCratePathStr);
                if (await this.fileService.exists(roCrateUri)) await this.fileService.delete(roCrateUri);
                count++;
            } catch (err) { console.error(`Failed to delete ${pathStr}`, err); }
        }
        if (count > 0) this.onDidChangeSchemasEmitter.fire();
        return count;
    }

    protected async getAromaRootUri(): Promise<URI | null> {
        const result = await this.envVariablesServer.getValue('AROMA_ROOT_PATH');
        if (!result?.value) return null;
        const normalized = result.value.replace(/\\/g, '/');
        return normalized.match(/^[a-zA-Z]:/) ? new URI('file:///' + normalized) : new URI('file://' + normalized);
    }

    protected async getCedarDir(type: 'local' | 'remote'): Promise<URI | null> {
        const root = await this.getAromaRootUri();
        if (!root) return null;
        return root.resolve(`metadata-schemas/cedar/${type}`);
    }

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
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
import type { SchemaInfo } from './types';

export const SCHEMA_FIELD_NAME = 'schema:name';
export const SCHEMA_FIELD_VERSION = 'pav:version';
export const SCHEMA_FIELD_ID = '@id';

@injectable()
export class SchemaManagerService implements FrontendApplicationContribution {
    
    @inject(AppStateService) protected readonly appStateService!: AppStateService;
    @inject(FileService) protected readonly fileService!: FileService;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(EnvVariablesServer) protected readonly envVariablesServer!: EnvVariablesServer;

    private readonly converter = new CedarTemplateToDescriboProfileConverter();
    private isChecking = false;

    private readonly onDidChangeSchemasEmitter = new Emitter<void>();
    readonly onDidChangeSchemas: Event<void> = this.onDidChangeSchemasEmitter.event;

    @postConstruct()
    init() {
        this.appStateService.onDidChangeSelector(state => state.roCrate)(
            (newCrate) => {
                if (newCrate) {
                    this.checkAndDownloadSchemas(newCrate);
                }
            }
        );
    }

    onStart(): void {
        const currentCrate = this.appStateService.roCrate;
        if (currentCrate) {
            this.checkAndDownloadSchemas(currentCrate);
        }
    }

    /* ------------------------------------------------------------------
       SMART FETCHING LOGIC (STRICT RULES)
       ------------------------------------------------------------------ */

    /**
     * Fetches a schema string applying strict domain-specific rules.
     */
    private async smartFetchSchema(url: string, apiKey?: string): Promise<string> {
        
        // CASE 3: Open/Public Link
        // URL: https://open.cedardev.dsd.sztaki.hu/...
        // Action: Fetch directly. No API Key needed.
        if (url.includes('open.cedardev.dsd.sztaki.hu')) {
            console.log('[SchemaManager] Detected Open Link. Fetching directly...');
            const response = await fetch(url, { method: 'GET' });
            
            if (!response.ok) {
                throw new Error(`Open Link fetch failed (HTTP ${response.status}). The resource might not exist.`);
            }
            return await response.text();
        }

        // CASE 2: Dev Repo Link
        // URL: https://repo.cedardev.dsd.sztaki.hu/...
        // Action: MUST be transformed to Open Link. Original is not used.
        if (url.includes('repo.cedardev.dsd.sztaki.hu')) {
            console.log('[SchemaManager] Detected Dev Repo Link. Transforming to Open Link...');
            
            // Transformation logic: Base URL + Encoded Original URL
            const encodedOriginal = encodeURIComponent(url);
            const openUrl = `https://open.cedardev.dsd.sztaki.hu/templates/${encodedOriginal}`;
            
            console.log(`[SchemaManager] Transformed URL: ${openUrl}`);

            const response = await fetch(openUrl, { method: 'GET' });
            
            if (!response.ok) {
                throw new Error(`Transformed fetch failed (HTTP ${response.status}). Could not access the public version of this schema.`);
            }
            return await response.text();
        }

        // CASE 1: Research Data Repo
        // URL: https://repo.schema.researchdata.hu/...
        // Action: MUST have API Key.
        if (url.includes('repo.schema.researchdata.hu')) {
            console.log('[SchemaManager] Detected Research Data Repo.');

            if (!apiKey) {
                // Strict failure if no key
                throw new Error('Access Denied: This repository (researchdata.hu) requires a configured CEDAR_API_KEY. Please check your .env file or environment variables.');
            }

            const response = await fetch(url, { 
                method: 'GET',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `apiKey ${apiKey}`
                }
            });

            if (response.status === 401 || response.status === 403) {
                throw new Error('Access Denied: Your API Key was rejected (Unauthorized).');
            }
            if (!response.ok) {
                throw new Error(`Authenticated fetch failed (HTTP ${response.status}).`);
            }
            return await response.text();
        }

        // FALLBACK: Unknown Domain
        // Behavior: Try as-is. If key exists, send it. If not, don't.
        console.log('[SchemaManager] Unknown domain. Attempting generic fetch...');
        const headers: any = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `apiKey ${apiKey}`;
        
        const response = await fetch(url, { method: 'GET', headers });
        if (!response.ok) {
            throw new Error(`Download failed (HTTP ${response.status}). Please check the URL.`);
        }
        return await response.text();
    }

    /* ------------------------------------------------------------------
       AUTO-DOWNLOAD LOGIC
       ------------------------------------------------------------------ */

    protected async checkAndDownloadSchemas(roCrate: any): Promise<void> {
        if (this.isChecking || !roCrate || !roCrate['@graph']) return;
        this.isChecking = true;

        try {
            if (!navigator.onLine) {
                console.warn('[SchemaManager] Offline. Skipping schema check.');
                return;
            }

            const requiredUUIDs = new Set<string>();
            const graph = Array.isArray(roCrate['@graph']) ? roCrate['@graph'] : [roCrate];

            for (const entity of graph) {
                if (entity.conformsTo) {
                    const conformsArray = Array.isArray(entity.conformsTo) ? entity.conformsTo : [entity.conformsTo];
                    for (const item of conformsArray) {
                        const id = item['@id'];
                        if (id && typeof id === 'string' && id.includes('/schema/')) {
                            const parts = id.split('/');
                            const uuid = parts[parts.length - 1];
                            if (uuid) requiredUUIDs.add(uuid);
                        }
                    }
                }
            }

            if (requiredUUIDs.size === 0) return;

            const missingUUIDs = await this.filterMissingSchemas(Array.from(requiredUUIDs));

            if (missingUUIDs.length === 0) return;

            await new Promise<void>((resolve) => {
                Modal.info({
                    title: 'Missing Metadata Schemas Detected',
                    content: `The opened RO-Crate references ${missingUUIDs.length} schema(s) that are missing from your local repository. The application will now download and convert them automatically.`,
                    okText: 'OK',
                    onOk: () => resolve(),
                    maskClosable: false
                });
            });

            await this.messageService.showProgress({
                text: 'Resolving Missing Schemas...'
            }).then(async progress => {
                const total = missingUUIDs.length;
                let completed = 0;
                progress.report({ message: 'Starting downloads...', work: { done: 0, total } });

                const downloadPromises = missingUUIDs.map(async (uuid) => {
                    try {
                        await this.downloadSchemaByUUID(uuid);
                    } catch (e) {
                        console.error(`Failed to auto-download ${uuid}`, e);
                    } finally {
                        completed++;
                        progress.report({ message: `Downloading (${completed}/${total})...`, work: { done: completed, total } });
                    }
                });

                await Promise.all(downloadPromises);
            });

            this.onDidChangeSchemasEmitter.fire();
            this.messageService.info('Missing schemas successfully synchronized.');

        } catch (error) {
            console.error('[SchemaManager] Error verifying schemas:', error);
            this.messageService.error(`Schema Synchronization Error: ${error instanceof Error ? error.message : error}`);
        } finally {
            this.isChecking = false;
        }
    }

    // Helper specific to UUID-based downloads (Auto-download)
    protected async downloadSchemaByUUID(uuid: string): Promise<void> {
        const apiKeyVar = await this.envVariablesServer.getValue('CEDAR_API_KEY');
        const apiKey = apiKeyVar?.value;

        // Determine URL based on API Key presence (Auto-selection logic)
        let url: string;
        if (apiKey) {
            url = `https://repo.schema.researchdata.hu/templates/${uuid}`;
        } else {
            // Fallback to dev repo
            const encodedUrl = encodeURIComponent(`https://repo.cedardev.dsd.sztaki.hu/templates/${uuid}`);
            url = `https://open.cedardev.dsd.sztaki.hu/templates/${encodedUrl}`;
        }

        // Use Smart Fetch (even though we constructed it, it handles the actual fetch safely)
        const rawString = await this.smartFetchSchema(url, apiKey);
        
        await this.processAndSaveSchema(rawString, 'remote');
        console.log(`[SchemaManager] Successfully downloaded UUID: ${uuid}`);
    }

    protected async filterMissingSchemas(uuids: string[]): Promise<string[]> {
        const root = await this.getAromaRootUri();
        if (!root) return uuids;

        const checkFolder = async (type: 'local' | 'remote'): Promise<string[]> => {
            const dir = root.resolve(`metadata-schemas/cedar/${type}`);
            if (!await this.fileService.exists(dir)) return [];
            
            const stat = await this.fileService.resolve(dir);
            if (!stat || !stat.children) return [];

            const found: string[] = [];
            for (const file of stat.children) {
                if (!file.name.endsWith('.json')) continue;
                try {
                    const content = await this.fileService.read(file.resource);
                    const parsed = JSON.parse(content.value);
                    const refId = parsed[SCHEMA_FIELD_ID];
                    if (refId && typeof refId === 'string') {
                         for (const uuid of uuids) {
                             if (refId.includes(uuid)) found.push(uuid);
                         }
                    }
                } catch (e) { /* ignore */ }
            }
            return found;
        };

        const foundLocal = await checkFolder('local');
        const foundRemote = await checkFolder('remote');
        const allFound = new Set([...foundLocal, ...foundRemote]);

        return uuids.filter(uuid => !allFound.has(uuid));
    }

    /* ------------------------------------------------------------------
       WIDGET PUBLIC API
       ------------------------------------------------------------------ */

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
                await this.processAndSaveSchema(content.value, 'local', fileName);
                success++;
            } catch (error) {
                fail++;
                console.error(`Import failed for ${fileName}`, error);
            }
            progress.report({ work: { done: i + 1, total } });
        }
        
        progress.report({ message: 'Done', work: { done: total, total } });
        if (success > 0) this.onDidChangeSchemasEmitter.fire();
        return { success, fail };
    }

    public async importFromUrl(url: string, apiKey: string | undefined, progress: any): Promise<string> {
        progress.report({ message: 'Downloading...', work: { done: 20, total: 100 } });
        
        // This now uses the STRICT logic defined above
        const rawString = await this.smartFetchSchema(url, apiKey);
        
        progress.report({ message: 'Processing...', work: { done: 50, total: 100 } });
        
        const schemaName = await this.processAndSaveSchema(rawString, 'remote');
        
        progress.report({ message: 'Finished', work: { done: 100, total: 100 } });
        this.onDidChangeSchemasEmitter.fire();
        return schemaName;
    }

    private async processAndSaveSchema(
        rawContent: string, 
        type: 'local' | 'remote', 
        originalFileName?: string
    ): Promise<string> {
        let parsedRaw: any;
        try {
            parsedRaw = JSON.parse(rawContent);
        } catch (e) {
            throw new Error('Invalid JSON format');
        }

        const schemaName = parsedRaw[SCHEMA_FIELD_NAME];
        const schemaVersion = parsedRaw[SCHEMA_FIELD_VERSION];

        if (!schemaName || !schemaVersion) {
            throw new Error(`Missing required fields: ${SCHEMA_FIELD_NAME} or ${SCHEMA_FIELD_VERSION}`);
        }

        let fileName = originalFileName;
        if (!fileName || type === 'remote') {
            fileName = `remote_${schemaName.toLowerCase().replace(/\s+/g, '_')}_v${schemaVersion}.json`;
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

                    if (schemaName && schemaVersion) {
                        schemas.push({
                            name: schemaName,
                            version: schemaVersion,
                            reference: schemaId || '', 
                            source,
                            path: file.resource.toString()
                        });
                    }
                } catch (e) { /* ignore */ }
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
                if (await this.fileService.exists(roCrateUri)) {
                    await this.fileService.delete(roCrateUri);
                }
                count++;
            } catch (err) {
                console.error(`Failed to delete ${pathStr}`, err);
            }
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
}
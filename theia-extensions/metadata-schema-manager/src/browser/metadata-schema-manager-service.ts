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

// Constants
export const SCHEMA_FIELD_NAME = 'schema:name';
export const SCHEMA_FIELD_VERSION = 'pav:version';
export const SCHEMA_FIELD_ID = '@id';

/**
 * Service responsible for managing Metadata Schemas (CEDAR & RO-Crate profiles).
 * Handles:
 * 1. Auto-downloading missing schemas referenced in an active RO-Crate.
 * 2. Importing schemas from Files or URLs (via Widget).
 * 3. Converting raw CEDAR templates to RO-Crate profiles.
 */
@injectable()
export class SchemaManagerService implements FrontendApplicationContribution {
    
    @inject(AppStateService) protected readonly appStateService!: AppStateService;
    @inject(FileService) protected readonly fileService!: FileService;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(EnvVariablesServer) protected readonly envVariablesServer!: EnvVariablesServer;

    private readonly converter = new CedarTemplateToDescriboProfileConverter();
    private isChecking = false;

    // Event Emitter to notify UI when schemas are added/removed
    private readonly onDidChangeSchemasEmitter = new Emitter<void>();
    readonly onDidChangeSchemas: Event<void> = this.onDidChangeSchemasEmitter.event;

    @postConstruct()
    init() {
        // Listen for RO-Crate changes in the App State
        this.appStateService.onDidChangeSelector(
            state => state.roCrate
        )((newCrate) => {
            if (newCrate) {
                console.log('[SchemaManager] RO-Crate changed, initiating schema check...');
                this.checkAndDownloadSchemas(newCrate);
            }
        });
    }

    onStart(): void {
        const currentCrate = this.appStateService.roCrate;
        if (currentCrate) {
            this.checkAndDownloadSchemas(currentCrate);
        }
    }

    /* ------------------------------------------------------------------
       CORE PROCESSING LOGIC
       ------------------------------------------------------------------ */

    /**
     * Centralized method to Process and Save a schema.
     * Steps: Parse JSON -> Validate Metadata -> Convert -> Save to Disk.
     * * @param rawContent The raw JSON string of the CEDAR template.
     * @param type Where to save it ('local' or 'remote').
     * @param originalFileName Optional. If provided, tries to preserve it; otherwise generates one.
     * @returns The extracted Name of the schema.
     * @throws Error if validation or conversion fails.
     */
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

        // Generate filename if not provided or if we want to enforce structure for remote files
        let fileName = originalFileName;
        if (!fileName || type === 'remote') {
            fileName = `remote_${schemaName.toLowerCase().replace(/\s+/g, '_')}_v${schemaVersion}.json`;
        }

        // Convert
        let convertedContent: string;
        try {
            convertedContent = this.converter.processCedarTemplate(rawContent);
        } catch (convErr) {
            throw new Error(`Conversion logic failed: ${convErr}`);
        }

        // Save
        const root = await this.getAromaRootUri();
        if (!root) throw new Error('Root directory configuration missing');

        const cedarUri = root.resolve(`metadata-schemas/cedar/${type}/${fileName}`);
        const roCrateUri = root.resolve(`metadata-schemas/ro-crate/${type}/${fileName}`);

        // Write files in parallel
        await Promise.all([
            this.fileService.write(cedarUri, rawContent),
            this.fileService.write(roCrateUri, convertedContent)
        ]);

        return schemaName;
    }

    /* ------------------------------------------------------------------
       AUTO-DOWNLOAD LOGIC
       ------------------------------------------------------------------ */

    /**
     * Analyzes an RO-Crate to find schemas referenced in 'conformsTo' 
     * that are missing from the local repository.
     */
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

            // 1. Extract UUIDs
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

            // 2. Filter existing
            const missingUUIDs = await this.filterMissingSchemas(Array.from(requiredUUIDs));

            if (missingUUIDs.length === 0) {
                console.log('[SchemaManager] All referenced schemas are present locally.');
                return;
            }

            // 3. User Consent
            await new Promise<void>((resolve) => {
                Modal.info({
                    title: 'Missing Metadata Schemas Detected',
                    content: `The opened RO-Crate references ${missingUUIDs.length} schema(s) that are missing from your local repository. The application will now download and convert them automatically.`,
                    okText: 'OK',
                    onOk: () => resolve(),
                    maskClosable: false
                });
            });

            // 4. Download
            await this.messageService.showProgress({
                text: 'Resolving Missing Schemas...'
            }).then(async progress => {
                const total = missingUUIDs.length;
                let completed = 0;
                progress.report({ message: 'Starting downloads...', work: { done: 0, total } });

                const downloadPromises = missingUUIDs.map(async (uuid) => {
                    try {
                        await this.downloadSchema(uuid);
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

    protected async downloadSchema(uuid: string): Promise<void> {
        const apiKeyVar = await this.envVariablesServer.getValue('CEDAR_API_KEY');
        const apiKey = apiKeyVar?.value;

        let url: string;
        let headers: any = { 'Content-Type': 'application/json' };

        if (apiKey) {
            url = `https://repo.schema.researchdata.hu/templates/${uuid}`;
            headers['Authorization'] = `apiKey ${apiKey}`;
        } else {
            const encodedUrl = encodeURIComponent(`https://repo.cedardev.dsd.sztaki.hu/templates/${uuid}`);
            url = `https://open.cedardev.dsd.sztaki.hu/templates/${encodedUrl}`;
        }

        const response = await fetch(url, { method: 'GET', headers });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const rawString = await response.text();
        
        // Use unified processing method
        const schemaName = await this.processAndSaveSchema(rawString, 'remote');
        console.log(`[SchemaManager] Successfully downloaded: ${schemaName}`);
    }

    /**
     * Checks filesystem to see which UUIDs are already present.
     */
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

    /**
     * Imports schemas from a list of File URIs.
     * @param fileUris URIs of files selected by user.
     * @param progress Progress monitor object.
     */
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
                // Use unified processing method
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

    /**
     * Imports a single schema from a given URL.
     */
    public async importFromUrl(url: string, apiKey: string, progress: any): Promise<string> {
        progress.report({ message: 'Downloading...', work: { done: 20, total: 100 } });
        
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'Authorization': `apiKey ${apiKey}` }
        });

        if (!response.ok) throw new Error(`Download failed: ${response.status}`);
        
        const rawString = await response.text();
        
        progress.report({ message: 'Processing...', work: { done: 50, total: 100 } });
        
        // Use unified processing method
        const schemaName = await this.processAndSaveSchema(rawString, 'remote');
        
        progress.report({ message: 'Finished', work: { done: 100, total: 100 } });
        this.onDidChangeSchemasEmitter.fire();
        return schemaName;
    }

    /**
     * Loads all schemas for the UI Table.
     */
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

                    if (!schemaName || !schemaVersion) continue;

                    schemas.push({
                        name: schemaName,
                        version: schemaVersion,
                        reference: schemaId || '', 
                        source,
                        path: file.resource.toString()
                    });
                } catch (e) { /* ignore parse errors */ }
            }
        }
        return schemas;
    }

    /**
     * Deletes schemas from both CEDAR and RO-Crate folders.
     */
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

    // --- Helpers ---

    protected async getAromaRootUri(): Promise<URI | null> {
        const result = await this.envVariablesServer.getValue('AROMA_ROOT_PATH');
        if (!result?.value) return null;
        return toFileUri(result.value);
    }

    protected async getCedarDir(type: 'local' | 'remote'): Promise<URI | null> {
        const root = await this.getAromaRootUri();
        if (!root) return null;
        return root.resolve(`metadata-schemas/cedar/${type}`);
    }
}

// Simple helper to convert string paths to URI objects safely
function toFileUri(path: string): URI {
    const normalized = path.replace(/\\/g, '/');
    if (normalized.match(/^[a-zA-Z]:/)) {
        return new URI('file:///' + normalized);
    } else {
        return new URI('file://' + normalized);
    }
}
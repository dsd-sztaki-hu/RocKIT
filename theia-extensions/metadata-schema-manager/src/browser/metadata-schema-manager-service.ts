import { injectable, inject, postConstruct } from 'inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { URI } from '@theia/core/lib/common/uri';
import { Emitter, Event } from '@theia/core/lib/common/event'; // Import Event tools
import { AppStateService } from 'app-state/lib/browser/state/app-state-service';
import { Modal } from 'antd'; // Import UI for the popup

import { CedarTemplateToDescriboProfileConverter } from 'cedar-template-converter';
import type { SchemaInfo } from './types';

// Constants
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

    // EVENT EMITTER: Notifies listeners (like the Widget) when data changes
    private readonly onDidChangeSchemasEmitter = new Emitter<void>();
    readonly onDidChangeSchemas: Event<void> = this.onDidChangeSchemasEmitter.event;

    @postConstruct()
    init() {
        this.appStateService.onDidChangeSelector(state => state.roCrate)(
            (newCrate) => {
                if (newCrate) {
                    console.log('[SchemaManager] RO-Crate changed, checking schemas...');
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
       AUTO-DOWNLOAD LOGIC
       ------------------------------------------------------------------ */

    protected async checkAndDownloadSchemas(roCrate: any): Promise<void> {
        // Prevent re-entry or running on invalid data
        if (this.isChecking || !roCrate || !roCrate['@graph']) return;
        this.isChecking = true;

        try {
            // 0. Safety Check: Are we online?
            if (!navigator.onLine) {
                console.warn('[SchemaManager] Offline. Skipping schema check.');
                return;
            }

            // 1. Extract Schema UUIDs
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

            // 2. Filter out schemas we already have
            const missingUUIDs = await this.filterMissingSchemas(Array.from(requiredUUIDs));

            if (missingUUIDs.length === 0) {
                console.log('[SchemaManager] All referenced schemas are present locally.');
                return;
            }

            // 3. USER FEEDBACK: Show Popup Dialog
            // We wrap this in a Promise to "pause" execution until the user clicks OK
            await new Promise<void>((resolve) => {
                Modal.info({
                    title: 'Missing Metadata Schemas Detected',
                    content: `The opened RO-Crate references ${missingUUIDs.length} schema(s) that are missing from your local repository. The application will now download and convert them automatically.`,
                    okText: 'OK',
                    onOk: () => resolve(),
                    maskClosable: false
                });
            });

            // 4. Download Process with Progress Bar
            await this.messageService.showProgress({
                text: 'Resolving Missing Schemas...'
            }).then(async progress => {
                const total = missingUUIDs.length;
                let completed = 0;

                progress.report({ message: 'Starting downloads...', work: { done: 0, total } });

                // Use Promise.all for parallel downloads (Faster!)
                const downloadPromises = missingUUIDs.map(async (uuid) => {
                    try {
                        await this.downloadSchema(uuid);
                    } catch (e) {
                        console.error(`Failed to auto-download ${uuid}`, e);
                    } finally {
                        completed++;
                        progress.report({ 
                            message: `Downloading schemas (${completed}/${total})...`, 
                            work: { done: completed, total } 
                        });
                    }
                });

                await Promise.all(downloadPromises);
            });

            // 5. NOTIFY: Fire event so the Widget updates automatically
            this.onDidChangeSchemasEmitter.fire();
            this.messageService.info('Missing schemas successfully synchronized.');

        } catch (error) {
            console.error('[SchemaManager] Error verifying schemas:', error);
            this.messageService.error(`Schema Synchronization Error: ${error instanceof Error ? error.message : error}`);
        } finally {
            this.isChecking = false;
        }
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

    protected async downloadSchema(uuid: string): Promise<void> {
        // NOTE: No try-catch here, we let the caller (Promise.all) handle errors
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
        
        const parsed = JSON.parse(rawString);
        const name = parsed[SCHEMA_FIELD_NAME];
        const version = parsed[SCHEMA_FIELD_VERSION];
        
        if (!name || !version) throw new Error('Invalid schema content');

        const fileName = `remote_${name.toLowerCase().replace(/\s+/g, '_')}_v${version}.json`;
        await this.saveSchemaPair(fileName, rawString, 'remote');
    }

    /* ------------------------------------------------------------------
       WIDGET SUPPORT LOGIC
       ------------------------------------------------------------------ */

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
        // Notify listeners that data changed
        if (count > 0) this.onDidChangeSchemasEmitter.fire();
        return count;
    }

    public async importFiles(fileUris: URI[], progress: any): Promise<{ success: number; fail: number }> {
        let success = 0;
        let fail = 0;

        progress.report({ message: 'Reading Files...', work: { done: 0, total: 100 } });

        for (let i = 0; i < fileUris.length; i++) {
            const fileUri = fileUris[i];
            const fileName = fileUri.path.base;
            const percent = Math.floor(((i + 1) / fileUris.length) * 100);

            try {
                const content = await this.fileService.read(fileUri);
                await this.processSingleImport(fileName, content.value, 'local', progress);
                success++;
            } catch (error) {
                fail++;
                console.error(error);
            }
            progress.report({ work: { done: percent, total: 100 } });
        }
        
        progress.report({ message: 'Done', work: { done: 100, total: 100 } });
        
        if (success > 0) this.onDidChangeSchemasEmitter.fire(); // Notify update
        return { success, fail };
    }

    public async importFromUrl(url: string, apiKey: string, progress: any): Promise<string> {
        progress.report({ message: 'Downloading...', work: { done: 20, total: 100 } });
        
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'Authorization': `apiKey ${apiKey}` }
        });

        if (!response.ok) throw new Error(`Download failed: ${response.status}`);
        
        const rawString = await response.text();
        const parsed = JSON.parse(rawString);
        const name = parsed[SCHEMA_FIELD_NAME];
        const version = parsed[SCHEMA_FIELD_VERSION];
        
        if (!name || !version) throw new Error('Cannot determine filename');

        const fileName = `remote_${name.toLowerCase().replace(/\s+/g, '_')}_v${version}.json`;

        await this.processSingleImport(fileName, rawString, 'remote', progress);
        
        progress.report({ message: 'Finished', work: { done: 100, total: 100 } });
        this.onDidChangeSchemasEmitter.fire(); // Notify update
        return name;
    }

    private async processSingleImport(fileName: string, rawContent: string, type: 'local' | 'remote', progress: any): Promise<void> {
        progress.report({ message: 'Validating Schema...', work: { done: 10, total: 100 } });
        
        let parsedRaw: any;
        try {
            parsedRaw = JSON.parse(rawContent);
        } catch (e) {
            throw new Error('Invalid JSON format');
        }

        if (!parsedRaw[SCHEMA_FIELD_NAME] || !parsedRaw[SCHEMA_FIELD_VERSION]) {
            throw new Error(`Missing required fields`);
        }

        progress.report({ message: 'Saving...', work: { done: 50, total: 100 } });
        await this.saveSchemaPair(fileName, rawContent, type);
    }

    public async saveSchemaPair(fileName: string, rawContent: string, type: 'local' | 'remote'): Promise<boolean> {
        const root = await this.getAromaRootUri();
        if (!root) return false;

        const cedarUri = root.resolve(`metadata-schemas/cedar/${type}/${fileName}`);
        const roCrateUri = root.resolve(`metadata-schemas/ro-crate/${type}/${fileName}`);

        try {
            const convertedContent = this.converter.processCedarTemplate(rawContent);
            await this.fileService.write(cedarUri, rawContent);
            await this.fileService.write(roCrateUri, convertedContent);
            return true;
        } catch (error) {
            console.error(error);
            return false;
        }
    }

    protected async getAromaRootUri(): Promise<URI | null> {
        const result = await this.envVariablesServer.getValue('AROMA_ROOT_PATH');
        if (!result?.value) return null;
        
        const pathStr = result.value;
        const normalized = pathStr.replace(/\\/g, '/');
        if (normalized.match(/^[a-zA-Z]:/)) {
            return new URI('file:///' + normalized);
        } else {
            return new URI('file://' + normalized);
        }
    }

    protected async getCedarDir(type: 'local' | 'remote'): Promise<URI | null> {
        const root = await this.getAromaRootUri();
        if (!root) return null;
        return root.resolve(`metadata-schemas/cedar/${type}`);
    }
}
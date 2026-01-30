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
import type { SchemaInfo } from '../types';
import { SchemaApi } from './schema-api';
import type { MetadataSchemaManager as MetadataSchemaManagerContract } from 'aroma2-common/lib/browser';

export const SCHEMA_FIELD_NAME = 'schema:name';
export const SCHEMA_FIELD_VERSION = 'pav:version';
export const SCHEMA_FIELD_ID = '@id';

const MSG_TIMEOUT = 5000;
const REPO_DOMAINS = {
    OPEN_DEV: 'open.cedardev.dsd.sztaki.hu',
    REPO_DEV: 'repo.cedardev.dsd.sztaki.hu',
    RESEARCH_DATA: 'repo.schema.researchdata.hu',
    W3ID_BASE: 'https://w3id.org/arp/dev'
};
const LEGACY_DOMAIN_BASE = 'schema.researchdata.hu';

@injectable()
export class SchemaManagerService implements FrontendApplicationContribution, MetadataSchemaManagerContract {
    
    @inject(AppStateService) protected readonly appStateService!: AppStateService;
    @inject(FileService) protected readonly fileService!: FileService;
    @inject(MessageService) protected readonly messageService!: MessageService;
    @inject(EnvVariablesServer) protected readonly envVariablesServer!: EnvVariablesServer;

    private readonly converter = new CedarTemplateToDescriboProfileConverter();
    private isChecking = false;

    private readonly onDidChangeSchemasEmitter = new Emitter<void>();
    readonly onDidChangeSchemas: Event<void> = this.onDidChangeSchemasEmitter.event;

    // Event to Trigger Remote Browser Window
    private readonly onOpenRemoteBrowserEmitter = new Emitter<void>();
    readonly onOpenRemoteBrowser: Event<void> = this.onOpenRemoteBrowserEmitter.event;

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

    /* ------------------------------------------------------------------
       BROWSE & DOWNLOAD LOGIC
       ------------------------------------------------------------------ */

    /**
     * Triggers the UI to open the "Browse Remote" dialog.
     */
    public async browseRemoteSchemas(): Promise<void> {
        this.onOpenRemoteBrowserEmitter.fire();
    }

    /**
     * Called by the Remote Browser Dialog when "ADD" is clicked.
     */
    public async downloadRemoteSchema(templateId: string): Promise<void> {
        try {
            const apiKeyVar = await this.envVariablesServer.getValue('CEDAR_API_KEY');
            const apiKey = apiKeyVar?.value;

            if (!apiKey) {
                this.messageService.warn('Downloading requires an API Key.', { timeout: MSG_TIMEOUT });
                throw new Error('Missing API Key');
            }

            // Use SchemaApi to download JSON
            const api = new SchemaApi({
                domainBase: LEGACY_DOMAIN_BASE,
                apiKey: apiKey
            });

            this.messageService.info('Downloading schema...', { timeout: MSG_TIMEOUT });
            
            const schemaContent = await api.downloadSchema(templateId);
            
            // Convert object to string if axios parsed it
            const rawString = typeof schemaContent === 'string' 
                ? schemaContent 
                : JSON.stringify(schemaContent, null, 2);

            // Save and convert
            const name = await this.processAndSaveSchema(rawString, 'remote');
            
            this.onDidChangeSchemasEmitter.fire();
            this.messageService.info(`Successfully added schema: ${name}`, { timeout: MSG_TIMEOUT });

        } catch (error) {
            console.error('Download failed:', error);
            this.messageService.error(`Download failed: ${error instanceof Error ? error.message : error}`, { timeout: MSG_TIMEOUT });
            throw error;
        }
    }

    /* ------------------------------------------------------------------
       SMART FETCHING LOGIC
       ------------------------------------------------------------------ */
    private async smartFetchSchema(url: string, apiKey?: string): Promise<string> {
        if (url.includes(REPO_DOMAINS.OPEN_DEV)) {
            const response = await fetch(url, { method: 'GET' });
            if (!response.ok) throw new Error(`Open Link fetch failed (HTTP ${response.status}).`);
            return await response.text();
        }
        if (url.includes(REPO_DOMAINS.REPO_DEV)) {
            const encodedOriginal = encodeURIComponent(url);
            const openUrl = `https://${REPO_DOMAINS.OPEN_DEV}/templates/${encodedOriginal}`;
            const response = await fetch(openUrl, { method: 'GET' });
            if (!response.ok) throw new Error(`Transformed fetch failed (HTTP ${response.status}).`);
            return await response.text();
        }
        if (url.includes(REPO_DOMAINS.RESEARCH_DATA)) {
            if (!apiKey) throw new Error('Access Denied: Missing CEDAR_API_KEY.');
            const response = await fetch(url, { 
                method: 'GET',
                headers: { 'Content-Type': 'application/json', 'Authorization': `apiKey ${apiKey}` }
            });
            if (response.status === 401 || response.status === 403) throw new Error('Access Denied: API Key rejected.');
            if (!response.ok) throw new Error(`Authenticated fetch failed (HTTP ${response.status}).`);
            return await response.text();
        }
        const headers: any = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `apiKey ${apiKey}`;
        const response = await fetch(url, { method: 'GET', headers });
        if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}).`);
        return await response.text();
    }

    protected async checkAndDownloadSchemas(roCrate: any): Promise<void> {
        if (this.isChecking || !roCrate || !roCrate['@graph']) return;
        this.isChecking = true;
        try {
            if (!navigator.onLine) return;
            const requiredUUIDs = this.extractSchemaUUIDs(roCrate);
            if (requiredUUIDs.size === 0) return;
            const missingUUIDs = await this.filterMissingSchemas(Array.from(requiredUUIDs));
            if (missingUUIDs.length === 0) return;

            await new Promise<void>((resolve) => {
                Modal.info({
                    title: 'Missing Metadata Schemas',
                    content: `The RO-Crate references ${missingUUIDs.length} missing schema(s). Downloading now.`,
                    okText: 'OK', onOk: () => resolve(), maskClosable: false
                });
            });

            await this.messageService.showProgress({ text: 'Resolving Missing Schemas...' })
                .then(async progress => {
                    try {
                        const total = missingUUIDs.length;
                        let completed = 0;
                        progress.report({ message: 'Starting...', work: { done: 0, total } });
                        await Promise.all(missingUUIDs.map(async (uuid) => {
                            try { await this.downloadSchemaByUUID(uuid); }
                            catch (e) { console.error(`Failed to auto-download ${uuid}`, e); }
                            finally {
                                completed++;
                                progress.report({ message: `Downloading (${completed}/${total})...`, work: { done: completed, total } });
                            }
                        }));
                    } finally { progress.cancel(); }
                });
            this.onDidChangeSchemasEmitter.fire();
            this.messageService.info('Schemas synchronized.', { timeout: MSG_TIMEOUT });
        } catch (error) {
            console.error('[SchemaManager] Error verifying schemas:', error);
            this.messageService.error(`Schema Sync Error: ${error instanceof Error ? error.message : error}`, { timeout: MSG_TIMEOUT });
        } finally {
            this.isChecking = false;
        }
    }

    private extractSchemaUUIDs(roCrate: any): Set<string> {
        const requiredUUIDs = new Set<string>();
        const graph = Array.isArray(roCrate['@graph']) ? roCrate['@graph'] : [roCrate];
        for (const entity of graph) {
            if (!entity.conformsTo) continue;
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
        return requiredUUIDs;
    }

    protected async downloadSchemaByUUID(uuid: string): Promise<void> {
        const apiKeyVar = await this.envVariablesServer.getValue('CEDAR_API_KEY');
        const apiKey = apiKeyVar?.value;
        let url: string;
        if (apiKey) url = `https://${REPO_DOMAINS.RESEARCH_DATA}/templates/${uuid}`;
        else {
            const encodedUrl = encodeURIComponent(`https://${REPO_DOMAINS.REPO_DEV}/templates/${uuid}`);
            url = `https://${REPO_DOMAINS.OPEN_DEV}/templates/${encodedUrl}`;
        }
        const rawString = await this.smartFetchSchema(url, apiKey);
        await this.processAndSaveSchema(rawString, 'remote');
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
                         uuids.forEach(uuid => { if (refId.includes(uuid)) found.push(uuid); });
                    }
                } catch { /* ignore */ }
            }
            return found;
        };
        const foundLocal = await checkFolder('local');
        const foundRemote = await checkFolder('remote');
        const allFound = new Set([...foundLocal, ...foundRemote]);
        return uuids.filter(uuid => !allFound.has(uuid));
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
                await this.processAndSaveSchema(content.value, 'local', fileName);
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

    public async importFromUrl(url: string, apiKey: string | undefined, progress: any): Promise<string> {
        progress.report({ message: 'Downloading...', work: { done: 20, total: 100 } });
        const rawString = await this.smartFetchSchema(url, apiKey);
        progress.report({ message: 'Processing...', work: { done: 50, total: 100 } });
        const schemaName = await this.processAndSaveSchema(rawString, 'remote');
        progress.report({ work: { done: 100, total: 100 } });
        this.onDidChangeSchemasEmitter.fire();
        return schemaName;
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

    private async processAndSaveSchema(rawContent: string, type: 'local' | 'remote', originalFileName?: string): Promise<string> {
        let parsedRaw: any;
        try { parsedRaw = JSON.parse(rawContent); } catch (e) { throw new Error('Invalid JSON format'); }
        const schemaName = parsedRaw[SCHEMA_FIELD_NAME];
        const schemaVersion = parsedRaw[SCHEMA_FIELD_VERSION];
        if (!schemaName || !schemaVersion) throw new Error(`Missing required fields: ${SCHEMA_FIELD_NAME} or ${SCHEMA_FIELD_VERSION}`);
        let fileName = originalFileName;
        if (!fileName || type === 'remote') {
            fileName = `remote_${schemaName.toLowerCase().replace(/\s+/g, '_')}_v${schemaVersion}.json`;
        }
        let convertedContent: string;
        try { convertedContent = this.converter.processCedarTemplate(rawContent); } catch (convErr) { throw new Error(`Conversion logic failed: ${convErr}`); }
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
                        schemas.push({ name: schemaName, version: schemaVersion, reference: schemaId || '', source, path: file.resource.toString() });
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

    /**
     * Merges CEDAR templates into one profile
     * @param crate
     * @param baseProfile
     * @returns Merged profile
     */
    public async getMergedProfile(crate: Record<string, any>, newProfile: Record<string, any>, profile: Record<string, any>) {

    const entities: any = Object.values(crate["@graph"]).filter((entity: any) => entity["@type"] != "CreativeWork")

    for (const entity of entities) {
        const entityType = Array.isArray(entity["@type"]) ? entity["@type"][0] : entity["@type"]
        const conformsTos = entity['conformsTo'] ? (Array.isArray(entity['conformsTo']) ? entity['conformsTo'] : [entity['conformsTo']]) : undefined;

        if (!conformsTos) {
            continue
        }

        // const conformsToUrls: string[] = this.convertW3idUrlsToCedarTemplateUrls(conformsTos.map(c => c["@id"]))

        try {
        //     const templateMap = await this.getCedarTemplates(conformsToUrls)

        //     const actualTemplates: Record<string, any>[] = []
        //     templateMap.forEach((value: Record<string, any>, key: string) => {
        //         if (typeof value != "string") {
        //         actualTemplates.push(value)
        //         }
        //     })

        //     const profilesForCedar = await getProfilesForCedarTemplates(actualTemplates).catch(err => { throw err })

        //     // Add each profile to the File class
        //     profilesForCedar.forEach((p: Record<string, any>) => {
                this.addProfileToClass(newProfile, entityType, profile)
            // })
        } catch (error) {
        console.error(error)
        throw error
        }
    }

    console.debug("MERGED PROFILE", profile)
    return profile
    }

    protected addProfileToClass(profileToAdd: Record<string, any>, className: string, rootProfile: Record<string, any>) {
        if (!profileToAdd || !profileToAdd.classes || !profileToAdd.classes.Dataset) {
            console.warn('Invalid profileToAdd structure:', profileToAdd);
            return;
        }
    const inputs = profileToAdd.classes.Dataset.inputs
    let theClass = rootProfile.classes[className]
    if (!theClass) {
        theClass = {
            inputs: []
        }
        rootProfile.classes[className] = theClass
    }
    // Disable the "Add property" button
    theClass.definition = "override"

    let name = this.nameWithoutMetadataSuffix(profileToAdd.metadata.name)
    let desc: string | null = profileToAdd.metadata.description
    // let desc = nameWithoutMetadataSuffix(profileToAdd.metadata.description)

    // If the description is the same as the name, ignore that
    if (name == this.nameWithoutMetadataSuffix(desc)) {
        desc = null
    }

    // Assign each field to the layout group
    profileToAdd.classes["Dataset"].inputs.forEach((input: Record<string, any>) => input.group = name)

    // Merge them with input profile
    theClass.inputs = [...theClass.inputs, ...inputs]

    let layouts = rootProfile.layouts
    if (!layouts) {
        layouts = rootProfile.layouts = []
    }
    let selectedLayout = layouts.find((layout: any) => layout.appliesTo.includes(className))
    let language = rootProfile.localisation?.language || "en"
    if (!selectedLayout) {
        selectedLayout = {
        appliesTo: [className],
        "about": {
            label: language == "hu" ? "Alap" : "About",
        },
        "overflow": {
            label: language == "hu" ? "Egyéb" : "Other",
        }
        }
        layouts.push(selectedLayout)
    }

    selectedLayout[name!] = {
        label: name!,
        description: desc
    }

    // The "overflow" builtin tab should always be the last one.
    const overflow = selectedLayout["overflow"];
    delete selectedLayout["overflow"]
    selectedLayout["overflow"] = overflow


    // Add missing classes
    for (let className in profileToAdd.classes) {
        if (className != "Dataset" && !rootProfile.classes[className]) {
        rootProfile.classes[className] = profileToAdd.classes[className]
        }
    }

    if (!rootProfile.localisation) {
        rootProfile.localisation = {}
    }

    rootProfile.localisation = {
        ...rootProfile.localisation,
        ...profileToAdd.localisation
    }
    }

    protected nameWithoutMetadataSuffix(name: string | null) {
        if (!name || name == "") {
            return null;
        }
        return name.replace(/ (metadata|metaadatok|metaadatai|metaadat)$/i, '');
    }

    /**
     * Convert w3id based conformsTo URL-s to actual cedar template URL-s. We always want to work with template URL-s once
     * we downloaded the crate json.
     *
     * @param w3idUrls
     */
    public convertW3idUrlsToCedarTemplateUrls(w3idUrls: string[]) {
        // https://w3id.org/arp/localdev/schema/33677b82-7973-3e4c-b09d-b5189e095627
        // --> https://repo.arp.orgx/template/33677b82-7973-3e4c-b09d-b5189e095627
        return w3idUrls.map((url: string) => this.convertW3idUrlToCedarTemplateUrl(url))
    }

    protected convertW3idUrlToCedarTemplateUrl(url: string) {
        // If already a CEDAR template URL, ignore.
        if (url.startsWith("https://repo.")) {
            return url
        }
        const uuid = url.split("schema/").pop();
        return "https://" + REPO_DOMAINS.REPO_DEV + "/templates/" + uuid
    }

    protected convertCedarTemplateUrlsToW3idUrls(cedarUrls: string[]) {
        return cedarUrls.map((url: string) => this.convertCedarTemplateUrlToW3idUrl(url))
    }

    public convertCedarTemplateUrlToW3idUrl(url: string) {
        if (url.startsWith(REPO_DOMAINS.W3ID_BASE)) {
            return url
        }
        const uuid = url.split("templates/").pop()
        return REPO_DOMAINS.W3ID_BASE + "/schema/" + uuid
    }

}


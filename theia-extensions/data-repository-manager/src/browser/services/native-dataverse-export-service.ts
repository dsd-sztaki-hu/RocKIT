import { URI } from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { inject, injectable } from 'inversify';
import {
    collectRoCrateExportFileReferences,
    localizeExternalRoCrateFileReferences,
    RoCrateExportFileSource
} from 'aroma2-common/lib/common/ro-crate-export-file-references';
import { DataRepositoryConfig, DataverseCollection } from '../types';

type RoCrateEntity = Record<string, unknown>;
type RoCrate = Record<string, unknown>;

interface DataverseMetadataField {
    typeName: string;
    typeClass: 'primitive' | 'compound' | 'controlledVocabulary';
    multiple: boolean;
    value: unknown;
}

interface NativeDataverseResponse {
    status?: string;
    data?: {
        id?: number;
        persistentId?: string;
        [key: string]: unknown;
    };
    message?: string;
    [key: string]: unknown;
}

export interface NativeDataverseDatasetCreationResult {
    datasetId?: number;
    persistentId?: string;
    uploadedFiles: NativeDataverseFileUploadResult[];
    requestUrl: string;
    response: NativeDataverseResponse;
}

export interface NativeDataverseFileUploadResult {
    entryPath: string;
    directoryLabel?: string;
    fileName: string;
    response: NativeDataverseResponse;
}

interface NativeDataverseUploadFile {
    entryPath: string;
    content: Uint8Array;
}

@injectable()
export class NativeDataverseExportService {

    constructor(
        @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
        @inject(FileService) protected readonly fileService: FileService
    ) { }

    public async createDataset(
        repository: DataRepositoryConfig,
        collection: DataverseCollection,
        metadataLanguage: string
    ): Promise<NativeDataverseDatasetCreationResult> {
        const baseUrl = this.normalizeBaseUrl(repository.baseUrl);
        const collectionId = collection.alias || collection.id;
        const rootUri = this.getWorkspaceRoot();
        const crate = await this.readRoCrate(rootUri.resolve('ro-crate-metadata.json'));
        const allowedMetadataLanguages = await this.getAllowedMetadataLanguages(baseUrl, collectionId, repository.apiKey);
        this.validateMetadataLanguage(metadataLanguage, allowedMetadataLanguages);
        const payload = this.buildDatasetCreationPayload(crate, metadataLanguage);
        const requestUrl = `${baseUrl}/api/v1/dataverses/${encodeURIComponent(collectionId)}/datasets`;
        const headers: Record<string, string> = {
            accept: 'application/json',
            'content-type': 'application/json'
        };
        if (repository.apiKey) {
            headers['x-dataverse-key'] = repository.apiKey;
        }

        const response = await fetch(requestUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });
        const responsePayload = await this.readResponsePayload(response);
        if (!response.ok || responsePayload.status === 'ERROR') {
            throw new Error(`Dataverse dataset creation failed (${response.status}): ${this.payloadSummary(responsePayload)}`);
        }
        const persistentId = responsePayload.data?.persistentId;
        if (!persistentId) {
            throw new Error('Dataverse created the dataset but did not return a persistentId. File upload cannot continue.');
        }
        const uploadedFiles = await this.uploadRoCrateFiles(baseUrl, repository.apiKey, persistentId, crate, rootUri);

        return {
            datasetId: responsePayload.data?.id,
            persistentId,
            uploadedFiles,
            requestUrl,
            response: responsePayload
        };
    }

    protected getWorkspaceRoot(): URI {
        const roots = this.workspaceService.tryGetRoots();
        const rootUri = roots?.[0]?.resource;
        if (!rootUri) {
            throw new Error('No workspace is open.');
        }
        return rootUri;
    }

    protected async readRoCrate(metadataUri: URI): Promise<RoCrate> {
        if (!(await this.fileService.exists(metadataUri))) {
            throw new Error('ro-crate-metadata.json was not found in the workspace root.');
        }
        const content = await this.fileService.readFile(metadataUri);
        try {
            return JSON.parse(content.value.toString()) as RoCrate;
        } catch (error) {
            throw new Error(`Failed to parse ro-crate-metadata.json: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    protected buildDatasetCreationPayload(crate: RoCrate, metadataLanguage: string): Record<string, unknown> {
        const graph = this.readGraph(crate);
        const root = graph.find(entity => entity['@id'] === './');
        if (!root) {
            throw new Error('The RO-Crate root dataset entity (@id: "./") was not found.');
        }

        const title = this.firstMeaningfulString(root.title, root.name);
        const authors = this.extractAuthors(root, graph);
        const contactEmails = this.extractContactEmails(root, graph);
        const descriptions = this.extractDescriptions(root, graph);
        const subjects = this.readStrings(root.subject);
        const missing: string[] = [];

        if (!title) missing.push('Title');
        if (!authors.length) missing.push('Author Name');
        if (!contactEmails.length) missing.push('Point of Contact Email');
        if (!descriptions.length) missing.push('Description Text');
        if (!subjects.length) missing.push('Subject');

        if (missing.length) {
            throw new Error(`Cannot create Dataverse dataset. Missing required RO-Crate metadata: ${missing.join(', ')}.`);
        }

        const fields: DataverseMetadataField[] = [
            this.primitiveField('title', false, title as string),
            this.compoundField('author', authors.map(authorName => ({
                authorName: this.primitiveField('authorName', false, authorName)
            }))),
            this.compoundField('datasetContact', contactEmails.map(datasetContactEmail => ({
                datasetContactEmail: this.primitiveField('datasetContactEmail', false, datasetContactEmail)
            }))),
            this.compoundField('dsDescription', descriptions.map(dsDescriptionValue => ({
                dsDescriptionValue: this.primitiveField('dsDescriptionValue', false, dsDescriptionValue)
            }))),
            {
                typeName: 'subject',
                typeClass: 'controlledVocabulary',
                multiple: true,
                value: subjects
            }
        ];

        return {
            metadataLanguage,
            datasetVersion: {
                metadataBlocks: {
                    citation: {
                        displayName: 'Citation Metadata',
                        fields
                    }
                }
            }
        };
    }

    protected async getAllowedMetadataLanguages(baseUrl: string, collectionId: string, apiKey: string | undefined): Promise<string[]> {
        const requestUrl = `${baseUrl}/api/v1/dataverses/${encodeURIComponent(collectionId)}/allowedMetadataLanguages`;
        const headers: Record<string, string> = { accept: 'application/json' };
        if (apiKey) {
            headers['x-dataverse-key'] = apiKey;
        }
        const response = await fetch(requestUrl, { headers });
        const payload = await this.readResponsePayload(response);
        if (!response.ok || payload.status === 'ERROR') {
            throw new Error(`Failed to retrieve allowed Dataverse metadata languages (${response.status}): ${this.payloadSummary(payload)}`);
        }
        const data = payload.data;
        if (!Array.isArray(data)) {
            return [];
        }
        return this.uniqueStrings(data.flatMap(item => {
            if (typeof item === 'string') {
                return [item];
            }
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                return [];
            }
            const record = item as Record<string, unknown>;
            return this.readStrings(record.locale ?? record.value ?? record.langCode ?? record.code);
        }));
    }

    protected async uploadRoCrateFiles(
        baseUrl: string,
        apiKey: string | undefined,
        persistentId: string,
        crate: RoCrate,
        rootUri: URI
    ): Promise<NativeDataverseFileUploadResult[]> {
        const uploadCrate = JSON.parse(JSON.stringify(crate)) as RoCrate;
        const externalFiles = new Map<string, URI>();
        const localizedReferences = await localizeExternalRoCrateFileReferences(uploadCrate, {
            existingEntryPaths: collectRoCrateExportFileReferences(uploadCrate).map(reference => reference.entryPath),
            resolveLocalSource: async sources => {
                const resolved = await this.resolveFirstReadableFileSource(rootUri, sources.filter(source => source.kind === 'local'));
                return resolved ? { source: resolved.source, value: resolved.uri } : undefined;
            }
        });
        for (const reference of localizedReferences) {
            externalFiles.set(reference.importedPath, reference.resolvedSource);
        }

        const uploadFiles = new Map<string, NativeDataverseUploadFile>();
        uploadFiles.set('ro-crate-metadata.json', {
            entryPath: 'ro-crate-metadata.json',
            content: new TextEncoder().encode(`${JSON.stringify(uploadCrate, null, 2)}\n`)
        });

        for (const reference of collectRoCrateExportFileReferences(uploadCrate)) {
            const externalUri = externalFiles.get(reference.entryPath);
            const resolved = externalUri
                ? { uri: externalUri }
                : await this.resolveFirstReadableFileSource(rootUri, reference.sources);
            if (!resolved) {
                console.warn('Skipping unresolved RO-Crate file reference during native Dataverse export:', reference.entityId);
                continue;
            }
            const content = await this.fileService.readFile(resolved.uri);
            uploadFiles.set(reference.entryPath, {
                entryPath: reference.entryPath,
                content: content.value.buffer
            });
        }
        await this.addReferencedDirectoryFiles(uploadCrate, rootUri, uploadFiles);

        const results: NativeDataverseFileUploadResult[] = [];
        for (const file of Array.from(uploadFiles.values()).sort((a, b) => a.entryPath.localeCompare(b.entryPath))) {
            results.push(await this.uploadFile(baseUrl, apiKey, persistentId, file));
        }
        return results;
    }

    protected async addReferencedDirectoryFiles(
        crate: RoCrate,
        rootUri: URI,
        uploadFiles: Map<string, NativeDataverseUploadFile>
    ): Promise<void> {
        for (const entity of this.readGraph(crate)) {
            if (!this.entityTypes(entity).includes('Dataset')) {
                continue;
            }
            const id = this.readStrings(entity['@id'])[0] ?? '';
            const relativePath = this.localCratePathFromEntityId(id);
            if (!relativePath || relativePath === 'ro-crate-metadata.json') {
                continue;
            }
            const uri = rootUri.resolve(relativePath);
            if (!(await this.fileService.exists(uri))) {
                continue;
            }
            const stat = await this.fileService.resolve(uri);
            if (stat.isDirectory) {
                await this.addDirectoryFiles(rootUri, uri, uploadFiles);
            }
        }
    }

    protected async addDirectoryFiles(
        rootUri: URI,
        directoryUri: URI,
        uploadFiles: Map<string, NativeDataverseUploadFile>
    ): Promise<void> {
        const stat = await this.fileService.resolve(directoryUri);
        for (const child of stat.children ?? []) {
            if (child.isDirectory) {
                await this.addDirectoryFiles(rootUri, child.resource, uploadFiles);
                continue;
            }
            const entryPath = this.toRelativePath(rootUri, child.resource);
            if (!entryPath || entryPath === 'ro-crate-metadata.json' || uploadFiles.has(entryPath)) {
                continue;
            }
            const content = await this.fileService.readFile(child.resource);
            uploadFiles.set(entryPath, {
                entryPath,
                content: content.value.buffer
            });
        }
    }

    protected async uploadFile(
        baseUrl: string,
        apiKey: string | undefined,
        persistentId: string,
        file: NativeDataverseUploadFile
    ): Promise<NativeDataverseFileUploadResult> {
        const { dir, base } = this.parsePosixPath(file.entryPath);
        const requestUrl = `${baseUrl}/api/v1/datasets/:persistentId/add?persistentId=${encodeURIComponent(persistentId)}`;
        const jsonData = {
            ...(dir ? { directoryLabel: dir } : {})
        };
        const form = new FormData();
        form.append('file', new Blob([file.content]), base);
        form.append('jsonData', JSON.stringify(jsonData));
        const headers: Record<string, string> = { accept: 'application/json' };
        if (apiKey) {
            headers['x-dataverse-key'] = apiKey;
        }

        const response = await fetch(requestUrl, {
            method: 'POST',
            headers,
            body: form
        });
        const payload = await this.readResponsePayload(response);
        if (!response.ok || payload.status === 'ERROR') {
            throw new Error(`Dataverse file upload failed for '${file.entryPath}' (${response.status}): ${this.payloadSummary(payload)}`);
        }
        return {
            entryPath: file.entryPath,
            directoryLabel: dir || undefined,
            fileName: base,
            response: payload
        };
    }

    protected async resolveFirstReadableFileSource(
        rootUri: URI,
        sources: readonly RoCrateExportFileSource[]
    ): Promise<{ uri: URI; source: RoCrateExportFileSource } | undefined> {
        for (const source of sources) {
            const uri = source.kind === 'local' ? this.toLocalFileUri(source.value) : rootUri.resolve(source.value);
            if (!uri) {
                continue;
            }
            try {
                if (!(await this.fileService.exists(uri))) {
                    continue;
                }
                const stat = await this.fileService.resolve(uri);
                if (!stat.isDirectory) {
                    return { uri, source };
                }
            } catch (error) {
                console.warn('Failed to resolve RO-Crate file reference:', source.value, error);
            }
        }
        return undefined;
    }

    protected toLocalFileUri(value: string): URI | undefined {
        const trimmed = value.trim();
        if (!trimmed) {
            return undefined;
        }
        if (/^file:\/\//i.test(trimmed)) {
            return new URI(trimmed);
        }
        if (/^[a-zA-Z]:[\\/]/.test(trimmed) || /^[/\\]{2}[^/\\]/.test(trimmed) || /^\/[^/]/.test(trimmed)) {
            return new URI(FileUri.create(trimmed).toString());
        }
        return undefined;
    }

    protected entityTypes(entity: RoCrateEntity): string[] {
        return this.readStrings(entity['@type']);
    }

    protected localCratePathFromEntityId(id: string): string | undefined {
        if (!id || id === './' || id.startsWith('#')) {
            return undefined;
        }
        let relativePath = id;
        if (id.startsWith('file://./')) {
            relativePath = id.slice('file://./'.length);
        } else if (id.startsWith('./')) {
            relativePath = id.slice(2);
        } else if (id.includes(':')) {
            return undefined;
        }
        const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
        return normalized && !normalized.split('/').includes('..') ? normalized : undefined;
    }

    protected toRelativePath(rootUri: URI, resourceUri: URI): string | undefined {
        const relativePath = rootUri.relative(resourceUri);
        return relativePath ? relativePath.toString().replace(/\\/g, '/').replace(/^\/+/, '') : undefined;
    }

    protected parsePosixPath(value: string): { dir: string; base: string } {
        const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
        const index = normalized.lastIndexOf('/');
        return index === -1
            ? { dir: '', base: normalized }
            : { dir: normalized.slice(0, index), base: normalized.slice(index + 1) };
    }

    protected validateMetadataLanguage(metadataLanguage: string, allowedMetadataLanguages: string[]): void {
        if (!metadataLanguage) {
            throw new Error('Dataset language is required.');
        }
        if (allowedMetadataLanguages.length && !allowedMetadataLanguages.some(allowed => allowed.toLowerCase() === metadataLanguage.toLowerCase())) {
            throw new Error(`Dataset language '${metadataLanguage}' is not allowed in the selected Dataverse collection.`);
        }
    }

    protected extractAuthors(root: RoCrateEntity, graph: RoCrateEntity[]): string[] {
        return this.resolveEntities(root.author, graph)
            .flatMap(author => this.readStrings(author.authorName ?? author.name))
            .concat(this.readStrings(root.author).filter(value => !this.looksLikeEntityId(value)));
    }

    protected extractContactEmails(root: RoCrateEntity, graph: RoCrateEntity[]): string[] {
        const linkedContacts = this.resolveEntities(root.datasetContact ?? root.contactPoint, graph);
        return this.uniqueStrings([
            ...linkedContacts.flatMap(contact => this.readStrings(contact.datasetContactEmail ?? contact.email)),
            ...this.readStrings(root.datasetContactEmail)
        ]);
    }

    protected extractDescriptions(root: RoCrateEntity, graph: RoCrateEntity[]): string[] {
        const linkedDescriptions = this.resolveEntities(root.dsDescription, graph);
        return this.uniqueStrings([
            ...linkedDescriptions.flatMap(description => this.readStrings(description.dsDescriptionValue ?? description.description ?? description.name)),
            ...this.readStrings(root.description)
        ]);
    }

    protected resolveEntities(value: unknown, graph: RoCrateEntity[]): RoCrateEntity[] {
        if (Array.isArray(value)) {
            return value.flatMap(item => this.resolveEntities(item, graph));
        }
        if (value && typeof value === 'object') {
            const entity = value as RoCrateEntity;
            const linkedEntity = this.readStrings(entity['@id'])
                .map(id => graph.find(graphEntity => graphEntity['@id'] === id))
                .find((graphEntity): graphEntity is RoCrateEntity => !!graphEntity);
            return linkedEntity ? [linkedEntity] : [entity];
        }
        return [];
    }

    protected readGraph(crate: RoCrate): RoCrateEntity[] {
        const graph = crate['@graph'];
        return Array.isArray(graph)
            ? graph.filter((entity): entity is RoCrateEntity => !!entity && typeof entity === 'object' && !Array.isArray(entity))
            : [];
    }

    protected primitiveField(typeName: string, multiple: boolean, value: string): DataverseMetadataField {
        return { typeName, typeClass: 'primitive', multiple, value };
    }

    protected compoundField(typeName: string, values: Array<Record<string, DataverseMetadataField>>): DataverseMetadataField {
        return {
            typeName,
            typeClass: 'compound',
            multiple: true,
            value: values
        };
    }

    protected firstMeaningfulString(...values: unknown[]): string | undefined {
        return values
            .flatMap(value => this.readStrings(value))
            .find(value => value !== './' && value !== '.');
    }

    protected readStrings(value: unknown): string[] {
        if (typeof value === 'string') {
            return value.trim() ? [value.trim()] : [];
        }
        if (Array.isArray(value)) {
            return this.uniqueStrings(value.flatMap(item => this.readStrings(item)));
        }
        return [];
    }

    protected uniqueStrings(values: string[]): string[] {
        return Array.from(new Set(values.filter(value => value.trim() !== '')));
    }

    protected looksLikeEntityId(value: string): boolean {
        return value.startsWith('#') || value.startsWith('./') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
    }

    protected normalizeBaseUrl(baseUrl: string): string {
        const normalized = baseUrl.trim().replace(/\/+$/, '');
        if (!normalized) {
            throw new Error('Repository base URL is empty.');
        }
        return normalized.endsWith('/api/v1') ? normalized.slice(0, -'/api/v1'.length) : normalized;
    }

    protected async readResponsePayload(response: Response): Promise<NativeDataverseResponse> {
        const text = await response.text();
        if (!text) {
            return {};
        }
        try {
            return JSON.parse(text) as NativeDataverseResponse;
        } catch {
            return { message: text };
        }
    }

    protected payloadSummary(payload: NativeDataverseResponse): string {
        return payload.message || JSON.stringify(payload).slice(0, 500);
    }
}

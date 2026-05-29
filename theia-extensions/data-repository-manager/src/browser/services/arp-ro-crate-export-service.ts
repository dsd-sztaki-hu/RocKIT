import JSZip = require('jszip');
import { inject, injectable } from 'inversify';
import { URI } from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { localizeExternalRoCrateFileReferences, RoCrateExportFileSource } from 'aroma2-common/lib/common/ro-crate-export-file-references';
import { DataRepositoryConfig, DataverseCollection } from '../types';

type RoCrateEntity = Record<string, any>;
type RoCrate = Record<string, any>;

export interface ArpRoCrateExportResult {
    pid?: string;
    dataverseUrl?: string;
    requestUrl: string;
    response: unknown;
    ingestedCrate?: RoCrate;
}

const DATAVERSE_FILE_CONTEXT: Record<string, string> = {
    contentSize: 'https://schema.org/contentSize',
    dateModified: 'https://schema.org/dateModified',
    description: 'https://schema.org/description',
    directoryLabel: 'https://dataverse.org/schema/file/directoryLabel',
    encodingFormat: 'https://schema.org/encodingFormat',
    hash: 'https://dataverse.org/schema/file/hash',
    url: 'https://schema.org/url'
};

@injectable()
export class ArpRoCrateExportService {

    constructor(
        @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
        @inject(FileService) protected readonly fileService: FileService
    ) { }

    public async exportToArp(repository: DataRepositoryConfig, collection: DataverseCollection): Promise<ArpRoCrateExportResult> {
        const baseUrl = this.normalizeBaseUrl(repository.baseUrl);
        const rootUri = this.getWorkspaceRoot();
        const metadataUri = rootUri.resolve('ro-crate-metadata.json');
        const crate = await this.readRoCrate(metadataUri);

        const crateArpPid = this.extractArpPid(crate);
        if (crateArpPid) {
            throw new Error(`This RO-Crate already contains @arpPid (${crateArpPid}). Update/sync is not implemented yet.`);
        }

        const uploadCrate = await this.buildDataverseUploadCrate(crate, rootUri);
        const externalFileEntries = await this.localizeExternalLocalFileReferences(uploadCrate, rootUri);
        await this.validateRoCrate(uploadCrate, baseUrl, repository.apiKey);

        const zip = await this.buildDataverseUploadZip(uploadCrate, rootUri, externalFileEntries);
        await this.saveDebugUploadZip(rootUri, zip);
        const uploadUrl = new URL('/api/arp/uploadRoCrateZip', `${baseUrl}/`);
        uploadUrl.searchParams.set('ownerId', collection.alias || collection.id);

        const form = new FormData();
        form.append('file', new Blob([zip], { type: 'application/zip' }), 'rocrate.zip');

        const headers: Record<string, string> = { accept: 'application/json' };
        if (repository.apiKey) {
            headers['x-dataverse-key'] = repository.apiKey;
        }

        const response = await this.fetchWithTimeout(uploadUrl.toString(), {
            method: 'POST',
            headers,
            body: form
        });
        const payload = await this.readResponsePayload(response);
        if (!response.ok) {
            throw new Error(`ARP upload failed (${response.status}) at ${response.url || uploadUrl.toString()}: ${this.payloadSummary(payload)}`);
        }

        const ingestedCrate = this.extractDataverseCrate(payload);
        const payloadPid = this.extractPayloadPid(payload);
        const pid = (ingestedCrate ? this.extractArpPid(ingestedCrate) : undefined) || payloadPid;

        return {
            pid,
            dataverseUrl: this.buildDataverseDatasetUrl(baseUrl, pid),
            requestUrl: response.url || uploadUrl.toString(),
            response: payload,
            ingestedCrate
        };
    }

    protected getWorkspaceRoot(): URI {
        const roots = this.workspaceService.tryGetRoots();
        const root = roots?.[0]?.resource;
        if (!root) {
            throw new Error('No workspace is open.');
        }
        return root;
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

    protected async buildDataverseUploadCrate(crate: RoCrate, rootUri: URI): Promise<RoCrate> {
        const uploadCrate = JSON.parse(JSON.stringify(crate)) as RoCrate;
        const graph = Array.isArray(uploadCrate['@graph']) ? uploadCrate['@graph'] : [];
        let enrichedFileCount = 0;

        for (const entity of graph) {
            if (!entity || typeof entity !== 'object' || Array.isArray(entity) || !this.entityTypes(entity).includes('File')) {
                continue;
            }
            const relativePath = this.dataverseFilePathFromEntity(entity);
            if (!relativePath) {
                continue;
            }
            const fileUri = rootUri.resolve(relativePath);
            if (!this.isInsideRoot(rootUri, fileUri) || !(await this.fileService.exists(fileUri))) {
                continue;
            }
            const stat = await this.fileService.resolve(fileUri);
            if (stat.isDirectory) {
                continue;
            }
            const content = await this.fileService.readFile(fileUri);
            const parsed = this.parsePosixPath(relativePath);
            entity.name = this.readOptionalEntityString(entity, 'name') ?? parsed.base;
            entity.hash = this.readOptionalEntityString(entity, 'hash') ?? this.md5(content.value.buffer);
            entity.contentSize = this.readOptionalEntityString(entity, 'contentSize') ?? String(content.value.buffer.byteLength);
            entity.encodingFormat = this.readOptionalEntityString(entity, 'encodingFormat') ?? this.mimeTypeFromFilename(relativePath);
            if (!this.readOptionalEntityString(entity, 'directoryLabel') && parsed.dir) {
                entity.directoryLabel = parsed.dir;
            }
            enrichedFileCount += 1;
        }

        this.ensureDataverseFileContext(uploadCrate);
        return uploadCrate;
    }

    protected async buildDataverseUploadZip(crate: RoCrate, rootUri: URI, externalFileEntries = new Map<string, URI>()): Promise<Uint8Array> {
        const zip = new JSZip();
        zip.file('ro-crate-metadata.json', `${JSON.stringify(crate, null, 2)}\n`);

        const fileEntries = new Map(externalFileEntries);
        for (const relativePath of this.extractCrateFilePaths(crate)) {
            if (relativePath === 'ro-crate-metadata.json' || fileEntries.has(relativePath)) {
                continue;
            }
            const uri = rootUri.resolve(relativePath);
            if (!this.isInsideRoot(rootUri, uri)) {
                throw new Error(`Refusing to include path outside crate root: ${relativePath}`);
            }
            if (!(await this.fileService.exists(uri))) {
                throw new Error(`Referenced file not found for ZIP upload: ${relativePath}`);
            }
            const stat = await this.fileService.resolve(uri);
            if (stat.isDirectory) {
                await this.walkDirectoryFiles(rootUri, relativePath, fileEntries);
            } else {
                fileEntries.set(relativePath, uri);
            }
        }

        for (const [name, uri] of Array.from(fileEntries.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
            const content = await this.fileService.readFile(uri);
            zip.file(name, content.value.buffer);
        }

        return zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
    }

    protected async saveDebugUploadZip(rootUri: URI, zip: Uint8Array): Promise<void> {
        const debugZipUri = rootUri.resolve('arp-upload-debug.zip');
        await this.fileService.writeFile(debugZipUri, BinaryBuffer.wrap(zip));
    }

    protected async localizeExternalLocalFileReferences(crate: RoCrate, rootUri: URI): Promise<Map<string, URI>> {
        const externalFileEntries = new Map<string, URI>();
        const localizedReferences = await localizeExternalRoCrateFileReferences(crate, {
            existingEntryPaths: this.extractCrateFilePaths(crate),
            resolveLocalSource: async sources => {
                const resolved = await this.resolveFirstReadableLocalSource(sources);
                return resolved ? { source: resolved.source, value: resolved.uri } : undefined;
            }
        });

        for (const reference of localizedReferences) {
            externalFileEntries.set(reference.importedPath, reference.resolvedSource);
        }

        return externalFileEntries;
    }

    protected async resolveFirstReadableLocalSource(sources: readonly RoCrateExportFileSource[]): Promise<{ uri: URI; source: RoCrateExportFileSource } | undefined> {
        for (const source of sources) {
            const uri = this.toLocalFileUri(source.value);
            if (!uri) {
                continue;
            }
            try {
                if (!(await this.fileService.exists(uri))) {
                    continue;
                }
                const stat = await this.fileService.resolve(uri);
                if (stat.isDirectory) {
                    continue;
                }
                return { uri, source };
            } catch (error) {
                console.warn('Failed to resolve external RO-Crate file reference', source.value, error);
            }
        }
        return undefined;
    }

    protected async walkDirectoryFiles(rootUri: URI, relativePath: string, entries: Map<string, URI>): Promise<void> {
        const directoryUri = rootUri.resolve(relativePath);
        const stat = await this.fileService.resolve(directoryUri);
        for (const child of stat.children ?? []) {
            const childRelativePath = this.toRelativePath(rootUri, child.resource);
            if (!childRelativePath) {
                continue;
            }
            if (child.isDirectory) {
                await this.walkDirectoryFiles(rootUri, childRelativePath, entries);
            } else {
                entries.set(childRelativePath, child.resource);
            }
        }
    }

    protected async validateRoCrate(crate: RoCrate, baseUrl: string, apiKey: string | undefined): Promise<void> {
        const validateUrl = new URL('/api/arp/validateRoCrate', `${baseUrl}/`);
        validateUrl.searchParams.set('strict', 'true');
        const headers: Record<string, string> = {
            accept: 'application/json',
            'content-type': 'application/json'
        };
        if (apiKey) {
            headers['x-dataverse-key'] = apiKey;
        }

        const response = await this.fetchWithTimeout(validateUrl.toString(), {
            method: 'POST',
            headers,
            body: JSON.stringify(crate)
        });
        const payload = await this.readResponsePayload(response);
        const messages = this.extractDataverseValidationMessages(payload);
        if (!response.ok || messages.length > 0) {
            const issuesPreview = messages.slice(0, 10).join(' | ');
            throw new Error(`Upload blocked by ARP validation (${response.status}) at ${response.url || validateUrl.toString()}${issuesPreview ? `: ${issuesPreview}` : ''}`);
        }
    }

    protected async fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 120000): Promise<Response> {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, {
                ...init,
                redirect: 'follow',
                signal: controller.signal
            });
        } finally {
            window.clearTimeout(timeout);
        }
    }

    protected async readResponsePayload(response: Response): Promise<unknown> {
        const text = await response.text();
        if (!text) {
            return {};
        }
        try {
            return JSON.parse(text) as unknown;
        } catch {
            return text;
        }
    }

    protected extractDataverseCrate(payload: unknown): RoCrate | undefined {
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            const record = payload as Record<string, unknown>;
            if (Array.isArray(record['@graph'])) {
                return record as RoCrate;
            }
            const data = record.data;
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                const dataRecord = data as Record<string, unknown>;
                if (Array.isArray(dataRecord['@graph'])) {
                    return data as RoCrate;
                }
                const roCrate = dataRecord.roCrate;
                if (roCrate && typeof roCrate === 'object' && !Array.isArray(roCrate) && Array.isArray((roCrate as Record<string, unknown>)['@graph'])) {
                    return roCrate as RoCrate;
                }
            }
        }
        return undefined;
    }

    protected extractPayloadPid(payload: unknown): string | undefined {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return undefined;
        }
        const record = payload as Record<string, unknown>;
        for (const key of ['persistentId', 'pid', 'global_id', 'globalId']) {
            const value = record[key];
            if (typeof value === 'string' && value.trim() !== '') {
                return value.trim();
            }
        }
        const data = record.data;
        return data && typeof data === 'object' && !Array.isArray(data) ? this.extractPayloadPid(data) : undefined;
    }

    protected extractArpPid(crate: RoCrate): string | undefined {
        const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : [];
        const root = graph.find(entity => entity && typeof entity === 'object' && !Array.isArray(entity) && entity['@id'] === './');
        if (!root || typeof root !== 'object' || Array.isArray(root)) {
            return undefined;
        }
        const pid = root['@arpPid'];
        return typeof pid === 'string' && pid.trim() !== '' ? pid.trim() : undefined;
    }

    protected extractCrateFilePaths(crate: RoCrate): string[] {
        const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : [];
        const files = new Set<string>();
        for (const entity of graph) {
            if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
                continue;
            }
            const id = typeof entity['@id'] === 'string' ? entity['@id'] : '';
            const localPath = this.dataverseFilePathFromEntity(entity) ?? this.localCratePathFromEntityId(id);
            if (localPath) {
                files.add(localPath);
            }
        }
        return Array.from(files).sort((a, b) => a.localeCompare(b));
    }

    protected dataverseFilePathFromEntity(entity: RoCrateEntity): string | undefined {
        if (!this.entityTypes(entity).includes('File')) {
            return undefined;
        }
        const localIdPath = this.localCratePathFromEntityId(typeof entity['@id'] === 'string' ? entity['@id'] : '');
        if (localIdPath) {
            return localIdPath;
        }
        const name = this.readOptionalEntityString(entity, 'name');
        if (!name || name.includes('/') || name.includes('\\')) {
            return undefined;
        }
        const directoryLabel = this.readOptionalEntityString(entity, 'directoryLabel');
        const relativePath = directoryLabel ? `${directoryLabel.replace(/\\/g, '/').replace(/\/+$/, '')}/${name}` : name;
        return this.isSafeRelativePath(relativePath) ? relativePath : undefined;
    }

    protected localCratePathFromEntityId(id: string): string | undefined {
        if (id === '' || id === './' || id.startsWith('#')) {
            return undefined;
        }
        let rel = id;
        if (id.startsWith('file://./')) {
            rel = id.slice('file://./'.length);
        } else if (id.startsWith('./')) {
            rel = id.slice(2);
        } else if (id.includes(':')) {
            return undefined;
        }
        return this.isSafeRelativePath(rel) ? rel.replace(/\\/g, '/') : undefined;
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

    protected ensureDataverseFileContext(crate: RoCrate): void {
        const context = crate['@context'];
        if (Array.isArray(context)) {
            const existingObject = context.find((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item));
            if (existingObject) {
                Object.assign(existingObject, DATAVERSE_FILE_CONTEXT);
            } else {
                context.push({ ...DATAVERSE_FILE_CONTEXT });
            }
            return;
        }
        if (context && typeof context === 'object' && !Array.isArray(context)) {
            Object.assign(context as Record<string, unknown>, DATAVERSE_FILE_CONTEXT);
            return;
        }
        crate['@context'] = context ? [context, { ...DATAVERSE_FILE_CONTEXT }] : ['https://w3id.org/ro/crate/1.1/context', { ...DATAVERSE_FILE_CONTEXT }];
    }

    protected extractDataverseValidationMessages(payload: unknown): string[] {
        const messages: string[] = [];
        const collectIssues = (report: Record<string, unknown>): void => {
            const errors = Array.isArray(report.errors) ? report.errors : [];
            for (const entry of errors) {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                    continue;
                }
                const entryRecord = entry as Record<string, unknown>;
                const errorEntity = typeof entryRecord.errorEntity === 'string' ? entryRecord.errorEntity : 'RO-Crate';
                const nested = Array.isArray(entryRecord.errors) ? entryRecord.errors : [];
                for (const nestedIssue of nested) {
                    if (!nestedIssue || typeof nestedIssue !== 'object' || Array.isArray(nestedIssue)) {
                        continue;
                    }
                    const nestedRecord = nestedIssue as Record<string, unknown>;
                    const errorField = typeof nestedRecord.errorField === 'string' ? nestedRecord.errorField : '';
                    const errorMessage = typeof nestedRecord.errorMessage === 'string' ? nestedRecord.errorMessage : '';
                    const errorSuggestion = typeof nestedRecord.errorSuggestion === 'string' ? nestedRecord.errorSuggestion : '';
                    const prefix = `${errorEntity}${errorField ? `.${errorField}` : ''}`;
                    const body = [errorMessage, errorSuggestion].filter(part => part !== '').join(' ');
                    messages.push(`${prefix}: ${body}`.trim());
                }
            }
        };

        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            const record = payload as Record<string, unknown>;
            const details = record.details;
            if (details && typeof details === 'object' && !Array.isArray(details)) {
                collectIssues(details as Record<string, unknown>);
            } else if (typeof details === 'string') {
                const parsedDetails = this.tryParseJsonObjectFromString(details);
                if (parsedDetails) {
                    collectIssues(parsedDetails);
                }
            }

            const message = record.message;
            if (typeof message === 'string') {
                const parsedMessage = this.tryParseJsonObjectFromString(message);
                if (parsedMessage) {
                    collectIssues(parsedMessage);
                }
            } else if (message && typeof message === 'object' && !Array.isArray(message)) {
                collectIssues(message as Record<string, unknown>);
            }
        }

        return Array.from(new Set(messages.filter(item => item.trim() !== '')));
    }

    protected tryParseJsonObjectFromString(value: string): Record<string, unknown> | undefined {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
        } catch {
            return undefined;
        }
    }

    protected entityTypes(entity: RoCrateEntity): string[] {
        const raw = entity['@type'];
        if (typeof raw === 'string') {
            return [raw];
        }
        return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
    }

    protected isSafeRelativePath(value: string): boolean {
        if (value === '' || value.includes('\0')) {
            return false;
        }
        const normalized = value.replace(/\\/g, '/');
        return !normalized.startsWith('/') && !/^[a-zA-Z]:\//.test(normalized) && !normalized.startsWith('../') && !normalized.includes('/../') && normalized !== '..';
    }

    protected isInsideRoot(rootUri: URI, resourceUri: URI): boolean {
        return rootUri.isEqualOrParent(resourceUri);
    }

    protected toRelativePath(rootUri: URI, resourceUri: URI): string | undefined {
        const relative = rootUri.relative(resourceUri);
        return relative ? relative.toString().replace(/\\/g, '/').replace(/^\/+/, '') : undefined;
    }

    protected normalizeBaseUrl(baseUrl: string): string {
        const normalized = baseUrl.trim().replace(/\/+$/, '');
        if (!normalized) {
            throw new Error('Repository base URL is empty.');
        }
        return normalized;
    }

    protected buildDataverseDatasetUrl(baseUrl: string, pid?: string): string | undefined {
        return pid ? `${baseUrl}/dataset.xhtml?persistentId=${encodeURIComponent(pid)}` : undefined;
    }

    protected payloadSummary(payload: unknown): string {
        if (typeof payload === 'string') {
            return payload.slice(0, 500);
        }
        if (payload && typeof payload === 'object') {
            const record = payload as Record<string, unknown>;
            const message = record.message ?? record.error ?? record.details;
            if (typeof message === 'string') {
                return message.slice(0, 500);
            }
        }
        return JSON.stringify(payload).slice(0, 500);
    }

    protected readOptionalEntityString(entity: RoCrateEntity, key: string): string | undefined {
        const value = entity[key];
        return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
    }

    protected parsePosixPath(value: string): { dir: string; base: string } {
        const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
        const index = normalized.lastIndexOf('/');
        return index === -1
            ? { dir: '', base: normalized }
            : { dir: normalized.slice(0, index), base: normalized.slice(index + 1) };
    }

    protected mimeTypeFromFilename(filename: string): string {
        const lower = filename.toLowerCase();
        if (lower.endsWith('.json')) return 'application/json';
        if (lower.endsWith('.csv')) return 'text/csv';
        if (lower.endsWith('.tsv')) return 'text/tab-separated-values';
        if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain';
        if (lower.endsWith('.png')) return 'image/png';
        if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
        if (lower.endsWith('.gif')) return 'image/gif';
        if (lower.endsWith('.pdf')) return 'application/pdf';
        if (lower.endsWith('.zip')) return 'application/zip';
        return 'application/octet-stream';
    }

    protected md5(input: Uint8Array): string {
        const bytes = Array.from(input);
        const originalBitLength = bytes.length * 8;
        bytes.push(0x80);
        while (bytes.length % 64 !== 56) {
            bytes.push(0);
        }
        for (let i = 0; i < 8; i++) {
            bytes.push((originalBitLength >>> (8 * i)) & 0xff);
        }

        let a0 = 0x67452301;
        let b0 = 0xefcdab89;
        let c0 = 0x98badcfe;
        let d0 = 0x10325476;
        const shifts = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
        const constants = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

        for (let offset = 0; offset < bytes.length; offset += 64) {
            const words = new Array<number>(16);
            for (let i = 0; i < 16; i++) {
                const j = offset + i * 4;
                words[i] = (bytes[j] | (bytes[j + 1] << 8) | (bytes[j + 2] << 16) | (bytes[j + 3] << 24)) >>> 0;
            }
            let a = a0;
            let b = b0;
            let c = c0;
            let d = d0;
            for (let i = 0; i < 64; i++) {
                let f: number;
                let g: number;
                if (i < 16) {
                    f = (b & c) | (~b & d);
                    g = i;
                } else if (i < 32) {
                    f = (d & b) | (~d & c);
                    g = (5 * i + 1) % 16;
                } else if (i < 48) {
                    f = b ^ c ^ d;
                    g = (3 * i + 5) % 16;
                } else {
                    f = c ^ (b | ~d);
                    g = (7 * i) % 16;
                }
                const sum = (a + f + constants[i] + words[g]) >>> 0;
                a = d;
                d = c;
                c = b;
                b = (b + this.leftRotate(sum, shifts[i])) >>> 0;
            }
            a0 = (a0 + a) >>> 0;
            b0 = (b0 + b) >>> 0;
            c0 = (c0 + c) >>> 0;
            d0 = (d0 + d) >>> 0;
        }

        return [a0, b0, c0, d0].map(word => this.toLittleEndianHex(word)).join('');
    }

    protected leftRotate(value: number, amount: number): number {
        return ((value << amount) | (value >>> (32 - amount))) >>> 0;
    }

    protected toLittleEndianHex(word: number): string {
        return [0, 8, 16, 24].map(shift => ((word >>> shift) & 0xff).toString(16).padStart(2, '0')).join('');
    }
}

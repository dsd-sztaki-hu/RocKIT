import { injectable, inject } from 'inversify';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { URI } from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { DataRepositoryConfig } from '../types';

@injectable()
export class DataverseMetadataBlockCacheService {
    constructor(
        @inject(EnvVariablesServer) protected readonly envVariablesServer: EnvVariablesServer,
        @inject(FileService) protected readonly fileService: FileService
    ) { }

    public async loadTargetMetadataBlocks(repository: DataRepositoryConfig): Promise<string[]> {
        const baseUrl = this.normalizeDataverseBaseUrl(repository.baseUrl);
        const blocks = await this.fetchDataverseMetadataBlocks(baseUrl, repository);
        const saved: string[] = [];

        for (const block of blocks) {
            const blockName = this.readMetadataBlockName(block);
            if (!blockName) {
                continue;
            }
            const target = await this.getDataverseMetadataBlockUri(blockName);
            if (!await this.fileService.exists(target.parent)) {
                await this.fileService.createFolder(target.parent);
            }
            await this.fileService.writeFile(target, BinaryBuffer.fromString(`${JSON.stringify(block, null, 2)}\n`));
            saved.push(blockName);
        }

        return saved;
    }

    protected async fetchDataverseMetadataBlocks(baseUrl: string, repository: DataRepositoryConfig): Promise<unknown[]> {
        const response = await fetch(`${baseUrl}/api/metadatablocks?returnDatasetFieldTypes=true`, {
            headers: this.buildDataverseHeaders(repository)
        });
        const text = await response.text();
        if (!response.ok) {
            throw new Error(`Dataverse returned ${response.status}: ${text || response.statusText}`);
        }

        const data = this.extractDataverseResponseData(JSON.parse(text));
        if (!Array.isArray(data)) {
            throw new Error('Dataverse metadata block response did not contain a data array.');
        }

        return data.filter(block => this.isTargetDataverseMetadataBlock(block));
    }

    protected buildDataverseHeaders(repository: DataRepositoryConfig): Record<string, string> {
        return {
            accept: 'application/json',
            ...(repository.apiKey ? { 'x-dataverse-key': repository.apiKey } : {})
        };
    }

    protected extractDataverseResponseData(response: unknown): unknown {
        if (response && typeof response === 'object' && 'data' in response) {
            return (response as { data: unknown }).data;
        }
        return response;
    }

    protected isTargetDataverseMetadataBlock(block: unknown): boolean {
        const name = this.readMetadataBlockName(block)?.toLowerCase();
        const displayName = this.readMetadataBlockDisplayName(block)?.toLowerCase();
        const targetNames = new Set([
            '3dobjects',
            'journal',
            'socialscience',
            'geospatial',
            'biomedical',
            'citation',
            'astrophysics'
        ]);
        const targetDisplayNames = new Set([
            '3d objects metadata',
            'journal metadata',
            'social science and humanities metadata',
            'geospatial metadata',
            'life sciences metadata',
            'citation metadata',
            'astronomy and astrophysics metadata'
        ]);
        return Boolean(
            (name && targetNames.has(name))
            || (displayName && targetDisplayNames.has(displayName))
        );
    }

    protected readMetadataBlockName(block: unknown): string | undefined {
        if (!block || typeof block !== 'object') {
            return undefined;
        }
        const record = block as Record<string, unknown>;
        return typeof record.name === 'string' ? record.name : undefined;
    }

    protected readMetadataBlockDisplayName(block: unknown): string | undefined {
        if (!block || typeof block !== 'object') {
            return undefined;
        }
        const record = block as Record<string, unknown>;
        return typeof record.displayName === 'string' ? record.displayName : undefined;
    }

    protected normalizeDataverseBaseUrl(baseUrl: string): string {
        return baseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '').replace(/\/api$/, '');
    }

    protected async getDataverseMetadataBlockUri(blockName: string): Promise<URI> {
        const rootPath = (await this.envVariablesServer.getValue('ROCKIT_ROOT_PATH'))?.value;
        if (!rootPath) {
            throw new Error('ROCKIT_ROOT_PATH is not configured.');
        }
        const normalizedRoot = rootPath.replace(/\\/g, '/');
        const root = normalizedRoot.match(/^[a-zA-Z]:/)
            ? new URI(`file:///${normalizedRoot}`)
            : new URI(`file://${normalizedRoot}`);
        return root.resolve(`metadata-schemas/dataverse/${blockName}.json`);
    }
}

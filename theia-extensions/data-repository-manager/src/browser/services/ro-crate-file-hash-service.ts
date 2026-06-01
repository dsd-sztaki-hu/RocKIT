import { FileUri } from '@theia/core/lib/common/file-uri';
import { URI } from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { inject, injectable } from 'inversify';
import * as SparkMD5 from 'spark-md5';
import { AppStateService } from 'app-state/lib/browser/state/app-state-service';
import { RoCrateHistoryService } from 'app-state/lib/browser/state/ro-crate-history-service';
import {
    collectRoCrateExportFileReferences,
    RoCrateExportFileSource
} from 'aroma2-common/lib/common/ro-crate-export-file-references';

type RoCrate = Record<string, any>;
type RoCrateEntity = Record<string, any>;

@injectable()
export class RoCrateFileHashService {

    constructor(
        @inject(AppStateService) protected readonly appStateService: AppStateService,
        @inject(RoCrateHistoryService) protected readonly historyService: RoCrateHistoryService,
        @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
        @inject(FileService) protected readonly fileService: FileService
    ) { }

    public async persistMissingFileHashes(): Promise<number> {
        const crate = this.appStateService.roCrate;
        if (!crate) {
            return 0;
        }
        const rootUri = this.getWorkspaceRoot();
        const updatedCrate = JSON.parse(JSON.stringify(crate)) as RoCrate;
        const entitiesById = this.indexEntitiesById(updatedCrate);
        let updatedCount = 0;

        for (const reference of collectRoCrateExportFileReferences(updatedCrate)) {
            const entity = entitiesById.get(reference.entityId);
            if (!entity || this.hasHash(entity)) {
                continue;
            }
            const fileUri = await this.resolveFirstReadableFileSource(rootUri, reference.sources);
            if (!fileUri) {
                continue;
            }
            const content = await this.fileService.read(fileUri);
            entity.hash = SparkMD5.hash(content.value);
            updatedCount += 1;
        }

        if (!updatedCount) {
            return 0;
        }

        this.historyService.applyRoCrateChange(updatedCrate, {
            label: 'Add missing file hashes before remote export'
        });
        await this.persistRoCrate(rootUri, updatedCrate);
        return updatedCount;
    }

    protected getWorkspaceRoot(): URI {
        const rootUri = this.workspaceService.tryGetRoots()?.[0]?.resource;
        if (!rootUri) {
            throw new Error('No workspace is open.');
        }
        return rootUri;
    }

    protected indexEntitiesById(crate: RoCrate): Map<string, RoCrateEntity> {
        const graph = Array.isArray(crate['@graph']) ? crate['@graph'] : [];
        return new Map(
            graph
                .filter((entity): entity is RoCrateEntity => !!entity && typeof entity === 'object' && !Array.isArray(entity) && typeof entity['@id'] === 'string')
                .map(entity => [entity['@id'], entity])
        );
    }

    protected hasHash(entity: RoCrateEntity): boolean {
        return typeof entity.hash === 'string' && entity.hash.trim() !== '';
    }

    protected async resolveFirstReadableFileSource(rootUri: URI, sources: readonly RoCrateExportFileSource[]): Promise<URI | undefined> {
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
                    return uri;
                }
            } catch (error) {
                console.warn('Failed to resolve file for pre-export hash calculation:', source.value, error);
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

    protected async persistRoCrate(rootUri: URI, crate: RoCrate): Promise<void> {
        const metadataUri = rootUri.resolve('ro-crate-metadata.json');
        await this.fileService.create(metadataUri, JSON.stringify(crate, null, 2), {
            overwrite: true
        });
        this.appStateService.setRoCrateSnapshot(crate);
        this.appStateService.dirty = false;
    }
}

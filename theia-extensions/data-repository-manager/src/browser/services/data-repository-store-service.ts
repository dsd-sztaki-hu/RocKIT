import { injectable, inject } from 'inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { URI } from '@theia/core/lib/common/uri';
import { DataRepositoryConfig } from '../types';

@injectable()
export class DataRepositoryStoreService {

    constructor(
        @inject(FileService) protected readonly fileService: FileService,
        @inject(EnvVariablesServer) protected readonly envVariablesServer: EnvVariablesServer
    ) {}

    protected async getConfigUri(): Promise<URI> {
        const rootPathEnv = await this.envVariablesServer.getValue('AROMA_ROOT_PATH');
        const rootPath = rootPathEnv?.value || ''; 
        const normalizedRoot = rootPath.replace(/\\/g, '/');
        const baseUri = normalizedRoot.match(/^[a-zA-Z]:/) 
            ? new URI('file:///' + normalizedRoot) 
            : new URI('file://' + normalizedRoot);

        return baseUri.resolve('data-repository-config.json');
    }

    public async loadRepositories(): Promise<DataRepositoryConfig[]> {
        try {
            const uri = await this.getConfigUri();
            if (await this.fileService.exists(uri)) {
                const content = await this.fileService.read(uri);
                return JSON.parse(content.value);
            }
        } catch (error) {
            console.error('Failed to read data repository config file:', error);
        }
        return [];
    }

    public async saveRepositories(repositories: DataRepositoryConfig[]): Promise<void> {
        try {
            const uri = await this.getConfigUri();
            const content = JSON.stringify(repositories, null, 4);
            
            if (!await this.fileService.exists(uri.parent)) {
                await this.fileService.createFolder(uri.parent);
            }
            await this.fileService.write(uri, content);
        } catch (error) {
            console.error('Failed to save data repository config file:', error);
            throw error;
        }
    }
}
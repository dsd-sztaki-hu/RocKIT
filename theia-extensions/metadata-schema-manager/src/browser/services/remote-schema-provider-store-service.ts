import { injectable, inject } from 'inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { URI } from '@theia/core/lib/common/uri';
import { RemoteSchemaProviderConfig } from '../types';
import { SchemaApi } from './schema-api';

@injectable()
export class RemoteSchemaProviderStoreService {

    @inject(FileService) protected readonly fileService!: FileService;
    @inject(EnvVariablesServer) protected readonly envVariablesServer!: EnvVariablesServer;

    private readonly CONFIG_FILE_NAME = 'remote-schema-providers.json';

    protected async getConfigFileUri(): Promise<URI | null> {
        const result = await this.envVariablesServer.getValue('AROMA_ROOT_PATH');
        if (!result?.value) return null;
        
        const normalized = result.value.replace(/\\/g, '/');
        const rootUri = normalized.match(/^[a-zA-Z]:/) ? new URI('file:///' + normalized) : new URI('file://' + normalized);
        
        return rootUri.resolve(this.CONFIG_FILE_NAME);
    }

    public async loadProviders(): Promise<RemoteSchemaProviderConfig[]> {
        try {
            const uri = await this.getConfigFileUri();
            if (!uri) return [];

            if (!await this.fileService.exists(uri)) {
                return [];
            }

            const content = await this.fileService.read(uri);
            const parsed = JSON.parse(content.value);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.error('Failed to load remote schema provider config:', error);
            return [];
        }
    }

    public async saveProviders(providers: RemoteSchemaProviderConfig[]): Promise<void> {
        try {
            const uri = await this.getConfigFileUri();
            if (!uri) throw new Error('Could not determine configuration path (AROMA_ROOT_PATH missing).');

            const content = JSON.stringify(providers, null, 2);
            await this.fileService.write(uri, content);
        } catch (error) {
            console.error('Failed to save remote schema provider config:', error);
            throw error;
        }
    }

    /**
     * Tests the connection and returns a list of available schema names if successful.
     * Throws an error if the connection fails.
     */
    public async testConnection(config: RemoteSchemaProviderConfig): Promise<string[]> {
        if (config.type !== 'CEDAR') {
            throw new Error('Unsupported provider type');
        }

        let domainBase = config.baseUrl;
        try {
            // Remove protocol and trailing slashes to get a domain base
            domainBase = domainBase.replace(/(^\w+:|^)\/\//, '');
            domainBase = domainBase.replace(/\/+$/, '');
        } catch (e) {
            console.warn('URL parsing failed, using raw', e);
        }

        const api = new SchemaApi({
            domainBase: domainBase,
            apiKey: config.apiKey
        });

        try {
            const result = await api.listAllSchema();
            
            if (Array.isArray(result)) {
                // Map the results to human-readable names
                // CEDAR templates usually have "schema:name" or "name"
                return result.map((r: any) => r['schema:name'] || r['name'] || r['@id'] || 'Unnamed Template');
            }
            
            throw new Error('Invalid response format from provider');
        } catch (error) {
            console.error('Connection test failed:', error);
            throw error; 
        }
    }
}
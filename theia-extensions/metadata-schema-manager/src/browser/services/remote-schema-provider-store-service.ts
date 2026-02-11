import { injectable, inject } from 'inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { URI } from '@theia/core/lib/common/uri';
import { RemoteSchemaProviderConfig } from '../types';
import { SchemaApi } from './schema-api';
import { SecureStorageService } from 'aroma2-common/lib/common/secure-storage-protocol';

const CONFIG_FILE_PATH = '.aroma/remote-schema-providers.json';
const KEYTAR_SERVICE_NAME = 'AROMA2.RemoteSchemaProvider';

@injectable()
export class RemoteSchemaProviderStoreService {

    @inject(FileService) protected readonly fileService!: FileService;
    @inject(EnvVariablesServer) protected readonly envVariablesServer!: EnvVariablesServer;
    @inject(SecureStorageService) protected readonly secureStorage!: SecureStorageService;

    protected async getConfigUri(): Promise<URI> {
        const homeDir = await this.envVariablesServer.getHomeDirUri();
        return new URI(homeDir).resolve(CONFIG_FILE_PATH);
    }

    public async loadProviders(): Promise<RemoteSchemaProviderConfig[]> {
        const uri = await this.getConfigUri();
        let configs: RemoteSchemaProviderConfig[] = [];

        try {
            if (await this.fileService.exists(uri)) {
                const content = await this.fileService.read(uri);
                configs = JSON.parse(content.value);
            }
        } catch (error) {
            console.error('Failed to load remote schema provider config:', error);
            return [];
        }

        const storedCredentials = await this.secureStorage.findCredentials(KEYTAR_SERVICE_NAME);
        const credentialMap = new Map<string, string>();
        storedCredentials.forEach(c => credentialMap.set(c.account, c.password));

        const hydratedConfigs = configs.map(config => {
            const secret = credentialMap.get(config.id);
            return { ...config, apiKey: secret || undefined };
        });

        const activeIds = new Set(configs.map(c => c.id));
        for (const cred of storedCredentials) {
            if (!activeIds.has(cred.account)) {
                await this.secureStorage.deletePassword(KEYTAR_SERVICE_NAME, cred.account);
            }
        }

        return hydratedConfigs;
    }

    public async saveProviders(providers: RemoteSchemaProviderConfig[]): Promise<void> {
        const uri = await this.getConfigUri();

        const cleanConfigs = providers.map(p => {
            const { apiKey, ...safeConfig } = p;
            return safeConfig;
        });

        const content = JSON.stringify(cleanConfigs, null, 4);
        if (!await this.fileService.exists(uri.parent)) {
            await this.fileService.createFolder(uri.parent);
        }
        await this.fileService.write(uri, content);

        for (const provider of providers) {
            if (provider.apiKey) {
                await this.secureStorage.setPassword(KEYTAR_SERVICE_NAME, provider.id, provider.apiKey);
            } else {
                await this.secureStorage.deletePassword(KEYTAR_SERVICE_NAME, provider.id);
            }
        }
    }

    /**
     * Verifies connection and returns a list of found template names.
     * Uses listAllSchema() to get a flat list of actual templates for the preview.
     */
    public async testConnection(baseUrl: string, apiKey?: string): Promise<string[]> {
        try {
            let domain = baseUrl.replace(/(^\w+:|^)\/\//, '').replace(/\/+$/, '');
            const api = new SchemaApi({ domainBase: domain, apiKey: apiKey });
            
            // FIX: Use listAllSchema to get actual templates directly
            const templates = await api.listAllSchema();
            
            if (templates && Array.isArray(templates)) {
                 return templates
                    .map((t: any) => t['schema:name'])
                    .slice(0, 10); // Limit to 10 for the UI preview
            }
            return [];
        } catch (e) {
            console.error("Test connection failed", e);
            throw e; 
        }
    }
}
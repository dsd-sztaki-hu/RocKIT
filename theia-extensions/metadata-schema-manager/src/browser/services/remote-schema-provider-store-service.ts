import { injectable, inject } from 'inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { URI } from '@theia/core/lib/common/uri';
import { RemoteSchemaProviderConfig } from '../types';
import { SchemaApi } from './schema-api';
// Import the secure storage protocol from common
import { SecureStorageService } from 'aroma2-common/lib/common/secure-storage-protocol';

// Constants
const CONFIG_FILE_PATH = '.aroma/remote-schema-providers.json';
const KEYTAR_SERVICE_NAME = 'AROMA2.RemoteSchemaProvider';

@injectable()
export class RemoteSchemaProviderStoreService {

    @inject(FileService) protected readonly fileService!: FileService;
    @inject(EnvVariablesServer) protected readonly envVariablesServer!: EnvVariablesServer;
    // Inject the secure storage service
    @inject(SecureStorageService) protected readonly secureStorage!: SecureStorageService;

    protected async getConfigUri(): Promise<URI> {
        const homeDir = await this.envVariablesServer.getHomeDirUri();
        return new URI(homeDir).resolve(CONFIG_FILE_PATH);
    }

    /**
     * Loads providers and merges them with secure API keys.
     */
    public async loadProviders(): Promise<RemoteSchemaProviderConfig[]> {
        const uri = await this.getConfigUri();
        let configs: RemoteSchemaProviderConfig[] = [];

        // 1. Load the JSON configuration (Public Data)
        try {
            if (await this.fileService.exists(uri)) {
                const content = await this.fileService.read(uri);
                configs = JSON.parse(content.value);
            }
        } catch (error) {
            console.error('Failed to load remote schema provider config:', error);
            return [];
        }

        // 2. Re-hydrate with API Keys from Secure Storage
        const storedCredentials = await this.secureStorage.findCredentials(KEYTAR_SERVICE_NAME);
        
        const credentialMap = new Map<string, string>();
        storedCredentials.forEach(c => credentialMap.set(c.account, c.password));

        const hydratedConfigs = configs.map(config => {
            const secret = credentialMap.get(config.id);
            return {
                ...config,
                apiKey: secret || undefined 
            };
        });

        // 3. ORPHAN CLEANUP
        const activeIds = new Set(configs.map(c => c.id));
        for (const cred of storedCredentials) {
            if (!activeIds.has(cred.account)) {
                console.log(`[RemoteSchemaProvider] Cleaning up orphaned API key for ID: ${cred.account}`);
                await this.secureStorage.deletePassword(KEYTAR_SERVICE_NAME, cred.account);
            }
        }

        return hydratedConfigs;
    }

    /**
     * Saves providers. 
     * Writes non-sensitive data to JSON.
     * Writes sensitive data (API Key) to Secure Storage.
     */
    public async saveProviders(providers: RemoteSchemaProviderConfig[]): Promise<void> {
        const uri = await this.getConfigUri();

        // 1. Separate Sensitive vs Non-Sensitive Data
        const cleanConfigs = providers.map(p => {
            const { apiKey, ...safeConfig } = p;
            return safeConfig;
        });

        // 2. Write JSON
        const content = JSON.stringify(cleanConfigs, null, 4);
        // Ensure the directory exists (simple check)
        if (!await this.fileService.exists(uri.parent)) {
            await this.fileService.createFolder(uri.parent);
        }
        await this.fileService.write(uri, content);

        // 3. Update Secure Storage
        for (const provider of providers) {
            if (provider.apiKey) {
                await this.secureStorage.setPassword(KEYTAR_SERVICE_NAME, provider.id, provider.apiKey);
            } else {
                await this.secureStorage.deletePassword(KEYTAR_SERVICE_NAME, provider.id);
            }
        }
    }

    /**
     * Verifies if a connection can be established with the given settings.
     * Used by the configuration dialog to validate inputs before saving.
     */
    public async testConnection(baseUrl: string, apiKey?: string): Promise<boolean> {
        try {
            // Clean URL for SchemaApi (remove protocol)
            let domain = baseUrl.replace(/(^\w+:|^)\/\//, '').replace(/\/+$/, '');
            
            const api = new SchemaApi({
                domainBase: domain,
                apiKey: apiKey
            });
            
            // Try to fetch the public folder ID. 
            // If this succeeds, the URL and Key (if required) are valid.
            await api.getPublicFolderId();
            return true;
        } catch (e) {
            console.error("Test connection failed", e);
            throw e; 
        }
    }
}
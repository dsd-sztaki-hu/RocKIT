import { injectable, inject } from 'inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { URI } from '@theia/core/lib/common/uri';

import { SecureStorageService } from 'aroma2-common/lib/browser';
import { DataRepositoryConfig } from '../types';

@injectable()
export class DataRepositoryStoreService {

    constructor(
        @inject(FileService) protected readonly fileService: FileService,
        @inject(EnvVariablesServer) protected readonly envVariablesServer: EnvVariablesServer,
        @inject(SecureStorageService) protected readonly secureStorage: SecureStorageService
    ) {}

    protected async getEnvConfig() {
        const rootPathEnv = await this.envVariablesServer.getValue('AROMA_ROOT_PATH');
        const configFileNameEnv = await this.envVariablesServer.getValue('AROMA_DATA_REPOSITORY_CONFIG_FILE');
        const keytarServiceEnv = await this.envVariablesServer.getValue('AROMA_DATA_REPOSITORY_KEYTAR_SERVICE');

        if (!rootPathEnv?.value || !configFileNameEnv?.value || !keytarServiceEnv?.value) {
            throw new Error('Critical Environment Variables missing. Check app-setup.js configuration.');
        }

        return {
            rootPath: rootPathEnv.value,
            configFileName: configFileNameEnv.value,
            keytarService: keytarServiceEnv.value
        };
    }

    protected async getConfigUri(): Promise<URI> {
        const { rootPath, configFileName } = await this.getEnvConfig();
        const normalizedRoot = rootPath.replace(/\\/g, '/');
        const baseUri = normalizedRoot.match(/^[a-zA-Z]:/) 
            ? new URI('file:///' + normalizedRoot) 
            : new URI('file://' + normalizedRoot);

        return baseUri.resolve(configFileName);
    }

    public async loadRepositories(): Promise<DataRepositoryConfig[]> {
        let uri: URI;
        let keytarService: string;

        try {
            uri = await this.getConfigUri();
            const env = await this.getEnvConfig();
            keytarService = env.keytarService;
        } catch (e) {
            console.error('Failed to initialize config paths:', e);
            return [];
        }
        
        let configs: DataRepositoryConfig[] = [];

        // 1. Read the non-sensitive configuration data from JSON
        try {
            if (await this.fileService.exists(uri)) {
                const content = await this.fileService.read(uri);
                configs = JSON.parse(content.value);
            }
        } catch (error) {
            console.error('Failed to read data repository config file:', error);
            return [];
        }

        // 2. Fetch all secure credentials from Keytar
        const storedCredentials = await this.secureStorage.findCredentials(keytarService);
        const credentialMap = new Map<string, string>();
        storedCredentials.forEach(c => credentialMap.set(c.account, c.password));

        // 3. Hydrate the config objects with the secure API keys
        const hydratedConfigs = configs.map(config => {
            const secret = credentialMap.get(config.id);
            return { ...config, apiKey: secret || undefined };
        });

        // 4. Runtime cleanup (removes OS keys if the JSON record was manually deleted by the user)
        const activeIds = new Set(configs.map(c => c.id));
        for (const cred of storedCredentials) {
            if (!activeIds.has(cred.account)) {
                console.warn(`[DataRepositoryStore] Removing runtime orphaned key: ${cred.account}`);
                await this.secureStorage.deletePassword(keytarService, cred.account);
            }
        }

        return hydratedConfigs;
    }

    public async saveRepositories(repositories: DataRepositoryConfig[]): Promise<void> {
        const uri = await this.getConfigUri();
        const { keytarService } = await this.getEnvConfig();

        // 1. Strip the API keys out of the objects before saving to plaintext JSON
        const cleanConfigs = repositories.map(p => {
            const { apiKey, ...safeConfig } = p;
            return safeConfig;
        });

        const content = JSON.stringify(cleanConfigs, null, 4);
        
        try {
            if (!await this.fileService.exists(uri.parent)) {
                await this.fileService.createFolder(uri.parent);
            }
            await this.fileService.write(uri, content);
        } catch (error) {
            console.error('Failed to save data repository config file:', error);
            throw error;
        }

        // 2. Save or delete the API keys in OS Secure Storage
        for (const repo of repositories) {
            if (repo.apiKey) {
                await this.secureStorage.setPassword(keytarService, repo.id, repo.apiKey);
            } else {
                await this.secureStorage.deletePassword(keytarService, repo.id);
            }
        }
    }
}
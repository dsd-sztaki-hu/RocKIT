// src\browser\services\remote-schema-provider-store-service.ts

import { injectable, inject } from 'inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { URI } from '@theia/core/lib/common/uri';

import { RemoteSchemaProviderConfig } from '../types';
import { SchemaApi } from './schema-api';
import { SecureStorageService } from 'aroma2-common/lib/common/secure-storage-protocol';


@injectable()
export class RemoteSchemaProviderStoreService {

    @inject(FileService) protected readonly fileService!: FileService;
    @inject(EnvVariablesServer) protected readonly envVariablesServer!: EnvVariablesServer;
    @inject(SecureStorageService) protected readonly secureStorage!: SecureStorageService;

    protected async getEnvConfig() {
        const rootPathEnv = await this.envVariablesServer.getValue('AROMA_ROOT_PATH');
        const configFileNameEnv = await this.envVariablesServer.getValue('AROMA_REMOTE_SCHEMA_PROVIDER_CONFIG_FILE');
        const keytarServiceEnv = await this.envVariablesServer.getValue('AROMA_REMOTE_SCHEMA_PROVIDER_KEYTAR_SERVICE');

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

    public async loadProviders(): Promise<RemoteSchemaProviderConfig[]> {
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
        
        let configs: RemoteSchemaProviderConfig[] = [];

        try {
            if (await this.fileService.exists(uri)) {
                const content = await this.fileService.read(uri);
                configs = JSON.parse(content.value);
            }
        } catch (error) {
            console.error('Failed to read remote schema config file:', error);
            return [];
        }

        const storedCredentials = await this.secureStorage.findCredentials(keytarService);
        const credentialMap = new Map<string, string>();
        storedCredentials.forEach(c => credentialMap.set(c.account, c.password));

        const hydratedConfigs = configs.map(config => {
            const secret = credentialMap.get(config.id);
            return { ...config, apiKey: secret || undefined };
        });

        const activeIds = new Set(configs.map(c => c.id));
        for (const cred of storedCredentials) {
            if (!activeIds.has(cred.account)) {
                console.warn(`[RemoteSchemaStore] Removing runtime orphaned key: ${cred.account}`);
                await this.secureStorage.deletePassword(keytarService, cred.account);
            }
        }

        return hydratedConfigs;
    }

    public async saveProviders(providers: RemoteSchemaProviderConfig[]): Promise<void> {
        const uri = await this.getConfigUri();
        const { keytarService } = await this.getEnvConfig();

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
                await this.secureStorage.setPassword(keytarService, provider.id, provider.apiKey);
            } else {
                await this.secureStorage.deletePassword(keytarService, provider.id);
            }
        }
    }

    /**
     * Verifies connection using the calculated domainBase.
     */
    public async testConnection(domainBase: string, apiKey?: string): Promise<string[]> {
        try {
            let domain = domainBase.replace(/(^\w+:|^)\/\//, '').replace(/\/+$/, '');
            const api = new SchemaApi({ domainBase: domain, apiKey: apiKey });
            
            const templates = await api.listAllSchema();
            
            if (templates && Array.isArray(templates)) {
                 return templates
                    .map((t: any) => t['schema:name'])
                    .slice(0, 10);
            }
            return [];
        } catch (e) {
            console.error("Test connection failed", e);
            throw e; 
        }
    }
}
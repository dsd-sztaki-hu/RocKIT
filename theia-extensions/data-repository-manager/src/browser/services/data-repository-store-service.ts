// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { injectable, inject } from 'inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { URI } from '@theia/core/lib/common/uri';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { nls } from '@theia/core/lib/common/nls';

import { SecureStorageService } from 'rockit-common/lib/browser';
import { DataRepositoryConfig } from '../types';

@injectable()
export class DataRepositoryStoreService {

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    constructor(
        @inject(FileService) protected readonly fileService: FileService,
        @inject(EnvVariablesServer) protected readonly envVariablesServer: EnvVariablesServer,
        @inject(SecureStorageService) protected readonly secureStorage: SecureStorageService
    ) {}

    protected async getEnvConfig() {
        const rootPathEnv =
            (await this.envVariablesServer.getValue('ROCKIT_ROOT_PATH')) ||
            undefined;
        const configFileNameEnv =
            (await this.envVariablesServer.getValue('ROCKIT_DATA_REPOSITORY_CONFIG_FILE')) ||
            undefined;
        const keytarServiceEnv =
            (await this.envVariablesServer.getValue('ROCKIT_DATA_REPOSITORY_KEYTAR_SERVICE')) ||
            undefined;

        if (!rootPathEnv?.value || !configFileNameEnv?.value || !keytarServiceEnv?.value) {
            throw new Error(nls.localize(
                'rockit/dataRepository/configEnvironmentMissing',
                'Critical environment variables are missing. Check the app-setup.js configuration.'
            ));
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

        try {
            if (await this.fileService.exists(uri)) {
                const content = await this.fileService.read(uri);
                configs = JSON.parse(content.value);
            }
        } catch (error) {
            console.error('Failed to read data repository config file:', error);
            return [];
        }

        const storedCredentials = await this.secureStorage.findCredentials(keytarService);
        const credentialMap = new Map<string, string>();
        storedCredentials.forEach(c => credentialMap.set(c.account, c.password));

        const hydratedConfigs = configs.map(config => {
            const secret = credentialMap.get(config.id);
            return {
                ...config,
                apiKey: secret || undefined
            };
        });

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

        const cleanConfigs = repositories.map(repository => {
            const { apiKey, type: _legacyType, ...safeConfig } = repository as DataRepositoryConfig & {
                type?: string;
            };
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

        for (const repo of repositories) {
            if (repo.apiKey) {
                await this.secureStorage.setPassword(keytarService, repo.id, repo.apiKey);
            } else {
                await this.secureStorage.deletePassword(keytarService, repo.id);
            }
        }

        this.onDidChangeEmitter.fire();
    }

    public async saveRepository(config: DataRepositoryConfig): Promise<void> {
        const current = await this.loadRepositories();
        const index = current.findIndex(r => r.id === config.id);

        if (index !== -1) {
            current[index] = config;
        } else {
            current.push(config);
        }

        await this.saveRepositories(current);
    }

    public async deleteRepositories(ids: string[]): Promise<void> {
        const current = await this.loadRepositories();
        await this.saveRepositories(current.filter(r => !ids.includes(r.id)));
    }
}

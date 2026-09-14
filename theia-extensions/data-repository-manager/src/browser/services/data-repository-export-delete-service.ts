// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { nls } from '@theia/core/lib/common/nls';
import { URI } from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { inject, injectable } from 'inversify';
import { DataRepositoryCapabilities, DataRepositoryConfig, DataRepositoryExportTarget } from '../types';
import {
    ExportLogEntry,
    normalizeExportLogEntries,
    serializeExportLogEntries
} from './export-log';

@injectable()
export class DataRepositoryExportDeleteService {
    constructor(
        @inject(FileService) protected readonly fileService: FileService,
        @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService
    ) {}

    async deleteExport(
        repository: DataRepositoryConfig,
        capabilities: DataRepositoryCapabilities,
        target: DataRepositoryExportTarget,
        deleteRemote: boolean
    ): Promise<void> {
        if (deleteRemote) {
            await this.deleteRemote(repository, capabilities, target);
        }
        await this.unlink(target);
    }

    protected async deleteRemote(
        repository: DataRepositoryConfig,
        capabilities: DataRepositoryCapabilities,
        target: DataRepositoryExportTarget
    ): Promise<void> {
        const baseUrl = repository.baseUrl.trim().replace(/\/+$/, '');
        const headers: Record<string, string> = { accept: 'application/json' };
        let url: string;

        if (capabilities.supportsZenodoApi) {
            url = `${baseUrl}/api/deposit/depositions/${encodeURIComponent(target.pid)}`;
            if (repository.apiKey) {
                headers.authorization = `Bearer ${repository.apiKey}`;
            }
        } else if (capabilities.supportsNativeDataverseApi) {
            const prefix = capabilities.supportsArpRoCrateZipUpload ? '/api/v1' : '/api';
            url = `${baseUrl}${prefix}/datasets/:persistentId/versions/:draft?persistentId=${encodeURIComponent(target.pid)}`;
            if (repository.apiKey) {
                headers['x-dataverse-key'] = repository.apiKey;
            }
        } else {
            throw new Error(nls.localize(
                'rockit/dataRepository/remoteDeletionUnsupported',
                "Remote deletion is not supported for '{0}'.",
                repository.title
            ));
        }

        const response = await fetch(url, { method: 'DELETE', headers });
        const payload = await this.readPayload(response);
        if (!response.ok || this.isError(payload)) {
            throw new Error(nls.localize(
                'rockit/dataRepository/remoteRejectedDeletion',
                'The remote repository rejected the deletion ({0}): {1}',
                response.status,
                this.payloadSummary(payload)
            ));
        }
    }

    protected async unlink(target: DataRepositoryExportTarget): Promise<void> {
        const root = this.workspaceService.tryGetRoots()?.[0]?.resource;
        if (!root) {
            throw new Error(nls.localize('rockit/dataRepository/noWorkspace', 'No workspace is open.'));
        }
        const rockit = root.resolve('.rockit');
        const logUri = rockit.resolve('export-log.json');
        const entries = await this.readLog(logUri);
        const remaining = entries.filter(entry =>
            this.normalizeUrl(entry.repository) !== this.normalizeUrl(target.repository)
            || entry.mappingFile !== target.mappingFile
        );
        await this.fileService.writeFile(
            logUri,
            BinaryBuffer.fromString(`${JSON.stringify(serializeExportLogEntries(remaining), null, 2)}\n`)
        );
        const mappingUri = rockit.resolve(target.mappingFile);
        if (await this.fileService.exists(mappingUri)) {
            await this.fileService.delete(mappingUri);
        }
    }

    protected async readLog(uri: URI): Promise<ExportLogEntry[]> {
        if (!(await this.fileService.exists(uri))) {
            return [];
        }
        try {
            const parsed = JSON.parse((await this.fileService.readFile(uri)).value.toString());
            return normalizeExportLogEntries(parsed);
        } catch (error) {
            throw new Error(nls.localize(
                'rockit/dataRepository/readExportLogFailed',
                'Could not read .rockit/export-log.json: {0}',
                error instanceof Error ? error.message : String(error)
            ));
        }
    }

    protected normalizeUrl(value: unknown): string {
        return typeof value === 'string' ? value.trim().replace(/\/+$/, '').toLowerCase() : '';
    }

    protected async readPayload(response: Response): Promise<unknown> {
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

    protected isError(payload: unknown): boolean {
        return !!payload && typeof payload === 'object' && !Array.isArray(payload)
            && (payload as Record<string, unknown>).status === 'ERROR';
    }

    protected payloadSummary(payload: unknown): string {
        if (typeof payload === 'string') {
            return payload.slice(0, 400);
        }
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            const record = payload as Record<string, unknown>;
            const message = record.message ?? record.error;
            if (typeof message === 'string') {
                return message.slice(0, 400);
            }
        }
        return JSON.stringify(payload).slice(0, 400);
    }
}

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { inject, injectable } from '@theia/core/shared/inversify'
import { readUtf8TextFile, writeUtf8TextFile } from 'rockit-common/lib/browser'
import {
    isSupportedGlobalEntityType,
    SUPPORTED_GLOBAL_ENTITY_TYPES,
} from './global-entity-library-store'
import { parseGlobalEntityMappingJson } from './global-entity-mapping-json'
import type { GlobalEntityMapping, GlobalEntityMappingEntry } from './global-entity-library-types'

const MAPPING_FILE_NAME = 'global-entity-mapping.json'

@injectable()
export class GlobalEntityMappingStore {
    constructor(
        @inject(FileService) protected readonly fileService: FileService,
        @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService,
    ) {}

    getRootKey(): string | undefined {
        return this.workspaceService.tryGetRoots()?.[0]?.resource.toString()
    }

    async load(): Promise<GlobalEntityMapping> {
        const root = this.workspaceService.tryGetRoots()?.[0]?.resource
        if (!root) return {}
        const uri = root.resolve('.rockit').resolve(MAPPING_FILE_NAME)
        if (!await this.fileService.exists(uri)) return {}

        const content = await readUtf8TextFile(this.fileService, uri)
        const parsed = parseGlobalEntityMappingJson(content)
        return this.normalize(parsed)
    }

    async save(mapping: GlobalEntityMapping): Promise<void> {
        const root = this.workspaceService.tryGetRoots()?.[0]?.resource
        if (!root) return
        const rockitUri = root.resolve('.rockit')
        if (!await this.fileService.exists(rockitUri)) {
            await this.fileService.createFolder(rockitUri)
        }
        await writeUtf8TextFile(
            this.fileService,
            rockitUri.resolve(MAPPING_FILE_NAME),
            `${JSON.stringify(this.normalize(mapping), null, 2)}\n`,
        )
    }

    protected normalize(value: unknown): GlobalEntityMapping {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
        const normalized: GlobalEntityMapping = {}
        for (const type of SUPPORTED_GLOBAL_ENTITY_TYPES) {
            const rawGroup = (value as Record<string, unknown>)[type]
            if (!rawGroup || typeof rawGroup !== 'object' || Array.isArray(rawGroup)) continue
            const group: Record<string, GlobalEntityMappingEntry> = {}
            for (const [recordId, rawEntry] of Object.entries(rawGroup)) {
                if (!recordId.trim() || !rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
                    continue
                }
                const entry = rawEntry as Partial<GlobalEntityMappingEntry>
                const entityIds = Array.isArray(entry.entityIds)
                    ? [...new Set(entry.entityIds.filter((id): id is string => typeof id === 'string' && !!id.trim()))]
                        .sort((left, right) => left.localeCompare(right))
                    : []
                if (!entityIds.length) continue
                group[recordId] = {
                    entityIds,
                    lastSyncedHash: typeof entry.lastSyncedHash === 'string' ? entry.lastSyncedHash : '',
                }
            }
            if (Object.keys(group).length) {
                normalized[type] = Object.fromEntries(
                    Object.entries(group).sort(([left], [right]) => left.localeCompare(right)),
                )
            }
        }
        return Object.fromEntries(
            Object.entries(normalized)
                .filter(([type]) => isSupportedGlobalEntityType(type))
                .sort(([left], [right]) => left.localeCompare(right)),
        )
    }
}

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { EnvVariablesServer } from '@theia/core/lib/common/env-variables'
import URI from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { inject, injectable } from '@theia/core/shared/inversify'
import { readUtf8TextFile, writeUtf8TextFile } from 'rockit-common/lib/browser'
import type { GlobalEntityCollection, GlobalEntityRecord } from './global-entity-library-types'

const GLOBAL_ENTITIES_FILE_NAME = 'global-entities.json'

export const SUPPORTED_GLOBAL_ENTITY_TYPES = ['author', 'datasetContact'] as const
export type SupportedGlobalEntityType = typeof SUPPORTED_GLOBAL_ENTITY_TYPES[number]

export const isSupportedGlobalEntityType = (type: string): type is SupportedGlobalEntityType =>
    SUPPORTED_GLOBAL_ENTITY_TYPES.includes(type as SupportedGlobalEntityType)

const compareText = (left: string, right: string): number =>
    left.localeCompare(right, undefined, { sensitivity: 'base' })

export const getEntityTypes = (entity: Record<string, unknown>): string[] => {
    const raw = entity['@type']
    const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]
    return [...new Set(values.map(value => String(value).trim()).filter(Boolean))]
        .sort(compareText)
}

export const getPrimaryEntityType = (entity: Record<string, unknown>): string =>
    getEntityTypes(entity)[0] ?? 'Thing'

export const getEntityName = (entity: Record<string, unknown>): string => {
    const raw = entity.name
    if (Array.isArray(raw)) {
        return raw.map(value => String(value)).join(', ')
    }
    return raw === undefined || raw === null ? '' : String(raw)
}

export const sanitizeGlobalEntity = (
    entity: Record<string, unknown>,
): Record<string, unknown> => {
    const {
        '@id': _id,
        '@reverse': _reverse,
        recordId: _recordId,
        relationships: _relationships,
        ...safeEntity
    } = entity
    return safeEntity
}

export const sortGlobalEntityCollection = (
    collection: GlobalEntityCollection,
): GlobalEntityCollection => {
    const sorted: GlobalEntityCollection = {}
    for (const type of Object.keys(collection).filter(isSupportedGlobalEntityType).sort(compareText)) {
        sorted[type] = [...collection[type]].sort((left, right) =>
            compareText(getEntityName(left.entity), getEntityName(right.entity)) ||
            compareText(left.recordId, right.recordId),
        )
    }
    return sorted
}

@injectable()
export class GlobalEntityLibraryStore {
    constructor(
        @inject(FileService) protected readonly fileService: FileService,
        @inject(EnvVariablesServer) protected readonly envVariablesServer: EnvVariablesServer,
    ) {}

    async load(): Promise<GlobalEntityCollection> {
        const uri = await this.getFileUri()
        if (!await this.fileService.exists(uri)) {
            return {}
        }

        const content = await readUtf8TextFile(this.fileService, uri)
        const parsed: unknown = JSON.parse(content)
        return this.normalizeCollection(parsed)
    }

    async save(collection: GlobalEntityCollection): Promise<GlobalEntityCollection> {
        const normalized = sortGlobalEntityCollection(collection)
        const uri = await this.getFileUri()
        if (!await this.fileService.exists(uri.parent)) {
            await this.fileService.createFolder(uri.parent)
        }
        await writeUtf8TextFile(
            this.fileService,
            uri,
            `${JSON.stringify(normalized, null, 2)}\n`,
        )
        return normalized
    }

    protected async getFileUri(): Promise<URI> {
        const rootPath = await this.envVariablesServer.getValue('ROCKIT_ROOT_PATH')
        if (!rootPath?.value) {
            throw new Error('ROCKIT_ROOT_PATH is not configured.')
        }
        const normalizedRoot = rootPath.value.replace(/\\/g, '/')
        const rootUri = normalizedRoot.match(/^[a-zA-Z]:/)
            ? new URI(`file:///${normalizedRoot}`)
            : new URI(`file://${normalizedRoot}`)
        return rootUri.resolve(GLOBAL_ENTITIES_FILE_NAME)
    }

    protected normalizeCollection(value: unknown): GlobalEntityCollection {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('The global entity library must be a JSON object grouped by entity type.')
        }

        const collection: GlobalEntityCollection = {}
        for (const [type, rawRecords] of Object.entries(value)) {
            if (!isSupportedGlobalEntityType(type) || !Array.isArray(rawRecords)) {
                continue
            }
            const records = rawRecords.filter(this.isRecord).map(record => ({
                recordId: record.recordId,
                entity: {
                    ...sanitizeGlobalEntity(record.entity),
                    '@type': [type],
                },
                relationships: this.normalizeRelationships(record.relationships),
            }))
            if (records.length) {
                collection[type] = records
            }
        }
        return sortGlobalEntityCollection(collection)
    }

    protected isRecord(value: unknown): value is GlobalEntityRecord {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return false
        }
        const record = value as Partial<GlobalEntityRecord>
        return typeof record.recordId === 'string' && !!record.recordId.trim() &&
            !!record.entity && typeof record.entity === 'object' && !Array.isArray(record.entity)
    }

    protected normalizeRelationships(value: unknown): Record<string, string[]> | undefined {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return undefined
        }
        const relationships: Record<string, string[]> = {}
        for (const [property, targets] of Object.entries(value)) {
            if (Array.isArray(targets)) {
                const ids = targets.filter((target): target is string => typeof target === 'string')
                if (ids.length) relationships[property] = ids
            }
        }
        return Object.keys(relationships).length ? relationships : undefined
    }
}

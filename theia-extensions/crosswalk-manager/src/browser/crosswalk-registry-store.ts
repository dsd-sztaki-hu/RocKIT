// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { EnvVariablesServer } from '@theia/core/lib/common/env-variables'
import URI from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { inject, injectable, multiInject, optional } from '@theia/core/shared/inversify'
import { readUtf8TextFile, writeUtf8TextFile } from 'rockit-common/lib/browser'
import {
    BundledCrosswalk,
    CrosswalkDocument,
    CrosswalkRegistryEntry,
    CrosswalkRegistryIndex,
    parseCrosswalk,
    summarizeCrosswalk,
} from './crosswalk-manager-types'

const CROSSWALK_DIRECTORY_NAME = 'crosswalk-files'
const CROSSWALK_INDEX_FILE_NAME = 'index.json'

const compareEntries = (left: CrosswalkRegistryEntry, right: CrosswalkRegistryEntry): number =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) ||
    left.id.localeCompare(right.id, undefined, { sensitivity: 'base' })

const compactHash = (value: string): string => {
    let hash = 0x811c9dc5
    for (let index = 0; index < value.length; index += 1) {
        hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193)
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
}

const safeFileName = (id: string): string => {
    const readable = id.toLocaleLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'crosswalk'
    return `${readable}-${compactHash(id)}.json`
}

@injectable()
export class CrosswalkRegistryStore {
    constructor(
        @inject(FileService) protected readonly fileService: FileService,
        @inject(EnvVariablesServer) protected readonly envVariablesServer: EnvVariablesServer,
        @multiInject(BundledCrosswalk) @optional()
        protected readonly bundledCrosswalks: BundledCrosswalk[] = [],
    ) {}

    async list(): Promise<CrosswalkRegistryEntry[]> {
        const index = await this.loadIndex()
        let changed = false
        for (const entry of index.crosswalks) {
            if (this.findBundledCrosswalk(entry.id)) continue
            if (Array.isArray(entry.repositories) && typeof entry.ruleCount === 'number') continue
            const documentUri = (await this.getDirectoryUri()).resolve(entry.fileName)
            const content = await readUtf8TextFile(this.fileService, documentUri)
            const summary = summarizeCrosswalk(parseCrosswalk(content).document)
            entry.repositories = summary.repositories
            entry.ruleCount = summary.ruleCount
            changed = true
        }
        if (changed) await this.saveIndex(index)
        const defaults: CrosswalkRegistryEntry[] = this.bundledCrosswalks.map(({ fileName, document }) => ({
            id: document.id,
            name: document.name,
            fileName,
            sourceFileName: fileName,
            builtIn: true,
            ...summarizeCrosswalk(document),
        }))
        // Previously imported copies keep their files, but each built-in ID appears only once.
        return [
            ...defaults,
            ...index.crosswalks
                .filter(entry => !this.findBundledCrosswalk(entry.id))
                .map(entry => ({ ...entry, builtIn: false })),
        ].sort(compareEntries)
    }

    async importFile(sourceUri: URI): Promise<CrosswalkRegistryEntry> {
        const content = await readUtf8TextFile(this.fileService, sourceUri)
        const parsed = parseCrosswalk(content)
        const summary = summarizeCrosswalk(parsed.document)
        const index = await this.loadIndex()
        if (this.findBundledCrosswalk(parsed.id) || index.crosswalks.some(entry => entry.id === parsed.id)) {
            throw new Error(`A crosswalk with the identifier \"${parsed.id}\" is already registered.`)
        }

        const directoryUri = await this.getDirectoryUri()
        await this.ensureDirectory(directoryUri)
        const entry: CrosswalkRegistryEntry = {
            id: parsed.id,
            name: parsed.name,
            fileName: safeFileName(parsed.id),
            sourceFileName: sourceUri.path.base,
            importedAt: new Date().toISOString(),
            repositories: summary.repositories,
            ruleCount: summary.ruleCount,
        }
        await writeUtf8TextFile(
            this.fileService,
            directoryUri.resolve(entry.fileName),
            `${JSON.stringify(parsed.document, null, 2)}\n`,
        )
        index.crosswalks.push(entry)
        await this.saveIndex(index)
        return entry
    }

    async delete(id: string): Promise<void> {
        if (this.findBundledCrosswalk(id)) {
            throw new Error('Built-in crosswalks cannot be deleted.')
        }
        const index = await this.loadIndex()
        const entry = index.crosswalks.find(candidate => candidate.id === id)
        if (!entry) return

        const directoryUri = await this.getDirectoryUri()
        const fileUri = directoryUri.resolve(entry.fileName)
        if (await this.fileService.exists(fileUri)) {
            await this.fileService.delete(fileUri)
        }
        await this.saveIndex({
            version: 1,
            crosswalks: index.crosswalks.filter(candidate => candidate.id !== id),
        })
    }

    async read(id: string): Promise<CrosswalkDocument | undefined> {
        const bundled = this.findBundledCrosswalk(id)
        if (bundled) {
            return JSON.parse(JSON.stringify(bundled.document)) as CrosswalkDocument
        }
        const entry = (await this.loadIndex()).crosswalks.find(candidate => candidate.id === id)
        if (!entry) return undefined
        const directoryUri = await this.getDirectoryUri()
        const content = await readUtf8TextFile(this.fileService, directoryUri.resolve(entry.fileName))
        return parseCrosswalk(content).document
    }

    protected findBundledCrosswalk(id: string): BundledCrosswalk | undefined {
        return this.bundledCrosswalks.find(crosswalk => crosswalk.document.id === id)
    }

    protected async loadIndex(): Promise<CrosswalkRegistryIndex> {
        const indexUri = await this.getIndexUri()
        if (!await this.fileService.exists(indexUri)) {
            return { version: 1, crosswalks: [] }
        }
        const content = await readUtf8TextFile(this.fileService, indexUri)
        const value: unknown = JSON.parse(content)
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('The crosswalk registry index is invalid.')
        }
        const candidate = value as Partial<CrosswalkRegistryIndex>
        if (candidate.version !== 1 || !Array.isArray(candidate.crosswalks) ||
            !candidate.crosswalks.every(entry => this.isRegistryEntry(entry))) {
            throw new Error('The crosswalk registry index has an unsupported or invalid format.')
        }
        return { version: 1, crosswalks: candidate.crosswalks }
    }

    protected async saveIndex(index: CrosswalkRegistryIndex): Promise<void> {
        const directoryUri = await this.getDirectoryUri()
        await this.ensureDirectory(directoryUri)
        const normalized: CrosswalkRegistryIndex = {
            version: 1,
            crosswalks: [...index.crosswalks].sort(compareEntries),
        }
        await writeUtf8TextFile(
            this.fileService,
            directoryUri.resolve(CROSSWALK_INDEX_FILE_NAME),
            `${JSON.stringify(normalized, null, 2)}\n`,
        )
    }

    protected isRegistryEntry(value: unknown): value is CrosswalkRegistryEntry {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false
        const entry = value as Partial<CrosswalkRegistryEntry>
        return typeof entry.id === 'string' && !!entry.id.trim() &&
            typeof entry.name === 'string' && !!entry.name.trim() &&
            typeof entry.fileName === 'string' && !!entry.fileName.trim() &&
            !entry.fileName.includes('/') && !entry.fileName.includes('\\') &&
            typeof entry.sourceFileName === 'string' &&
            (entry.repositories === undefined ||
                (Array.isArray(entry.repositories) && entry.repositories.every(item => typeof item === 'string'))) &&
            (entry.ruleCount === undefined ||
                (typeof entry.ruleCount === 'number' && Number.isInteger(entry.ruleCount) && entry.ruleCount >= 0)) &&
            typeof entry.importedAt === 'string' && !Number.isNaN(Date.parse(entry.importedAt))
    }

    protected async ensureDirectory(directoryUri: URI): Promise<void> {
        if (!await this.fileService.exists(directoryUri)) {
            await this.fileService.createFolder(directoryUri)
        }
    }

    protected async getIndexUri(): Promise<URI> {
        return (await this.getDirectoryUri()).resolve(CROSSWALK_INDEX_FILE_NAME)
    }

    protected async getDirectoryUri(): Promise<URI> {
        const rootPath = await this.envVariablesServer.getValue('ROCKIT_ROOT_PATH')
        if (!rootPath?.value) {
            throw new Error('ROCKIT_ROOT_PATH is not configured.')
        }
        const normalizedRoot = rootPath.value.replace(/\\/g, '/')
        const rootUri = normalizedRoot.match(/^[a-zA-Z]:/)
            ? new URI(`file:///${normalizedRoot}`)
            : new URI(`file://${normalizedRoot}`)
        return rootUri.resolve(CROSSWALK_DIRECTORY_NAME)
    }
}

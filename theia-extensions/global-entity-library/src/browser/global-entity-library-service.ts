import { Emitter, type Event } from '@theia/core/lib/common'
import type { FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { inject, injectable } from '@theia/core/shared/inversify'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import {
    getPrimaryEntityType,
    isSupportedGlobalEntityType,
    sanitizeGlobalEntity,
    type SupportedGlobalEntityType,
} from './global-entity-library-store'
import { GlobalEntityLibraryStore } from './global-entity-library-store'
import { GlobalEntityMappingStore } from './global-entity-mapping-store'
import type {
    GlobalEntityCollection,
    GlobalEntityMapping,
    GlobalEntityMappingEntry,
    GlobalEntityRecord,
} from './global-entity-library-types'

interface MappingTarget {
    type: SupportedGlobalEntityType
    recordId: string
}

const RECONCILE_DELAY_MS = 150

const newRecordId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return `global-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const compactHash = (value: unknown): string => {
    let first = 0x811c9dc5
    let second = 0x9e3779b9

    const addText = (text: string): void => {
        for (let index = 0; index < text.length; index += 1) {
            const code = text.charCodeAt(index)
            first = Math.imul(first ^ code, 0x01000193)
            second = Math.imul(second ^ code, 0x85ebca6b)
        }
    }

    const visit = (item: unknown): void => {
        if (item === null) {
            addText('null;')
        } else if (Array.isArray(item)) {
            addText('[')
            item.forEach(visit)
            addText(']')
        } else if (typeof item === 'object') {
            addText('{')
            const record = item as Record<string, unknown>
            for (const key of Object.keys(record).sort()) {
                addText(`${key.length}:${key}=`)
                visit(record[key])
            }
            addText('}')
        } else {
            const text = String(item)
            addText(`${typeof item}:${text.length}:${text};`)
        }
    }

    visit(value)
    return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

const withoutEntityReferences = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        const items = value
            .map(withoutEntityReferences)
            .filter(item => item !== undefined)
        return items.length ? items : undefined
    }
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>
        if (typeof record['@id'] === 'string') return undefined
        const result: Record<string, unknown> = {}
        for (const [key, child] of Object.entries(record)) {
            const normalized = withoutEntityReferences(child)
            if (normalized !== undefined) result[key] = normalized
        }
        return Object.keys(result).length ? result : undefined
    }
    return value
}

@injectable()
export class GlobalEntityLibraryService implements FrontendApplicationContribution {
    @inject(AppStateService)
    protected readonly appStateService: AppStateService

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService

    @inject(GlobalEntityLibraryStore)
    protected readonly store: GlobalEntityLibraryStore

    @inject(GlobalEntityMappingStore)
    protected readonly mappingStore: GlobalEntityMappingStore

    protected collection: GlobalEntityCollection = {}
    protected mapping: GlobalEntityMapping = {}
    protected readonly recordHashById = new Map<string, string>()
    protected readonly uniqueRecordIdByTypeAndHash = new Map<string, string | null>()
    protected readonly mappingByEntityId = new Map<string, MappingTarget>()
    protected initialized = false
    protected initialization?: Promise<void>
    protected mappingRootKey?: string
    protected reconcileTimer?: number
    protected operationQueue: Promise<void> = Promise.resolve()

    protected readonly collectionChangedEmitter = new Emitter<GlobalEntityCollection>()
    readonly onDidChangeCollection: Event<GlobalEntityCollection> = this.collectionChangedEmitter.event

    onStart(_app: FrontendApplication): void {
        this.appStateService.onDidChangeSelector(state => state.roCrate)((crate) => {
            if (crate) this.scheduleReconcile()
        })
        this.workspaceService.onWorkspaceChanged(() => this.scheduleMappingReload())
        this.workspaceService.onWorkspaceLocationChanged(() => this.scheduleMappingReload())
    }

    async getCollection(): Promise<GlobalEntityCollection> {
        return this.runSerialized(async () => {
            await this.ensureInitialized()
            if (this.reconcileTimer !== undefined) {
                window.clearTimeout(this.reconcileTimer)
                this.reconcileTimer = undefined
            }
            await this.ensureCurrentMapping()
            await this.reconcileCurrentCrate()
            return this.collection
        })
    }

    async saveRecord(record: GlobalEntityRecord): Promise<GlobalEntityCollection> {
        return this.runSerialized(async () => {
            await this.ensureInitialized()
            const type = getPrimaryEntityType(record.entity)
            if (!isSupportedGlobalEntityType(type)) {
                throw new Error(`Unsupported global entity type: ${type}`)
            }

            this.removeRecordFromCollection(record.recordId)
            const normalized: GlobalEntityRecord = {
                recordId: record.recordId,
                entity: {
                    ...sanitizeGlobalEntity(record.entity),
                    '@type': [type],
                },
                relationships: record.relationships ?? {},
            }
            ;(this.collection[type] ??= []).push(normalized)
            await this.persistCollection()
            return this.collection
        })
    }

    async deleteRecords(recordIds: string[]): Promise<GlobalEntityCollection> {
        return this.runSerialized(async () => {
            await this.ensureInitialized()
            const deletedIds = new Set(recordIds)
            for (const recordId of deletedIds) this.removeRecordFromCollection(recordId)
            for (const records of Object.values(this.collection)) {
                for (const record of records) {
                    const relationships = Object.fromEntries(
                        Object.entries(record.relationships ?? {})
                            .map(([property, targets]) => [
                                property,
                                targets.filter(target => !deletedIds.has(target)),
                            ])
                            .filter(([, targets]) => (targets as string[]).length),
                    )
                    record.relationships = relationships
                }
            }
            await this.persistCollection()
            return this.collection
        })
    }

    protected async ensureInitialized(): Promise<void> {
        if (this.initialized) return
        if (!this.initialization) {
            this.initialization = (async () => {
                this.collection = await this.store.load()
                this.rebuildRecordIndexes()
                await this.loadCurrentMapping()
                this.initialized = true
                this.collectionChangedEmitter.fire(this.collection)
                this.scheduleReconcile()
            })()
        }
        await this.initialization
    }

    protected scheduleReconcile(): void {
        if (this.reconcileTimer !== undefined) window.clearTimeout(this.reconcileTimer)
        this.reconcileTimer = window.setTimeout(() => {
            this.reconcileTimer = undefined
            void this.runSerialized(async () => {
                await this.ensureInitialized()
                await this.ensureCurrentMapping()
                await this.reconcileCurrentCrate()
            }).catch(error => console.error('[GlobalEntityLibrary] Reconciliation failed:', error))
        }, RECONCILE_DELAY_MS)
    }

    protected scheduleMappingReload(): void {
        if (!this.initialized && !this.appStateService.roCrate) return
        void this.runSerialized(async () => {
            await this.ensureInitialized()
            await this.loadCurrentMapping()
            this.scheduleReconcile()
        }).catch(error => console.error('[GlobalEntityLibrary] Failed to load crate mapping:', error))
    }

    protected async ensureCurrentMapping(): Promise<void> {
        if (this.mappingRootKey !== this.mappingStore.getRootKey()) {
            await this.loadCurrentMapping()
        }
    }

    protected async loadCurrentMapping(): Promise<void> {
        this.mapping = await this.mappingStore.load()
        this.mappingRootKey = this.mappingStore.getRootKey()
        this.rebuildMappingIndex()
    }

    protected async reconcileCurrentCrate(): Promise<void> {
        const crate = this.appStateService.roCrate
        const graph = Array.isArray(crate?.['@graph']) ? crate['@graph'] as unknown[] : []
        if (!graph.length || !this.mappingRootKey) return

        let collectionChanged = false
        let mappingChanged = false
        for (const candidate of graph) {
            if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
            const source = candidate as Record<string, unknown>
            const entityId = typeof source['@id'] === 'string' ? source['@id'].trim() : ''
            const type = this.getSupportedType(source)
            if (!entityId || !type) continue

            const record = this.projectEntity(source, type)
            const hash = this.hashRecord(record)
            let mapped = this.mappingByEntityId.get(entityId)
            if (mapped && !this.recordHashById.has(mapped.recordId)) {
                this.unlinkEntityId(mapped, entityId)
                mappingChanged = true
                mapped = undefined
            }
            if (mapped) {
                const link = this.mapping[mapped.type]?.[mapped.recordId]
                const globalRecordHash = this.recordHashById.get(mapped.recordId)
                if (!link || !globalRecordHash || hash === link.lastSyncedHash) continue

                if (globalRecordHash === link.lastSyncedHash) {
                    this.replaceRecord(mapped.type, { ...record, recordId: mapped.recordId })
                    link.lastSyncedHash = hash
                    collectionChanged = true
                    mappingChanged = true
                } else {
                    this.unlinkEntityId(mapped, entityId)
                    const created = { ...record, recordId: newRecordId() }
                    ;(this.collection[type] ??= []).push(created)
                    this.addMapping(type, created.recordId, entityId, hash)
                    collectionChanged = true
                    mappingChanged = true
                }
                this.rebuildRecordIndexes()
                continue
            }

            const matchedRecordId = this.uniqueRecordIdByTypeAndHash.get(`${type}\n${hash}`)
            const recordId = typeof matchedRecordId === 'string' ? matchedRecordId : newRecordId()
            if (typeof matchedRecordId !== 'string') {
                ;(this.collection[type] ??= []).push({ ...record, recordId })
                this.rebuildRecordIndexes()
                collectionChanged = true
            }
            this.addMapping(type, recordId, entityId, hash)
            mappingChanged = true
        }

        if (collectionChanged) await this.persistCollection()
        if (mappingChanged) await this.mappingStore.save(this.mapping)
    }

    protected projectEntity(
        source: Record<string, unknown>,
        type: SupportedGlobalEntityType,
    ): Omit<GlobalEntityRecord, 'recordId'> {
        const entity: Record<string, unknown> = { '@type': [type] }
        for (const [property, value] of Object.entries(source)) {
            if (property === '@id' || property === '@reverse' || property === '@type') continue
            const normalized = withoutEntityReferences(value)
            if (normalized !== undefined) entity[property] = normalized
        }
        return { entity: sanitizeGlobalEntity(entity), relationships: {} }
    }

    protected getSupportedType(entity: Record<string, unknown>): SupportedGlobalEntityType | undefined {
        const raw = entity['@type']
        const types = Array.isArray(raw) ? raw : [raw]
        return types.find((type): type is SupportedGlobalEntityType =>
            typeof type === 'string' && isSupportedGlobalEntityType(type),
        )
    }

    protected hashRecord(record: Pick<GlobalEntityRecord, 'entity' | 'relationships'>): string {
        return compactHash({ entity: record.entity, relationships: record.relationships ?? {} })
    }

    protected rebuildRecordIndexes(): void {
        this.recordHashById.clear()
        this.uniqueRecordIdByTypeAndHash.clear()
        for (const [type, records] of Object.entries(this.collection)) {
            if (!isSupportedGlobalEntityType(type)) continue
            for (const record of records) {
                const hash = this.hashRecord(record)
                this.recordHashById.set(record.recordId, hash)
                const key = `${type}\n${hash}`
                this.uniqueRecordIdByTypeAndHash.set(
                    key,
                    this.uniqueRecordIdByTypeAndHash.has(key) ? null : record.recordId,
                )
            }
        }
    }

    protected rebuildMappingIndex(): void {
        this.mappingByEntityId.clear()
        for (const [type, entries] of Object.entries(this.mapping)) {
            if (!isSupportedGlobalEntityType(type)) continue
            for (const [recordId, entry] of Object.entries(entries)) {
                for (const entityId of entry.entityIds) {
                    this.mappingByEntityId.set(entityId, { type, recordId })
                }
            }
        }
    }

    protected addMapping(
        type: SupportedGlobalEntityType,
        recordId: string,
        entityId: string,
        hash: string,
    ): void {
        const group = this.mapping[type] ??= {}
        const entry: GlobalEntityMappingEntry = group[recordId] ?? {
            entityIds: [],
            lastSyncedHash: hash,
        }
        if (!entry.entityIds.includes(entityId)) entry.entityIds.push(entityId)
        entry.entityIds.sort((left, right) => left.localeCompare(right))
        entry.lastSyncedHash = hash
        group[recordId] = entry
        this.mappingByEntityId.set(entityId, { type, recordId })
    }

    protected unlinkEntityId(target: MappingTarget, entityId: string): void {
        const group = this.mapping[target.type]
        const entry = group?.[target.recordId]
        if (!entry) return
        entry.entityIds = entry.entityIds.filter(id => id !== entityId)
        if (!entry.entityIds.length) delete group[target.recordId]
        this.mappingByEntityId.delete(entityId)
    }

    protected replaceRecord(type: SupportedGlobalEntityType, replacement: GlobalEntityRecord): void {
        const records = this.collection[type] ?? []
        const index = records.findIndex(record => record.recordId === replacement.recordId)
        if (index >= 0) records[index] = replacement
    }

    protected removeRecordFromCollection(recordId: string): void {
        for (const type of Object.keys(this.collection)) {
            const records = this.collection[type]
            const index = records.findIndex(record => record.recordId === recordId)
            if (index < 0) continue
            records.splice(index, 1)
            if (!records.length) delete this.collection[type]
            return
        }
    }

    protected async persistCollection(): Promise<void> {
        this.collection = await this.store.save(this.collection)
        this.rebuildRecordIndexes()
        this.collectionChangedEmitter.fire(this.collection)
    }

    protected runSerialized<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.operationQueue.then(operation, operation)
        this.operationQueue = result.then(() => undefined, () => undefined)
        return result
    }
}

export type GlobalEntity = Record<string, unknown>

export interface GlobalEntityRecord {
    recordId: string
    entity: GlobalEntity
    relationships?: Record<string, string[]>
}

export type GlobalEntityCollection = Record<string, GlobalEntityRecord[]>

export interface GlobalEntityRow extends GlobalEntityRecord {
    entityType: string
}

export interface GlobalEntityMappingEntry {
    entityIds: string[]
    lastSyncedHash: string
}

export type GlobalEntityMapping = Record<
    string,
    Record<string, GlobalEntityMappingEntry>
>

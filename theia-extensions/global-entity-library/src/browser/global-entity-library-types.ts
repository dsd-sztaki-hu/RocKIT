// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

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

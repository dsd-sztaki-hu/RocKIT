// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type { Event } from '@theia/core/lib/common'
import type URI from '@theia/core/lib/common/uri'
import type { CrosswalkDocument, CrosswalkRegistryEntry } from './crosswalk-manager-types'

/** Lightweight public contract consumed by repository-management extensions. */
export const CrosswalkRegistry = Symbol('CrosswalkRegistry')
export interface CrosswalkRegistry {
    readonly onDidChange: Event<CrosswalkRegistryEntry[]>
    list(): Promise<CrosswalkRegistryEntry[]>
    importFile(uri: URI): Promise<CrosswalkRegistryEntry>
    delete(id: string): Promise<void>
    read(id: string): Promise<CrosswalkDocument | undefined>
}

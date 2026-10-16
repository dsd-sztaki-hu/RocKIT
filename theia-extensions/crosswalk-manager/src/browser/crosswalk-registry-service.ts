// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { Emitter, Event } from '@theia/core/lib/common'
import URI from '@theia/core/lib/common/uri'
import { inject, injectable } from '@theia/core/shared/inversify'
import { CrosswalkRegistryStore } from './crosswalk-registry-store'
import { CrosswalkDocument, CrosswalkRegistryEntry } from './crosswalk-manager-types'

@injectable()
export class CrosswalkRegistryService {
    protected readonly didChangeEmitter = new Emitter<CrosswalkRegistryEntry[]>()
    readonly onDidChange: Event<CrosswalkRegistryEntry[]> = this.didChangeEmitter.event

    protected operationQueue: Promise<void> = Promise.resolve()

    constructor(
        @inject(CrosswalkRegistryStore) protected readonly store: CrosswalkRegistryStore,
    ) {}

    list(): Promise<CrosswalkRegistryEntry[]> {
        return this.runSerialized(() => this.store.list())
    }

    importFile(uri: URI): Promise<CrosswalkRegistryEntry> {
        return this.runSerialized(async () => {
            const entry = await this.store.importFile(uri)
            this.didChangeEmitter.fire(await this.store.list())
            return entry
        })
    }

    delete(id: string): Promise<void> {
        return this.runSerialized(async () => {
            await this.store.delete(id)
            this.didChangeEmitter.fire(await this.store.list())
        })
    }

    read(id: string): Promise<CrosswalkDocument | undefined> {
        return this.runSerialized(() => this.store.read(id))
    }

    protected runSerialized<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.operationQueue.then(operation, operation)
        this.operationQueue = result.then(() => undefined, () => undefined)
        return result
    }
}

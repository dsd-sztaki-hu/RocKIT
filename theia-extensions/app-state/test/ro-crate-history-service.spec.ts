// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import 'reflect-metadata'
import { StorageService } from '@theia/core/lib/browser/storage-service'
import { Container } from 'inversify'
import { AppStateService } from '../src/browser/state/app-state-service'
import { RoCrateHistoryService } from '../src/browser/state/ro-crate-history-service'
import type { RoCrateApprovalFile } from '../src/browser/state/ro-crate-approval'

(globalThis as any).window = {
  clearTimeout: () => undefined,
  setTimeout: () => 0,
}

class InMemoryStorageService implements StorageService {
  private store = new Map<string, any>()

  async getData<T>(key: string): Promise<T | undefined> {
    return this.store.get(key)
  }

  async setData<T>(key: string, data: T): Promise<void> {
    this.store.set(key, data)
  }
}

const createServices = async () => {
  const container = new Container()
  container.bind(StorageService).to(InMemoryStorageService).inSingletonScope()
  container.bind(AppStateService).toSelf().inSingletonScope()
  container.bind(RoCrateHistoryService).toSelf().inSingletonScope()

  const appStateService = container.get(AppStateService)
  await (appStateService as any).init()

  return {
    appStateService,
    historyService: container.get(RoCrateHistoryService),
  }
}

describe('RoCrateHistoryService', () => {
  it('undoes and redoes approval-only AI decisions', async () => {
    const { appStateService, historyService } = await createServices()
    const pendingApproval: RoCrateApprovalFile = [
      {
        '@id': './',
        approval: [
          {
            propertyName: 'name',
            previousValue: 'Before',
            operation: 'update',
            approved: false,
            timestamp: '2026-06-16T00:00:00.000Z',
          },
        ],
      },
    ]
    const acceptedApproval: RoCrateApprovalFile = [
      {
        '@id': './',
        approval: [
          {
            propertyName: 'name',
            previousValue: 'Before',
            operation: 'update',
            approved: true,
            timestamp: '2026-06-16T00:00:00.000Z',
          },
        ],
      },
    ]

    appStateService.roCrateApproval = pendingApproval
    historyService.clear()

    historyService.applyRoCrateApprovalChange(acceptedApproval, {
      label: 'Accept AI suggestion',
    })

    expect(appStateService.roCrateApproval).toEqual(acceptedApproval)
    expect(historyService.getDebugSnapshot().undoCount).toBe(1)

    historyService.undo()
    expect(appStateService.roCrateApproval).toEqual(pendingApproval)

    historyService.redo()
    expect(appStateService.roCrateApproval).toEqual(acceptedApproval)
  })

  it('groups crate-first AI rejection changes with approval changes', async () => {
    const { appStateService, historyService } = await createServices()
    const beforeCrate = {
      '@graph': [{ '@id': './', '@type': ['Dataset'], name: 'AI value' }],
    }
    const rejectedCrate = {
      '@graph': [{ '@id': './', '@type': ['Dataset'], name: 'Previous value' }],
    }
    const pendingApproval: RoCrateApprovalFile = [
      {
        '@id': './',
        approval: [
          {
            propertyName: 'name',
            previousValue: 'Previous value',
            operation: 'update',
            approved: false,
            timestamp: '2026-06-16T00:00:00.000Z',
          },
        ],
      },
    ]
    const resolvedApproval: RoCrateApprovalFile = []

    appStateService.roCrate = beforeCrate
    appStateService.roCrateApproval = pendingApproval
    historyService.clear()

    historyService.applyRoCrateChange(rejectedCrate, {
      label: 'Reject AI suggestion',
      mergeWithNext: true,
    })
    historyService.applyRoCrateApprovalChange(resolvedApproval, {
      label: 'Reject AI suggestion',
      mergeWithPrevious: true,
    })

    expect(historyService.getDebugSnapshot().undoCount).toBe(1)

    historyService.undo()
    expect(appStateService.roCrate).toEqual(beforeCrate)
    expect(appStateService.roCrateApproval).toEqual(pendingApproval)

    historyService.redo()
    expect(appStateService.roCrate).toEqual(rejectedCrate)
    expect(appStateService.roCrateApproval).toEqual(resolvedApproval)
  })

  it('groups approval-first AI rejection changes with crate changes', async () => {
    const { appStateService, historyService } = await createServices()
    const beforeCrate = {
      '@graph': [{ '@id': './', '@type': ['Dataset'], name: 'AI value' }],
    }
    const rejectedCrate = {
      '@graph': [{ '@id': './', '@type': ['Dataset'], name: 'Previous value' }],
    }
    const pendingApproval: RoCrateApprovalFile = [
      {
        '@id': './',
        approval: [
          {
            propertyName: 'name',
            previousValue: 'Previous value',
            operation: 'update',
            approved: false,
            timestamp: '2026-06-16T00:00:00.000Z',
          },
        ],
      },
    ]
    const resolvedApproval: RoCrateApprovalFile = []

    appStateService.roCrate = beforeCrate
    appStateService.roCrateApproval = pendingApproval
    historyService.clear()

    historyService.applyRoCrateApprovalChange(resolvedApproval, {
      label: 'Reject AI suggestion',
      mergeWithNext: true,
    })
    historyService.applyRoCrateChange(rejectedCrate, {
      label: 'Reject AI suggestion',
    })

    expect(historyService.getDebugSnapshot().undoCount).toBe(1)

    historyService.undo()
    expect(appStateService.roCrate).toEqual(beforeCrate)
    expect(appStateService.roCrateApproval).toEqual(pendingApproval)

    historyService.redo()
    expect(appStateService.roCrate).toEqual(rejectedCrate)
    expect(appStateService.roCrateApproval).toEqual(resolvedApproval)
  })
})

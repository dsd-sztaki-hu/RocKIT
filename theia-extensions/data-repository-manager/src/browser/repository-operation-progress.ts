// Copyright (C) 2026 SZTAKI. SPDX-License-Identifier: Apache-2.0

import { inject, injectable } from 'inversify'
import { generateUuid } from '@theia/core/lib/common/uuid'
import { nls } from '@theia/core/lib/common/nls'
import {
  LoadMaskService,
  type LoadMaskHandle,
  type LoadMaskUpdate,
} from 'rockit-loadmask/lib/browser/loadmask-service'
import {
  RepositoryProviderCommands,
  type RepositoryOperation,
} from './repository-provider-registry'
import type { DataRepositoryConfig } from './types'

export interface RepositoryProgressContext {
  operationId: string
  providerId: string
  commandId: string
}

export interface RepositoryProgressReport {
  operationId: string
  providerId: string
  message?: string
  completedSteps?: number
  totalSteps?: number
  awaitingInput?: boolean
}

interface ActiveOperation {
  context: RepositoryProgressContext
  state: LoadMaskUpdate
  handle?: LoadMaskHandle
  awaitingInput: boolean
}

export const PROGRESS_OPERATIONS = new Set<RepositoryOperation>([
  'create',
  'update',
  'sync',
  'import',
  'link',
  'delete',
])

@injectable()
export class RepositoryOperationProgressService {
  @inject(LoadMaskService)
  protected readonly loadMaskService: LoadMaskService

  protected readonly operations = new Map<string, ActiveOperation>()
  protected readonly scopes = new Map<string, string>()
  protected inputDepth = 0

  protected key(
    repository: DataRepositoryConfig,
    operation: RepositoryOperation,
  ): string {
    return JSON.stringify([repository.id, repository.providerId, operation])
  }

  contextFor(
    repository: DataRepositoryConfig,
    operation: RepositoryOperation,
  ): RepositoryProgressContext | undefined {
    const id = this.scopes.get(this.key(repository, operation))
    return id ? this.operations.get(id)?.context : undefined
  }

  begin(
    repository: DataRepositoryConfig,
    operation: RepositoryOperation,
    message?: string,
  ) {
    if (!PROGRESS_OPERATIONS.has(operation))
      throw new Error('This operation does not have repository progress.')
    const key = this.key(repository, operation)
    if (this.scopes.has(key))
      throw new Error('This repository operation is already running.')
    const context = {
      operationId: generateUuid(),
      providerId: repository.providerId ?? '',
      commandId: RepositoryProviderCommands.REPORT_PROGRESS,
    }
    const labels: Partial<Record<RepositoryOperation, string>> = {
      create: nls.localize(
        'rockit/dataRepository/progress/create',
        'Exporting to {0}...',
        repository.title,
      ),
      update: nls.localize(
        'rockit/dataRepository/progress/update',
        'Updating dataset in {0}...',
        repository.title,
      ),
      sync: nls.localize(
        'rockit/dataRepository/progress/sync',
        'Synchronizing from {0}...',
        repository.title,
      ),
      import: nls.localize(
        'rockit/dataRepository/progress/import',
        'Importing from {0}...',
        repository.title,
      ),
      link: nls.localize(
        'rockit/dataRepository/progress/link',
        'Linking dataset to {0}...',
        repository.title,
      ),
      delete: nls.localize(
        'rockit/dataRepository/progress/delete',
        'Deleting dataset from {0}...',
        repository.title,
      ),
    }
    const active: ActiveOperation = {
      context,
      state: { message: message ?? labels[operation], progress: null },
      awaitingInput: false,
    }
    this.operations.set(context.operationId, active)
    this.scopes.set(key, context.operationId)
    this.render(active)
    const dispose = () => {
      if (!this.operations.delete(context.operationId)) return
      this.scopes.delete(key)
      active.handle?.dispose()
    }
    return {
      context,
      dispose,
      cancel: dispose,
      report: (update: { message?: string; work?: { done: number; total: number } }) =>
        this.report({
          ...context,
          message: update.message,
          completedSteps: update.work?.done,
          totalSteps: update.work?.total,
        }),
      update: (update: LoadMaskUpdate) => {
        active.state = { ...active.state, ...update }
        this.render(active)
      },
    }
  }

  async run<T>(
    repository: DataRepositoryConfig,
    operation: RepositoryOperation,
    task: () => Promise<T>,
  ): Promise<T> {
    if (this.contextFor(repository, operation)) return task()
    const handle = this.begin(repository, operation)
    try {
      return await task()
    } finally {
      handle.dispose()
    }
  }

  report(value: RepositoryProgressReport): void {
    if (!value || typeof value.operationId !== 'string') return
    const active = this.operations.get(value.operationId)
    if (!active || active.context.providerId !== value.providerId) return
    if (typeof value.message === 'string' && value.message.trim())
      active.state.message = value.message
    active.state.progress =
      typeof value.totalSteps === 'number' &&
      Number.isFinite(value.totalSteps) &&
      value.totalSteps > 0 &&
      typeof value.completedSteps === 'number' &&
      Number.isFinite(value.completedSteps)
        ? {
            worked: Math.max(0, Math.min(value.completedSteps, value.totalSteps)),
            total: value.totalSteps,
          }
        : null
    if (typeof value.awaitingInput === 'boolean')
      active.awaitingInput = value.awaitingInput
    this.render(active)
  }

  /** Input dialogs must remain usable while a repository operation is active. */
  async withUserInput<T>(task: () => Promise<T>): Promise<T> {
    this.inputDepth += 1
    this.operations.forEach((active) => this.render(active))
    try {
      return await task()
    } finally {
      this.inputDepth -= 1
      this.operations.forEach((active) => this.render(active))
    }
  }

  protected render(active: ActiveOperation): void {
    if (this.inputDepth || active.awaitingInput) {
      active.handle?.dispose()
      active.handle = undefined
    } else if (active.handle) {
      active.handle.update(active.state)
    } else {
      active.handle = this.loadMaskService.show({
        message: active.state.message,
        progress: active.state.progress ?? undefined,
        delay: 0,
      })
    }
  }
}

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { CommandService } from '@theia/core/lib/common'
import { inject, injectable } from 'inversify'

import {
  RepositoryOperationInvocation,
  RepositoryProviderRegistry,
} from './repository-provider-registry'

/**
 * Application-side entry point for repository operations.
 *
 * RocKIT calls this service without knowing which extension implements the
 * operation. The registered command id is the serializable bridge into the
 * VS Code/Theia plugin host.
 */
@injectable()
export class RepositoryProviderService {
  constructor(
    @inject(RepositoryProviderRegistry)
    protected readonly registry: RepositoryProviderRegistry,
    @inject(CommandService)
    protected readonly commandService: CommandService,
  ) {}

  async execute<TInput = unknown, TResult = unknown>(
    invocation: RepositoryOperationInvocation<TInput>,
  ): Promise<TResult | undefined> {
    const provider = this.registry.get(invocation.providerId)
    if (!provider) {
      throw new Error(`Repository provider '${invocation.providerId}' is not registered.`)
    }

    const commandId = provider.operations[invocation.operation]
    if (!commandId) {
      throw new Error(
        `Repository provider '${invocation.providerId}' does not support '${invocation.operation}'.`,
      )
    }

    return this.commandService.executeCommand<TResult>(commandId, invocation.input)
  }
}

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { injectable } from 'inversify'

export const ROCKIT_REPOSITORY_PROVIDER_PROTOCOL_VERSION = '1.0'

export const RepositoryProviderCommands = {
  REGISTER: 'rockit.repositories.registerProvider',
  UNREGISTER: 'rockit.repositories.unregisterProvider',
  LIST: 'rockit.repositories.listProviders',
  EXECUTE: 'rockit.repositories.executeOperation',
  PROMPT_REQUIRED_METADATA: 'rockit.repositories.promptRequiredMetadata',
} as const

export interface RepositoryRequiredMetadataPrompt {
  kind: 'zenodo-access-policy'
  defaults: Record<string, unknown>
  options: Array<{ value: string; label: string }>
}

export type RepositoryOperation =
  | 'import'
  | 'create'
  | 'update'
  | 'sync'
  | 'delete'
  | 'link'
  | 'validate'
  | 'listTargets'
  | 'markTargetFailed'

export type RepositoryProviderOperations = Partial<Record<RepositoryOperation, string>>

export interface RepositoryProviderImportInput {
  kind: 'url'
  title: string
  description: string
  placeholder?: string
  fieldLabel?: string
}

export interface RepositoryProviderConnection {
  requiresApiKey?: boolean
}

/**
 * Serializable descriptor sent by an installed repository extension.
 *
 * The operation values are VS Code/Theia command identifiers. Keeping
 * executable callbacks out of this object allows it to cross the plugin-host
 * boundary without relying on shared process memory.
 */
export interface RepositoryProviderRegistration {
  id: string
  displayName: string
  extensionId: string
  protocolVersion: string
  operations: RepositoryProviderOperations
  importInput?: RepositoryProviderImportInput
  connection?: RepositoryProviderConnection
}

export interface RepositoryOperationInvocation<TInput = unknown> {
  providerId: string
  operation: RepositoryOperation
  input?: TInput
}

@injectable()
export class RepositoryProviderRegistry {
  protected readonly providers = new Map<string, RepositoryProviderRegistration>()

  register(provider: RepositoryProviderRegistration): void {
    this.validate(provider)

    const existing = this.providers.get(provider.id)
    if (existing && existing.extensionId !== provider.extensionId) {
      throw new Error(
        `Repository provider '${provider.id}' is already registered by '${existing.extensionId}'.`,
      )
    }

    this.providers.set(provider.id, this.copy(provider))
  }

  unregister(providerId: string, extensionId?: string): boolean {
    const existing = this.providers.get(providerId)
    if (!existing || (extensionId && existing.extensionId !== extensionId)) {
      return false
    }
    return this.providers.delete(providerId)
  }

  get(providerId: string): RepositoryProviderRegistration | undefined {
    const provider = this.providers.get(providerId)
    return provider ? this.copy(provider) : undefined
  }

  list(): RepositoryProviderRegistration[] {
    return Array.from(this.providers.values(), (provider) => this.copy(provider))
  }

  protected validate(provider: RepositoryProviderRegistration): void {
    if (!provider || typeof provider !== 'object') {
      throw new Error('Repository provider registration must be an object.')
    }
    if (!this.isIdentifier(provider.id)) {
      throw new Error(`Invalid repository provider id '${String(provider.id)}'.`)
    }
    if (!provider.displayName?.trim()) {
      throw new Error('Repository provider display name is required.')
    }
    if (!this.isExtensionId(provider.extensionId)) {
      throw new Error(
        `Invalid repository provider extension id '${String(provider.extensionId)}'.`,
      )
    }
    if (provider.protocolVersion !== ROCKIT_REPOSITORY_PROVIDER_PROTOCOL_VERSION) {
      throw new Error(
        `Unsupported repository provider protocol version '${provider.protocolVersion}'. ` +
          `Expected '${ROCKIT_REPOSITORY_PROVIDER_PROTOCOL_VERSION}'.`,
      )
    }
    if (!provider.operations || typeof provider.operations !== 'object') {
      throw new Error('Repository provider operations are required.')
    }

    const operationNames: RepositoryOperation[] = [
      'import',
      'create',
      'update',
      'sync',
      'delete',
      'link',
      'validate',
      'listTargets',
      'markTargetFailed',
    ]
    const supportedOperations = operationNames.filter(
      (operation) => provider.operations[operation] !== undefined,
    )
    if (supportedOperations.length === 0) {
      throw new Error(
        `Repository provider '${provider.id}' must implement at least one operation.`,
      )
    }
    for (const operation of supportedOperations) {
      if (!this.isCommandId(provider.operations[operation])) {
        throw new Error(
          `Repository provider '${provider.id}' has an invalid command for '${operation}'.`,
        )
      }
    }
    if (provider.importInput) {
      if (!provider.operations.import) {
        throw new Error(
          `Repository provider '${provider.id}' declares import input without an import operation.`,
        )
      }
      if (
        provider.importInput.kind !== 'url' ||
        !provider.importInput.title?.trim() ||
        !provider.importInput.description?.trim()
      ) {
        throw new Error(
          `Repository provider '${provider.id}' has an invalid import input descriptor.`,
        )
      }
    }
    if (
      provider.connection &&
      (typeof provider.connection !== 'object' ||
        (provider.connection.requiresApiKey !== undefined &&
          typeof provider.connection.requiresApiKey !== 'boolean'))
    ) {
      throw new Error(
        `Repository provider '${provider.id}' has an invalid connection descriptor.`,
      )
    }
  }

  protected copy(
    provider: RepositoryProviderRegistration,
  ): RepositoryProviderRegistration {
    return {
      ...provider,
      operations: { ...provider.operations },
      importInput: provider.importInput ? { ...provider.importInput } : undefined,
      connection: provider.connection ? { ...provider.connection } : undefined,
    }
  }

  protected isIdentifier(value: unknown): value is string {
    return typeof value === 'string' && /^[a-z0-9][a-z0-9.-]*$/.test(value)
  }

  protected isExtensionId(value: unknown): value is string {
    return (
      typeof value === 'string' && /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i.test(value)
    )
  }

  protected isCommandId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.includes('.')
  }
}

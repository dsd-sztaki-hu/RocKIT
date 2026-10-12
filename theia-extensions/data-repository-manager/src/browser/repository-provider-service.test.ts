// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { CommandService } from '@theia/core/lib/common'

import { RepositoryProviderRegistry } from './repository-provider-registry'
import { RepositoryProviderService } from './repository-provider-service'

describe('RepositoryProviderService', () => {
  const createService = () => {
    const registry = new RepositoryProviderRegistry()
    registry.register({
      id: 'test-repository',
      displayName: 'Test Repository',
      extensionId: 'rockit.test-repository-provider',
      protocolVersion: '1.0',
      operations: { create: 'rockit.testRepository.create' },
    })

    const executeCommand = jest.fn().mockResolvedValue({ remoteId: 'test-123' })
    const commandService = { executeCommand } as unknown as CommandService

    return {
      service: new RepositoryProviderService(registry, commandService),
      executeCommand,
    }
  }

  it('routes an operation to the command registered by the provider', async () => {
    const { service, executeCommand } = createService()
    const input = { title: 'Boundary test' }

    await expect(
      service.execute({ providerId: 'test-repository', operation: 'create', input }),
    ).resolves.toEqual({ remoteId: 'test-123' })
    expect(executeCommand).toHaveBeenCalledWith('rockit.testRepository.create', input)
  })

  it('rejects an unknown provider', async () => {
    const { service, executeCommand } = createService()

    await expect(
      service.execute({ providerId: 'missing', operation: 'create' }),
    ).rejects.toThrow("Repository provider 'missing' is not registered")
    expect(executeCommand).not.toHaveBeenCalled()
  })

  it('rejects an operation the provider did not declare', async () => {
    const { service, executeCommand } = createService()

    await expect(
      service.execute({ providerId: 'test-repository', operation: 'import' }),
    ).rejects.toThrow("Repository provider 'test-repository' does not support 'import'")
    expect(executeCommand).not.toHaveBeenCalled()
  })
})

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { CommandService } from '@theia/core/lib/common'
import { CrosswalkRegistryService } from 'crosswalk-manager/lib/browser/crosswalk-registry-service'

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
    const readCrosswalk = jest.fn().mockResolvedValue(undefined)
    const crosswalkRegistryService = {
      read: readCrosswalk,
    } as unknown as CrosswalkRegistryService

    return {
      service: new RepositoryProviderService(
        registry,
        commandService,
        crosswalkRegistryService,
      ),
      executeCommand,
      readCrosswalk,
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

  it('resolves the selected crosswalk for metadata operations', async () => {
    const { service, executeCommand, readCrosswalk } = createService()
    const document = { id: 'test-crosswalk', name: 'Test Crosswalk' }
    readCrosswalk.mockResolvedValue(document)
    const repository = {
      id: 'connection-1',
      title: 'My Test Repository',
      baseUrl: 'https://example.invalid',
      providerId: 'test-repository',
      crosswalkId: 'test-crosswalk',
    }

    await service.executeForRepository(repository, 'create', { repository })

    expect(readCrosswalk).toHaveBeenCalledWith('test-crosswalk')
    expect(executeCommand).toHaveBeenCalledWith('rockit.testRepository.create', {
      repository,
      crosswalk: { id: 'test-crosswalk', document },
    })
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

  it('resolves capabilities and executes through an associated repository connection', async () => {
    const { service, executeCommand } = createService()
    const repository = {
      id: 'connection-1',
      title: 'My Test Repository',
      baseUrl: 'https://example.invalid',
      providerId: 'test-repository',
    }

    expect(service.supports(repository, 'create')).toBe(true)
    expect(service.supports(repository, 'import')).toBe(false)
    await expect(
      service.executeForRepository(repository, 'create', { title: 'Dataset' }),
    ).resolves.toEqual({ remoteId: 'test-123' })
    expect(executeCommand).toHaveBeenCalledWith('rockit.testRepository.create', {
      title: 'Dataset',
    })
  })

  it('keeps legacy repository connections outside plugin dispatch', async () => {
    const { service, executeCommand } = createService()
    const repository = {
      id: 'legacy-connection',
      title: 'Existing Repository',
      baseUrl: 'https://example.invalid',
    }

    expect(service.getProviderForRepository(repository)).toBeUndefined()
    expect(service.supports(repository, 'create')).toBe(false)
    await expect(service.executeForRepository(repository, 'create')).rejects.toThrow(
      "Repository connection 'legacy-connection' is not associated with an extension provider",
    )
    expect(executeCommand).not.toHaveBeenCalled()
  })
})

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { CommandService } from '@theia/core/lib/common'
import URI from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service'
import type { CrosswalkRegistry } from 'crosswalk-manager/lib/browser/crosswalk-registry'

import { RepositoryProviderRegistry } from './repository-provider-registry'
import { RepositoryProviderService } from './repository-provider-service'
import { RepositoryCrosswalkService } from './services/repository-crosswalk-service'

jest.mock('@theia/workspace/lib/browser/workspace-service', () => ({
  WorkspaceService: class WorkspaceService {},
}))
jest.mock('./services/repository-crosswalk-service', () => ({
  RepositoryCrosswalkService: class RepositoryCrosswalkService {},
}))

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
    } as unknown as CrosswalkRegistry

    return {
      service: new RepositoryProviderService(
        registry,
        commandService,
        crosswalkRegistryService,
        {} as RepositoryCrosswalkService,
        {} as FileService,
        {} as WorkspaceService,
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

  it('validates the selected crosswalk and sends only its id to providers', async () => {
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
      crosswalkId: 'test-crosswalk',
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

  it('maps Zenodo export metadata before invoking the provider', async () => {
    const registry = new RepositoryProviderRegistry()
    registry.register({
      id: 'zenodo', displayName: 'Zenodo', extensionId: 'SZTAKI-DSD.zenodo-repository-provider',
      protocolVersion: '1.0', operations: { create: 'rockit.zenodo.create' },
    })
    const calls: string[] = []
    const executeCommand = jest.fn(async () => {
      calls.push('provider')
      return { remoteId: '42' }
    })
    const crosswalkService = {
      prepareRepositoryMetadata: jest.fn(async () => {
        calls.push('map')
        return { title: 'Mapped title', creators: [{ name: 'Alice' }] }
      }),
    }
    const fileService = {
      readFile: jest.fn(async () => ({ value: { toString: () => JSON.stringify({ '@graph': [] }) } })),
    }
    const workspaceService = { tryGetRoots: () => [{ resource: new URI('file:///workspace') }] }
    const service = new RepositoryProviderService(
      registry,
      { executeCommand } as unknown as CommandService,
      { read: async () => ({ id: 'example' }) } as unknown as CrosswalkRegistry,
      crosswalkService as unknown as RepositoryCrosswalkService,
      fileService as unknown as FileService,
      workspaceService as unknown as WorkspaceService,
    )
    const repository = {
      id: 'zenodo-connection', title: 'Zenodo', baseUrl: 'https://zenodo.org',
      providerId: 'zenodo', crosswalkId: 'example',
    }

    await service.executeForRepository(repository, 'create', { repository })

    expect(calls).toEqual(['map', 'provider'])
    expect(executeCommand).toHaveBeenCalledWith('rockit.zenodo.create', {
      repository,
      crosswalkId: 'example',
      repositoryMetadata: { title: 'Mapped title', creators: [{ name: 'Alice' }] },
    })
  })

  it('passes root metadata through without a crosswalk before Zenodo export', async () => {
    const registry = new RepositoryProviderRegistry()
    registry.register({
      id: 'zenodo', displayName: 'Zenodo', extensionId: 'SZTAKI-DSD.zenodo-repository-provider',
      protocolVersion: '1.0', operations: { create: 'rockit.zenodo.create' },
    })
    const executeCommand = jest.fn().mockResolvedValue({ remoteId: '42' })
    const crosswalkService = { prepareRepositoryMetadata: jest.fn() }
    const crate = { '@graph': [{ '@id': './', '@type': 'Dataset', title: 'Native title', creators: [{ name: 'Alice' }] }] }
    const service = new RepositoryProviderService(
      registry,
      { executeCommand } as unknown as CommandService,
      { read: jest.fn() } as unknown as CrosswalkRegistry,
      crosswalkService as unknown as RepositoryCrosswalkService,
      { readFile: async () => ({ value: { toString: () => JSON.stringify(crate) } }) } as unknown as FileService,
      { tryGetRoots: () => [{ resource: new URI('file:///workspace') }] } as unknown as WorkspaceService,
    )
    const repository = {
      id: 'zenodo-connection', title: 'Zenodo', baseUrl: 'https://zenodo.org', providerId: 'zenodo',
    }

    await service.executeForRepository(repository, 'create', { repository })

    expect(crosswalkService.prepareRepositoryMetadata).not.toHaveBeenCalled()
    expect(executeCommand).toHaveBeenCalledWith('rockit.zenodo.create', {
      repository,
      repositoryMetadata: { title: 'Native title', creators: [{ name: 'Alice' }] },
    })
  })

  it('maps imported Zenodo metadata after the provider returns and before opening the workspace', async () => {
    const registry = new RepositoryProviderRegistry()
    registry.register({
      id: 'zenodo', displayName: 'Zenodo', extensionId: 'SZTAKI-DSD.zenodo-repository-provider',
      protocolVersion: '1.0', operations: { import: 'rockit.zenodo.import' },
    })
    const calls: string[] = []
    const executeCommand = jest.fn(async () => {
      calls.push('provider')
      return {
        importedWorkspaceUri: 'file:///imports/zenodo-42',
        remoteId: '42', landingPage: 'https://zenodo.org/uploads/42', mappingFile: 'mapping.json',
        crate: { '@graph': [{ '@id': './', name: 'Original' }] },
        repositoryMetadata: { title: 'Remote title' },
      }
    })
    const crosswalkService = {
      applyRepositoryMetadata: jest.fn(async () => {
        calls.push('map')
        return { crate: { '@graph': [{ '@id': './', name: 'Original', title: 'Remote title' }] }, updatedFields: ['title'] }
      }),
    }
    const fileService = {
      readFile: jest.fn(async () => ({ value: { toString: () => '[]' } })),
      writeFile: jest.fn(async () => { calls.push('write') }),
    }
    const workspaceService = {
      tryGetRoots: () => [],
      open: jest.fn(() => { calls.push('open') }),
    }
    const service = new RepositoryProviderService(
      registry,
      { executeCommand } as unknown as CommandService,
      { read: async () => ({ id: 'example' }) } as unknown as CrosswalkRegistry,
      crosswalkService as unknown as RepositoryCrosswalkService,
      fileService as unknown as FileService,
      workspaceService as unknown as WorkspaceService,
    )
    const repository = {
      id: 'zenodo-connection', title: 'Zenodo', baseUrl: 'https://zenodo.org',
      providerId: 'zenodo', crosswalkId: 'example',
    }

    const result = await service.executeForRepository(repository, 'import', { repository })

    expect(calls).toEqual(['provider', 'map', 'write', 'write', 'open'])
    expect(result).toMatchObject({ openedWorkspace: true, remoteId: '42' })
    expect(result).not.toHaveProperty('crate')
  })

  it('preserves the imported RO-Crate without a crosswalk', async () => {
    const registry = new RepositoryProviderRegistry()
    registry.register({
      id: 'zenodo', displayName: 'Zenodo', extensionId: 'SZTAKI-DSD.zenodo-repository-provider',
      protocolVersion: '1.0', operations: { import: 'rockit.zenodo.import' },
    })
    const crate = { '@graph': [{ '@id': './', name: 'Unmapped title' }] }
    const applyRepositoryMetadata = jest.fn()
    const writeFile = jest.fn()
    const service = new RepositoryProviderService(
      registry,
      { executeCommand: async () => ({
        importedWorkspaceUri: 'file:///imports/zenodo-42', remoteId: '42',
        crate, repositoryMetadata: { title: 'Remote title' },
      }) } as unknown as CommandService,
      { read: jest.fn() } as unknown as CrosswalkRegistry,
      { applyRepositoryMetadata } as unknown as RepositoryCrosswalkService,
      { readFile: async () => ({ value: { toString: () => '[]' } }), writeFile } as unknown as FileService,
      { open: jest.fn() } as unknown as WorkspaceService,
    )
    const repository = {
      id: 'zenodo-connection', title: 'Zenodo', baseUrl: 'https://zenodo.org', providerId: 'zenodo',
    }

    await service.executeForRepository(repository, 'import', { repository })

    expect(applyRepositoryMetadata).not.toHaveBeenCalled()
    expect(JSON.parse(writeFile.mock.calls[0][1].toString())).toEqual(crate)
  })

  it('maps remote metadata before applying the selected sync merge policy', async () => {
    const registry = new RepositoryProviderRegistry()
    registry.register({
      id: 'zenodo', displayName: 'Zenodo', extensionId: 'SZTAKI-DSD.zenodo-repository-provider',
      protocolVersion: '1.0', operations: { sync: 'rockit.zenodo.sync' },
    })
    const localCrate = {
      '@graph': [{ '@id': './', name: 'Local title' }, { '@id': '#local', name: 'Local only' }],
    }
    const remoteCrate = { '@graph': [{ '@id': './', name: 'Uploaded title' }] }
    const executeCommand = jest.fn(async () => ({
      remoteId: '42', landingPage: 'https://zenodo.org/uploads/42', mappingFile: 'mapping.json',
      localCrate, remoteCrate, repositoryMetadata: { title: 'Remote title' },
      metadataSource: 'local-additions',
    }))
    const crosswalkService = {
      applyRepositoryMetadata: jest.fn(async () => ({
        crate: { '@graph': [{ '@id': './', name: 'Uploaded title', title: 'Remote title' }] },
        updatedFields: ['title'],
      })),
    }
    const writes: string[] = []
    const fileService = {
      readFile: jest.fn(async () => ({ value: { toString: () => '[]' } })),
      writeFile: jest.fn(async (_uri, content) => { writes.push(content.toString()) }),
    }
    const service = new RepositoryProviderService(
      registry,
      { executeCommand } as unknown as CommandService,
      { read: async () => ({ id: 'example' }) } as unknown as CrosswalkRegistry,
      crosswalkService as unknown as RepositoryCrosswalkService,
      fileService as unknown as FileService,
      { tryGetRoots: () => [{ resource: new URI('file:///workspace') }] } as unknown as WorkspaceService,
    )
    const repository = {
      id: 'zenodo-connection', title: 'Zenodo', baseUrl: 'https://zenodo.org',
      providerId: 'zenodo', crosswalkId: 'example',
    }

    const result = await service.executeForRepository(repository, 'sync', { repository })

    expect(crosswalkService.applyRepositoryMetadata).toHaveBeenCalledWith({
      repositoryType: 'zenodo', crosswalkId: 'example', crate: remoteCrate,
      metadata: { title: 'Remote title' },
    })
    const savedCrate = JSON.parse(writes[0])
    expect(savedCrate['@graph']).toEqual([
      { '@id': './', name: 'Uploaded title', title: 'Remote title' },
      { '@id': '#local', name: 'Local only' },
    ])
    expect(result).toMatchObject({ updatedMetadataFields: ['title'] })
  })

  it('merges the remote RO-Crate without mapping when sync has no crosswalk', async () => {
    const registry = new RepositoryProviderRegistry()
    registry.register({
      id: 'zenodo', displayName: 'Zenodo', extensionId: 'SZTAKI-DSD.zenodo-repository-provider',
      protocolVersion: '1.0', operations: { sync: 'rockit.zenodo.sync' },
    })
    const localCrate = { '@graph': [{ '@id': './', name: 'Local' }] }
    const remoteCrate = { '@graph': [{ '@id': './', name: 'Remote' }] }
    const applyRepositoryMetadata = jest.fn()
    const writeFile = jest.fn()
    const service = new RepositoryProviderService(
      registry,
      { executeCommand: async () => ({
        remoteId: '42', metadataSource: 'complete', localCrate, remoteCrate,
        repositoryMetadata: { title: 'Ignored without a crosswalk' },
      }) } as unknown as CommandService,
      { read: jest.fn() } as unknown as CrosswalkRegistry,
      { applyRepositoryMetadata } as unknown as RepositoryCrosswalkService,
      { readFile: async () => ({ value: { toString: () => '[]' } }), writeFile } as unknown as FileService,
      { tryGetRoots: () => [{ resource: new URI('file:///workspace') }] } as unknown as WorkspaceService,
    )
    const repository = {
      id: 'zenodo-connection', title: 'Zenodo', baseUrl: 'https://zenodo.org', providerId: 'zenodo',
    }

    const result = await service.executeForRepository(repository, 'sync', { repository })

    expect(applyRepositoryMetadata).not.toHaveBeenCalled()
    expect(JSON.parse(writeFile.mock.calls[0][1].toString())).toEqual(remoteCrate)
    expect(result).toMatchObject({ updatedMetadataFields: [] })
  })
})

// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import {
  RepositoryProviderRegistration,
  RepositoryProviderRegistry,
  ROCKIT_REPOSITORY_PROVIDER_PROTOCOL_VERSION,
} from './repository-provider-registry'

const testProvider = (): RepositoryProviderRegistration => ({
  id: 'test-repository',
  displayName: 'Test Repository',
  extensionId: 'rockit.test-repository-provider',
  protocolVersion: ROCKIT_REPOSITORY_PROVIDER_PROTOCOL_VERSION,
  operations: {
    create: 'rockit.testRepository.create',
  },
})

describe('RepositoryProviderRegistry', () => {
  it('registers and lists a provider without exposing mutable internal state', () => {
    const registry = new RepositoryProviderRegistry()
    const provider = testProvider()

    registry.register(provider)
    provider.operations.create = 'changed.command'

    expect(registry.list()).toEqual([testProvider()])
  })

  it('allows the owning extension to replace its registration', () => {
    const registry = new RepositoryProviderRegistry()
    registry.register(testProvider())

    registry.register({
      ...testProvider(),
      displayName: 'Updated Test Repository',
      operations: { import: 'rockit.testRepository.import' },
    })

    expect(registry.get('test-repository')).toEqual({
      ...testProvider(),
      displayName: 'Updated Test Repository',
      operations: { import: 'rockit.testRepository.import' },
    })
  })

  it('rejects a conflicting provider id from another extension', () => {
    const registry = new RepositoryProviderRegistry()
    registry.register(testProvider())

    expect(() =>
      registry.register({
        ...testProvider(),
        extensionId: 'example.other-extension',
      }),
    ).toThrow("already registered by 'rockit.test-repository-provider'")
  })

  it('rejects unsupported protocol versions and empty operation sets', () => {
    const registry = new RepositoryProviderRegistry()

    expect(() =>
      registry.register({
        ...testProvider(),
        protocolVersion: '2.0',
      }),
    ).toThrow("Unsupported repository provider protocol version '2.0'")

    expect(() =>
      registry.register({
        ...testProvider(),
        operations: {},
      }),
    ).toThrow('must implement at least one operation')
  })

  it('only allows the owning extension to unregister a provider', () => {
    const registry = new RepositoryProviderRegistry()
    registry.register(testProvider())

    expect(registry.unregister('test-repository', 'example.other-extension')).toBe(false)
    expect(
      registry.unregister('test-repository', 'rockit.test-repository-provider'),
    ).toBe(true)
    expect(registry.list()).toEqual([])
  })
})

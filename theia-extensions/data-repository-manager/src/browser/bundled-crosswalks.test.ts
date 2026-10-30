// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { EnvVariablesServer } from '@theia/core/lib/common/env-variables'
import URI from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { Container } from '@theia/core/shared/inversify'
import { BundledCrosswalk } from 'crosswalk-manager/lib/browser/crosswalk-manager-types'
import { CrosswalkRegistryStore } from 'crosswalk-manager/lib/browser/crosswalk-registry-store'
import { readUtf8TextFile, writeUtf8TextFile } from 'rockit-common/lib/browser'
import { BUNDLED_REPOSITORY_CROSSWALKS } from './bundled-crosswalks'

jest.mock('rockit-common/lib/browser', () => ({
  readUtf8TextFile: jest.fn(),
  writeUtf8TextFile: jest.fn(),
}))

describe('Bundled repository crosswalks', () => {
  const setup = () => {
    const files = new Map<string, string>()
    jest.mocked(readUtf8TextFile).mockImplementation(async (_service, uri) => {
      const content = files.get(uri.path.toString())
      if (content === undefined) throw new Error('File not found')
      return content
    })
    jest.mocked(writeUtf8TextFile).mockImplementation(async (_service, uri, content) => {
      files.set(uri.path.toString(), content)
    })
    const deleteFile = jest.fn(async (uri: URI) => { files.delete(uri.path.toString()) })
    const fileService = {
      exists: jest.fn(async (uri: URI) => files.has(uri.path.toString())),
      createFolder: jest.fn(),
      delete: deleteFile,
    } as unknown as FileService
    const environment = {
      getValue: jest.fn(async () => ({ value: '/rockit' })),
    } as unknown as EnvVariablesServer
    const container = new Container()
    container.bind(FileService).toConstantValue(fileService)
    container.bind(EnvVariablesServer).toConstantValue(environment)
    for (const crosswalk of BUNDLED_REPOSITORY_CROSSWALKS) {
      container.bind<BundledCrosswalk>(BundledCrosswalk).toConstantValue(crosswalk)
    }
    container.bind(CrosswalkRegistryStore).toSelf()
    return {
      files,
      deleteFile,
      store: container.get(CrosswalkRegistryStore),
    }
  }

  beforeEach(() => jest.clearAllMocks())

  it('lists and resolves both defaults on a fresh install without copying files', async () => {
    const { store, files } = setup()
    const entries = await store.list()

    expect(entries.map(entry => entry.id).sort()).toEqual(['arp-dataverse', 'arp-zenodo'])
    expect(entries.every(entry => entry.builtIn && entry.ruleCount! > 0)).toBe(true)
    for (const bundled of BUNDLED_REPOSITORY_CROSSWALKS) {
      expect(await store.read(bundled.document.id)).toEqual(bundled.document)
    }
    expect(files.size).toBe(0)
    expect(writeUtf8TextFile).not.toHaveBeenCalled()
  })

  it('protects defaults against deletion and importing a conflicting ID', async () => {
    const { store, files, deleteFile } = setup()
    for (const bundled of BUNDLED_REPOSITORY_CROSSWALKS) {
      await expect(store.delete(bundled.document.id)).rejects.toThrow('cannot be deleted')
      files.set('/import.json', JSON.stringify(bundled.document))
      await expect(store.importFile(new URI('file:///import.json'))).rejects.toThrow('already registered')
    }
    expect(deleteFile).not.toHaveBeenCalled()
    expect(writeUtf8TextFile).not.toHaveBeenCalled()
  })

  it('shows previously imported defaults once and resolves the bundled version', async () => {
    const { store, files } = setup()
    files.set('/rockit/crosswalk-files/index.json', JSON.stringify({
      version: 1,
      crosswalks: [{
        id: 'arp-zenodo', name: 'Old copy', fileName: 'old.json',
        sourceFileName: 'old.json', importedAt: '2026-10-16T10:00:00Z',
      }],
    }))

    const entries = await store.list()
    expect(entries.filter(entry => entry.id === 'arp-zenodo')).toHaveLength(1)
    expect(entries.find(entry => entry.id === 'arp-zenodo')?.builtIn).toBe(true)
    expect((await store.read('arp-zenodo'))?.name).toBe('ARP - Zenodo')
    expect(writeUtf8TextFile).not.toHaveBeenCalled()
  })

  it('keeps custom crosswalks importable, readable and deletable', async () => {
    const { store, files, deleteFile } = setup()
    const custom = { id: 'custom', name: 'Custom crosswalk', crosswalks: {} }
    files.set('/import.json', JSON.stringify(custom))

    await store.importFile(new URI('file:///import.json'))
    expect(await store.read('custom')).toEqual(custom)
    expect((await store.list()).find(entry => entry.id === 'custom')?.builtIn).toBe(false)
    await store.delete('custom')
    expect(deleteFile).toHaveBeenCalledTimes(1)
    expect(await store.read('custom')).toBeUndefined()
    expect(await store.list()).toHaveLength(2)
  })
})

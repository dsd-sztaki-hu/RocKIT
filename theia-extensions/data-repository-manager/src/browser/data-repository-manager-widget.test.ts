// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import 'reflect-metadata'

const mockConfigDialogOpen = jest.fn()
const mockConfigDialogConstructor = jest.fn()
const mockDeleteDialogOpen = jest.fn()

jest.mock('./components/data-repository-config-dialog', () => ({
  DataRepositoryConfigDialog: class DataRepositoryConfigDialog {
    constructor(...args: unknown[]) {
      mockConfigDialogConstructor(...args)
    }

    open() {
      return mockConfigDialogOpen()
    }
  },
}))

jest.mock('./components/data-repository-delete-dialog', () => ({
  DataRepositoryDeleteDialog: class DataRepositoryDeleteDialog {
    open() {
      return mockDeleteDialogOpen()
    }
  },
}))

jest.mock('rockit-common/lib/browser', () => ({
  buildDocumentationUrl: jest.fn((version: string, page: string) =>
    `https://docs.example/${version}/${page}`),
  ROCKIT_DOCUMENTATION_PAGES: {
    REPOSITORY_EXPORT_IMPORT: 'repository-export-import',
  },
}))

jest.mock('@theia/workspace/lib/browser', () => ({
  WorkspaceService: class WorkspaceService {},
}))

jest.mock('app-state/lib/browser/state/app-state-service', () => ({
  AppStateService: class AppStateService {},
}))

jest.mock('app-state/lib/browser/state/ro-crate-loader', () => ({
  RoCrateLoaderContribution: class RoCrateLoaderContribution {},
}))

jest.mock('rockit-loadmask/lib/browser/loadmask-service', () => ({
  LoadMaskService: class LoadMaskService {},
}))

jest.mock('./repository-provider-service', () => ({
  RepositoryProviderService: class RepositoryProviderService {},
}))

jest.mock('crosswalk-manager/lib/browser/crosswalk-registry', () => ({
  CrosswalkRegistry: class CrosswalkRegistry {},
}))

jest.mock('./services/arp-ro-crate-export-service', () => ({
  ArpRoCrateExportService: class ArpRoCrateExportService {},
}))

jest.mock('./services/arp-ro-crate-import-service', () => ({
  ArpRoCrateImportService: class ArpRoCrateImportService {},
}))

jest.mock('./services/arp-ro-crate-link-service', () => ({
  ArpRoCrateLinkService: class ArpRoCrateLinkService {},
}))

jest.mock('./services/data-repository-export-delete-service', () => ({
  DataRepositoryExportDeleteService: class DataRepositoryExportDeleteService {},
}))

jest.mock('./services/data-repository-store-service', () => ({
  DataRepositoryStoreService: class DataRepositoryStoreService {},
}))

jest.mock('./services/native-dataverse-export-service', () => ({
  NativeDataverseExportService: class NativeDataverseExportService {},
}))

jest.mock('./services/native-dataverse-import-service', () => ({
  NativeDataverseImportService: class NativeDataverseImportService {},
}))

import { DataRepositoryManagerWidget } from './data-repository-manager-widget'
import type { DataRepositoryConfig } from './types'

const repository: DataRepositoryConfig = {
  id: 'repository-1',
  title: 'Demo Dataverse',
  baseUrl: 'https://demo.dataverse.org',
  apiKey: 'secret',
  providerId: 'dataverse',
  crosswalkId: 'arp-dataverse',
}

const createWidget = () => {
  const storeService = {
    onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    loadRepositories: jest.fn().mockResolvedValue([repository]),
    saveRepository: jest.fn().mockResolvedValue(undefined),
    deleteRepositories: jest.fn().mockResolvedValue(undefined),
  }
  const providers = [{
    id: 'dataverse',
    displayName: 'Dataverse',
    extensionId: 'rockit.dataverse-repository-provider',
    protocolVersion: '1.0',
    operations: { validate: 'rockit.dataverse.validate' },
  }]
  const providerService = {
    listProviders: jest.fn(() => providers),
  }
  const crosswalks = [{
    id: 'arp-dataverse',
    name: 'ARP - Dataverse',
    importedAt: '2026-10-26T00:00:00.000Z',
    ruleCount: 1,
  }]
  const crosswalkRegistryService = {
    list: jest.fn().mockResolvedValue(crosswalks),
  }
  const workspaceService = { tryGetRoots: jest.fn(() => []) }

  const widget = new DataRepositoryManagerWidget(
    { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
    storeService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    workspaceService as any,
    providerService as any,
    crosswalkRegistryService as any,
  ) as any
  widget.update = jest.fn()

  return {
    widget,
    storeService,
    providerService,
    crosswalkRegistryService,
    providers,
    crosswalks,
  }
}

describe('DataRepositoryManagerWidget', () => {
  beforeEach(() => {
    mockConfigDialogOpen.mockReset()
    mockConfigDialogConstructor.mockClear()
    mockDeleteDialogOpen.mockReset()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('loads repository connections and clears stale table selection', async () => {
    const { widget, storeService } = createWidget()
    widget.selectedKeys = ['stale-selection']

    await widget.loadData()

    expect(storeService.loadRepositories).toHaveBeenCalledTimes(1)
    expect(widget.repositories).toEqual([repository])
    expect(widget.selectedKeys).toEqual([])
    expect(widget.isLoading).toBe(false)
    expect(widget.update).toHaveBeenCalledTimes(2)
  })

  it('leaves the widget usable when loading stored repositories fails', async () => {
    const { widget, storeService } = createWidget()
    const error = new Error('storage unavailable')
    storeService.loadRepositories.mockRejectedValueOnce(error)
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await widget.loadData()
    } finally {
      errorSpy.mockRestore()
    }

    expect(widget.isLoading).toBe(false)
    expect(widget.repositories).toEqual([])
    expect(widget.update).toHaveBeenCalledTimes(2)
  })

  it('opens repository creation with only registered plugin providers and crosswalks', async () => {
    const {
      widget,
      storeService,
      providerService,
      crosswalkRegistryService,
      providers,
      crosswalks,
    } = createWidget()
    mockConfigDialogOpen.mockResolvedValue(repository)

    await widget.handleAddRepository()

    expect(providerService.listProviders).toHaveBeenCalledTimes(1)
    expect(crosswalkRegistryService.list).toHaveBeenCalledTimes(1)
    expect(mockConfigDialogConstructor).toHaveBeenCalledWith(
      undefined,
      providers,
      providerService,
      crosswalks,
    )
    expect(storeService.saveRepository).toHaveBeenCalledWith(repository)
  })

  it('does not save a repository when the plugin-backed dialog is cancelled', async () => {
    const { widget, storeService } = createWidget()
    mockConfigDialogOpen.mockResolvedValue(undefined)

    await widget.handleAddRepository()

    expect(storeService.saveRepository).not.toHaveBeenCalled()
  })

  it('deletes selected repositories only after confirmation', async () => {
    const { widget, storeService } = createWidget()
    widget.selectedKeys = ['repository-1', 42]
    mockDeleteDialogOpen.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await widget.handleDeleteSelected()
    expect(storeService.deleteRepositories).not.toHaveBeenCalled()
    expect(widget.selectedKeys).toEqual(['repository-1', 42])

    await widget.handleDeleteSelected()
    expect(storeService.deleteRepositories).toHaveBeenCalledWith(['repository-1', '42'])
    expect(widget.selectedKeys).toEqual([])
  })

  it.each([
    ['https://zenodo.org/uploads/123', 'https://zenodo.org/uploads/123'],
    ['hdl:21.11116/0000-000A-1234', 'https://hdl.handle.net/21.11116/0000-000A-1234'],
    ['21.11116/0000-000A-1234', 'https://hdl.handle.net/21.11116/0000-000A-1234'],
    ['doi:10.1234/example', undefined],
    ['', undefined],
  ])('normalizes an export target safely: %s', (target, expected) => {
    const { widget } = createWidget()

    expect(widget.externalTargetUrl(target)).toBe(expected)
  })
})

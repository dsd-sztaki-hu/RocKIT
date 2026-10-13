// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import 'reflect-metadata'

jest.mock('@theia/workspace/lib/browser', () => ({
  WorkspaceCommands: { CLOSE: { id: 'workspace.close' } },
  WorkspaceService: class WorkspaceService {},
}))
jest.mock('@theia/filesystem/lib/browser/file-service', () => ({
  FileService: class FileService {},
}))
jest.mock('rockit-common/lib/browser', () => ({
  MetadataProfileManager: class MetadataProfileManager {},
  RoCrateHtmlGenerator: class RoCrateHtmlGenerator {},
  readUtf8TextFile: jest.fn(),
  writeUtf8TextFile: jest.fn(),
}))
jest.mock('rockit-common/lib/common/ro-crate-entity-name', () => ({
  findMissingRoCrateEntityNames: jest.fn().mockReturnValue([]),
  repairMissingRoCrateEntityNames: jest.fn((crate) => crate),
}))
jest.mock('../src/browser/state/ro-crate-dialog', () => ({
  ROCrateDialog: class ROCrateDialog {},
}))
jest.mock('../src/browser/state/ro-crate-id-conversion-dialog', () => ({
  RoCrateIdConversionDialog: class RoCrateIdConversionDialog {},
}))
jest.mock('../src/browser/state/ro-crate-missing-names-dialog', () => ({
  RoCrateMissingNamesDialog: class RoCrateMissingNamesDialog {},
}))

import { URI } from '@theia/core/lib/common/uri'
import {
  ROCrateExternalChangeAction,
  type ROCrateExternalChangeActionValue,
} from '../src/common/app-state-preferences'
import { RoCrateLoaderContribution } from '../src/browser/state/ro-crate-loader'

const currentCrate = {
  '@graph': [{ '@id': './', '@type': 'Dataset', name: 'Current' }],
}
const externalCrate = {
  '@graph': [{ '@id': './', '@type': 'Dataset', name: 'External' }],
}

function createLoader(action: ROCrateExternalChangeActionValue = 'prompt'): any {
  const loader = new RoCrateLoaderContribution() as any
  loader.appStateService = {
    roCrate: currentCrate,
    wasRoCrateSavedRecently: jest.fn().mockReturnValue(false),
    isRoCrateDirty: jest.fn().mockReturnValue(true),
  }
  loader.workspaceService = {
    tryGetRoots: jest.fn().mockReturnValue([
      { resource: new URI('file:///workspace/') },
    ]),
  }
  loader.messageService = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
  loader.preferenceService = { set: jest.fn().mockResolvedValue(undefined) }
  loader.appStatePreferences = { [ROCrateExternalChangeAction]: action }
  loader.metadataFileExistsWithRetry = jest.fn().mockResolvedValue(true)
  loader.readRoCrateJson = jest.fn().mockResolvedValue(externalCrate)
  loader.reloadExternalCrate = jest.fn().mockResolvedValue(undefined)
  loader.lastKnownMetadataJson = JSON.stringify(currentCrate)
  return loader
}

describe('RoCrateLoaderContribution external metadata changes', () => {
  it.each([
    ['off', false, false],
    ['auto', true, true],
  ] as Array<[ROCrateExternalChangeActionValue, boolean, boolean]>)(
    'applies the %s external-change decision',
    async (action, shouldNotify, shouldReload) => {
      const loader = createLoader(action)

      await loader.handleExternalMetadataChange()

      expect(loader.messageService.info).toHaveBeenCalledTimes(shouldNotify ? 1 : 0)
      expect(loader.reloadExternalCrate).toHaveBeenCalledTimes(shouldReload ? 1 : 0)
      if (action === 'off') {
        expect(loader.lastKnownMetadataJson).toBe(JSON.stringify(externalCrate))
      }
    },
  )

  it('deduplicates concurrent prompts and remembers Always Reload', async () => {
    const loader = createLoader()
    let resolvePrompt: ((choice: string) => void) | undefined
    loader.messageService.info.mockImplementation(
      () => new Promise<string>((resolve) => {
        resolvePrompt = resolve
      }),
    )

    const firstCheck = loader.handleExternalMetadataChange()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(loader.messageService.info).toHaveBeenCalledTimes(1)

    const secondCheck = loader.handleExternalMetadataChange()
    await secondCheck
    expect(loader.messageService.info).toHaveBeenCalledTimes(1)

    const alwaysReload = loader.messageService.info.mock.calls[0][2]
    resolvePrompt?.(alwaysReload)
    await firstCheck

    expect(loader.preferenceService.set).toHaveBeenCalledWith(
      ROCrateExternalChangeAction,
      'auto',
      expect.anything(),
    )
    expect(loader.reloadExternalCrate).toHaveBeenCalledTimes(1)
    expect(loader.externalMetadataPromptInFlight).toBeUndefined()
  })

  it('clears the prompt guard when reloading rejects so a retry can proceed', async () => {
    const loader = createLoader()
    loader.messageService.info.mockImplementation(
      (_message: string, reload: string) => Promise.resolve(reload),
    )
    loader.reloadExternalCrate.mockRejectedValueOnce(new Error('reload failed'))

    await expect(loader.handleExternalMetadataChange()).rejects.toThrow('reload failed')
    expect(loader.externalMetadataPromptInFlight).toBeUndefined()

    await loader.handleExternalMetadataChange()
    expect(loader.messageService.info).toHaveBeenCalledTimes(2)
    expect(loader.reloadExternalCrate).toHaveBeenCalledTimes(2)
  })
})

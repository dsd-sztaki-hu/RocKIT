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
  ...jest.requireActual('rockit-common/lib/browser/utf8-text-file'),
  MetadataProfileManager: class MetadataProfileManager {},
  RoCrateHtmlGenerator: class RoCrateHtmlGenerator {},
}))
jest.mock('app-state/lib/browser/state/ro-crate-dialog', () => ({
  ROCrateDialog: class ROCrateDialog {},
}))
jest.mock('app-state/lib/browser/state/ro-crate-id-conversion-dialog', () => ({
  RoCrateIdConversionDialog: class RoCrateIdConversionDialog {},
}))
jest.mock('app-state/lib/browser/state/ro-crate-missing-names-dialog', () => ({
  RoCrateMissingNamesDialog: class RoCrateMissingNamesDialog {},
}))

import { mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import { FileUri } from '@theia/core/lib/common/file-uri'
import URI from '@theia/core/lib/common/uri'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateHistoryService } from 'app-state/lib/browser/state/ro-crate-history-service'
import { RoCrateLoaderContribution } from 'app-state/lib/browser/state/ro-crate-loader'

const metadataFilename = 'ro-crate-metadata.json'
const staleCrate = {
  '@context': 'https://w3id.org/ro/crate/1.1/context',
  '@graph': [{ '@id': './', '@type': 'Dataset', name: 'Previously loaded' }],
}

class TemporaryFileService {
  async exists(resource: URI): Promise<boolean> {
    try {
      await stat(FileUri.fsPath(resource))
      return true
    } catch {
      return false
    }
  }

  async readFile(resource: URI): Promise<{ value: BinaryBuffer }> {
    return { value: BinaryBuffer.wrap(await readFile(FileUri.fsPath(resource))) }
  }

  async read(resource: URI): Promise<{ value: string }> {
    return { value: await readFile(FileUri.fsPath(resource), 'utf8') }
  }

  async delete(resource: URI): Promise<void> {
    await unlink(FileUri.fsPath(resource))
  }

  watch(): { dispose: () => void } {
    return { dispose: () => undefined }
  }

  onDidFilesChange(): { dispose: () => void } {
    return { dispose: () => undefined }
  }
}

type LoaderHarness = {
  appStateService: AppStateService
  roCrateHistoryService: RoCrateHistoryService
  workspaceService: { tryGetRoots: () => Array<{ resource: URI }> }
  fileService: TemporaryFileService
  commandService: { executeCommand: jest.Mock }
  messageService: { info: jest.Mock; warn: jest.Mock; error: jest.Mock }
  appStatePreferences: Record<string, unknown>
  preferenceService: { set: jest.Mock }
  frontendStarted: boolean
  ensureMetadataWatch: jest.Mock
  refreshProfileList: jest.Mock
  refreshCompleteProfile: jest.Mock
  promptForCrateRecovery: jest.Mock
  delay: jest.Mock
  refresh(): Promise<void>
}

const createLoader = (rootUri: URI, fileService: TemporaryFileService) => {
  const appState = new AppStateService()
  appState.roCrate = staleCrate
  appState.dirty = true

  const history = new RoCrateHistoryService()
  ;(history as unknown as { appStateService: AppStateService }).appStateService = appState

  const loader = new RoCrateLoaderContribution() as unknown as LoaderHarness
  loader.appStateService = appState
  loader.roCrateHistoryService = history
  loader.workspaceService = { tryGetRoots: () => [{ resource: rootUri }] }
  loader.fileService = fileService
  loader.commandService = { executeCommand: jest.fn() }
  loader.messageService = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  loader.appStatePreferences = {}
  loader.preferenceService = { set: jest.fn() }
  loader.frontendStarted = true
  loader.ensureMetadataWatch = jest.fn()
  loader.refreshProfileList = jest.fn().mockResolvedValue(undefined)
  loader.refreshCompleteProfile = jest.fn().mockResolvedValue(undefined)
  loader.promptForCrateRecovery = jest.fn().mockResolvedValue(undefined)
  loader.delay = jest.fn().mockResolvedValue(undefined)
  return { appState, loader }
}

describe('RO-Crate loading failures', () => {
  let workspacePath: string
  let rootUri: URI
  let fileService: TemporaryFileService

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), 'rockit-loading-'))
    rootUri = FileUri.create(workspacePath)
    fileService = new TemporaryFileService()
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await rm(workspacePath, { recursive: true, force: true })
  })

  it('clears stale state and requests recovery when metadata is missing', async () => {
    const { appState, loader } = createLoader(rootUri, fileService)

    await loader.refresh()

    expect(appState.roCrate).toBeUndefined()
    expect(appState.isROCrateInvalid).toBe(false)
    expect(appState.dirty).toBe(false)
    expect(loader.promptForCrateRecovery).toHaveBeenCalledWith(rootUri, false)
    await expect(readFile(path.join(workspacePath, metadataFilename))).rejects.toThrow()
  })

  it('marks malformed metadata invalid without overwriting it', async () => {
    const malformedJson = '{"@context": "https://w3id.org/ro/crate/1.1/context",'
    await writeFile(path.join(workspacePath, metadataFilename), malformedJson, 'utf8')
    const { appState, loader } = createLoader(rootUri, fileService)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await loader.refresh()

    expect(appState.roCrate).toBeUndefined()
    expect(appState.isROCrateInvalid).toBe(true)
    expect(appState.dirty).toBe(false)
    expect(loader.promptForCrateRecovery).toHaveBeenCalledWith(rootUri, true)
    expect(await readFile(path.join(workspacePath, metadataFilename), 'utf8')).toBe(
      malformedJson,
    )
  })
})

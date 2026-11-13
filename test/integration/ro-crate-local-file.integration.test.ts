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
jest.mock('rockit-loadmask/lib/browser/loadmask-service', () => ({
  LoadMaskService: class LoadMaskService {},
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

import { mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { BinaryBuffer, BinaryBufferReadable } from '@theia/core/lib/common/buffer'
import { FileUri } from '@theia/core/lib/common/file-uri'
import URI from '@theia/core/lib/common/uri'
import { RoCrateDescriptionOperationsService } from '@theia/navigator/lib/browser/ro-crate-description-operations-service'
import { RoCrateIgnoredFilesService } from '@theia/navigator/lib/browser/ro-crate-ignored-files-service'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateHistoryService } from 'app-state/lib/browser/state/ro-crate-history-service'
import { RoCrateLoaderContribution } from 'app-state/lib/browser/state/ro-crate-loader'
import { RoCrateHtmlGeneratorImpl } from 'save-ro-crate/lib/browser/ro-crate-html-generator'
import { RoCratePersistenceService } from 'save-ro-crate/lib/browser/ro-crate-persistence-service'

type Crate = Record<string, any>

const localFilePath = 'data/example.txt'
const originalCrate: Crate = {
  '@context': 'https://w3id.org/ro/crate/1.1/context',
  '@graph': [
    {
      '@id': 'ro-crate-metadata.json',
      '@type': 'CreativeWork',
      name: 'RO-Crate Metadata',
      about: { '@id': './' },
      conformsTo: { '@id': 'https://w3id.org/ro/crate/1.1' },
    },
    {
      '@id': './',
      '@type': 'Dataset',
      name: 'Local file example',
      hasPart: [{ '@id': localFilePath }],
    },
    {
      '@id': localFilePath,
      '@type': 'File',
      name: 'example.txt',
      encodingFormat: 'text/plain',
      contentSize: '12',
    },
  ],
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

  async writeFile(
    resource: URI,
    content: BinaryBuffer | BinaryBufferReadable,
  ): Promise<void> {
    const target = FileUri.fsPath(resource)
    await mkdir(path.dirname(target), { recursive: true })
    const buffer =
      content instanceof BinaryBuffer ? content : BinaryBufferReadable.toBuffer(content)
    await writeFile(target, buffer.buffer)
  }

  async createFolder(resource: URI): Promise<void> {
    await mkdir(FileUri.fsPath(resource), { recursive: true })
  }

  async create(resource: URI, content: string): Promise<void> {
    const target = FileUri.fsPath(resource)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
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

const createStateAndHistory = () => {
  const appState = new AppStateService()
  const history = new RoCrateHistoryService() as any
  history.appStateService = appState
  return { appState, history: history as RoCrateHistoryService }
}

const createLoader = (
  rootUri: URI,
  fileService: TemporaryFileService,
  appState: AppStateService,
  history: RoCrateHistoryService,
) => {
  const loader = new RoCrateLoaderContribution() as any
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
  return loader as RoCrateLoaderContribution
}

const createPersistence = (
  fileService: TemporaryFileService,
  appState: AppStateService,
) => {
  const persistence = new RoCratePersistenceService() as any
  persistence.fileService = fileService
  persistence.htmlGenerator = new RoCrateHtmlGeneratorImpl()
  persistence.appStateService = appState
  persistence.loadMaskService = {
    show: jest.fn(() => ({ update: jest.fn(), dispose: jest.fn() })),
  }
  return persistence as RoCratePersistenceService
}

const createLocalFileServices = async (
  rootUri: URI,
  fileService: TemporaryFileService,
  appState: AppStateService,
  history: RoCrateHistoryService,
) => {
  const workspaceService = { tryGetRoots: () => [{ resource: rootUri }] }
  const ignoredFiles = new RoCrateIgnoredFilesService() as any
  ignoredFiles.workspaceService = workspaceService
  ignoredFiles.fileService = fileService
  ignoredFiles.appStateService = appState
  ignoredFiles.roCrateHistoryService = history
  ignoredFiles.init()
  await ignoredFiles.ensureIgnoreStoreExists()

  const persistence = createPersistence(fileService, appState)
  const operations = new RoCrateDescriptionOperationsService() as any
  operations.appStateService = appState
  operations.workspaceService = workspaceService
  operations.fileSearchService = { find: jest.fn().mockResolvedValue([]) }
  operations.fileService = fileService
  operations.roCrateIgnoredFilesService = ignoredFiles
  operations.roCrateHistoryService = history
  operations.roCratePersistenceService = persistence

  return {
    ignoredFiles: ignoredFiles as RoCrateIgnoredFilesService,
    operations: operations as RoCrateDescriptionOperationsService,
  }
}

const findEntity = (crate: Crate, entityId: string): Crate | undefined =>
  crate['@graph'].find((entity: Crate) => entity['@id'] === entityId)

const readMetadata = async (workspacePath: string): Promise<Crate> =>
  JSON.parse(await readFile(path.join(workspacePath, 'ro-crate-metadata.json'), 'utf8'))

describe('RO-Crate local file inclusion and omission persistence', () => {
  let workspacePath: string
  let rootUri: URI
  let fileService: TemporaryFileService

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), 'rockit-local-file-'))
    rootUri = FileUri.create(workspacePath)
    fileService = new TemporaryFileService()
    await mkdir(path.join(workspacePath, 'data'), { recursive: true })
    await writeFile(path.join(workspacePath, localFilePath), 'hello world\n', 'utf8')
    await writeFile(
      path.join(workspacePath, 'ro-crate-metadata.json'),
      `${JSON.stringify(originalCrate, null, 2)}\n`,
    )
  })

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true })
  })

  it('persists omit/include rules without deleting the local file', async () => {
    const state = createStateAndHistory()
    await createLoader(rootUri, fileService, state.appState, state.history).refresh()
    const { ignoredFiles, operations } = await createLocalFileServices(
      rootUri,
      fileService,
      state.appState,
      state.history,
    )

    const omitResult = await operations.omitResources([
      { path: localFilePath, isDirectory: false },
    ])

    expect(omitResult).toEqual({
      metadataLoaded: true,
      pairedDescriptionCount: 1,
      removedDescriptionCount: 1,
    })
    expect(findEntity(state.appState.roCrate!, localFilePath)).toBeUndefined()
    expect(findEntity(state.appState.roCrate!, './')?.hasPart).toBeUndefined()
    expect(ignoredFiles.isIgnoredPath(localFilePath)).toBe(true)
    expect(state.appState.dirty).toBe(true)
    expect(state.history.getDebugSnapshot().undoCount).toBe(1)
    await expect(readFile(path.join(workspacePath, localFilePath), 'utf8')).resolves.toBe(
      'hello world\n',
    )

    state.history.undo()
    expect(findEntity(state.appState.roCrate!, localFilePath)).toBeDefined()
    expect(findEntity(state.appState.roCrate!, './')?.hasPart).toEqual([
      { '@id': localFilePath },
    ])
    expect(ignoredFiles.isIgnoredPath(localFilePath)).toBe(false)
    expect(state.appState.dirty).toBe(false)

    state.history.redo()
    expect(findEntity(state.appState.roCrate!, localFilePath)).toBeUndefined()
    expect(ignoredFiles.isIgnoredPath(localFilePath)).toBe(true)
    expect(state.appState.dirty).toBe(true)

    await operations.persistCurrentState(true)
    expect(state.appState.dirty).toBe(false)
    expect(findEntity(await readMetadata(workspacePath), localFilePath)).toBeUndefined()
    expect(
      await readFile(path.join(workspacePath, '.rockit', 'ignored.txt'), 'utf8'),
    ).toContain(`${localFilePath}\n`)

    const reopened = createStateAndHistory()
    await createLoader(
      rootUri,
      fileService,
      reopened.appState,
      reopened.history,
    ).refresh()
    expect(findEntity(reopened.appState.roCrate!, localFilePath)).toBeUndefined()
    expect(reopened.appState.ignoreList).toContain(localFilePath)

    const reopenedServices = await createLocalFileServices(
      rootUri,
      fileService,
      reopened.appState,
      reopened.history,
    )
    const metadataBeforeInclude = await readFile(
      path.join(workspacePath, 'ro-crate-metadata.json'),
      'utf8',
    )
    const includeResult = await reopenedServices.operations.includeResources([
      { path: localFilePath, isDirectory: false },
    ])
    await reopenedServices.operations.persistCurrentState(false)

    expect(includeResult).toEqual({ updatedIgnoredRules: true })
    expect(reopenedServices.ignoredFiles.isIgnoredPath(localFilePath)).toBe(false)
    expect(findEntity(reopened.appState.roCrate!, localFilePath)).toBeUndefined()
    expect(
      await readFile(path.join(workspacePath, 'ro-crate-metadata.json'), 'utf8'),
    ).toBe(metadataBeforeInclude)
    expect(
      await readFile(path.join(workspacePath, '.rockit', 'ignored.txt'), 'utf8'),
    ).not.toContain(localFilePath)
    await expect(readFile(path.join(workspacePath, localFilePath), 'utf8')).resolves.toBe(
      'hello world\n',
    )

    const includedReopen = createStateAndHistory()
    await createLoader(
      rootUri,
      fileService,
      includedReopen.appState,
      includedReopen.history,
    ).refresh()
    expect(includedReopen.appState.ignoreList).not.toContain(localFilePath)
    expect(findEntity(includedReopen.appState.roCrate!, localFilePath)).toBeUndefined()
  })
})

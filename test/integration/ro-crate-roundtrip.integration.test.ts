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
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateHistoryService } from 'app-state/lib/browser/state/ro-crate-history-service'
import { RoCrateLoaderContribution } from 'app-state/lib/browser/state/ro-crate-loader'
import { RoCrateHtmlGeneratorImpl } from 'save-ro-crate/lib/browser/ro-crate-html-generator'
import { RoCratePersistenceService } from 'save-ro-crate/lib/browser/ro-crate-persistence-service'

type Crate = Record<string, any>

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
      name: 'Original Dataset',
      hasPart: [{ '@id': 'data.txt' }],
    },
    {
      '@id': 'data.txt',
      '@type': 'File',
      name: 'Data file',
      encodingFormat: 'text/plain',
    },
  ],
}

class TemporaryFileService {
  failNextMetadataWrite = false
  failNextPreviewWrite = false

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
    if (
      this.failNextMetadataWrite &&
      path.basename(target) === 'ro-crate-metadata.json'
    ) {
      this.failNextMetadataWrite = false
      throw new Error('simulated metadata write failure')
    }
    if (this.failNextPreviewWrite && path.basename(target) === 'ro-crate-preview.html') {
      this.failNextPreviewWrite = false
      throw new Error('simulated preview write failure')
    }
    await mkdir(path.dirname(target), { recursive: true })
    const buffer =
      content instanceof BinaryBuffer ? content : BinaryBufferReadable.toBuffer(content)
    await writeFile(target, buffer.buffer)
  }

  async createFolder(resource: URI): Promise<void> {
    await mkdir(FileUri.fsPath(resource), { recursive: true })
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
  loader.workspaceService = {
    tryGetRoots: () => [{ resource: rootUri }],
  }
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
  const masks: Array<{ update: jest.Mock; dispose: jest.Mock }> = []
  const persistence = new RoCratePersistenceService() as any
  persistence.fileService = fileService
  persistence.htmlGenerator = new RoCrateHtmlGeneratorImpl()
  persistence.appStateService = appState
  persistence.loadMaskService = {
    show: jest.fn(() => {
      const mask = { update: jest.fn(), dispose: jest.fn() }
      masks.push(mask)
      return mask
    }),
  }
  return { persistence: persistence as RoCratePersistenceService, masks }
}

const editedCopy = (crate: Crate): Crate => {
  const edited = JSON.parse(JSON.stringify(crate))
  const root = edited['@graph'].find((entity: Crate) => entity['@id'] === './')
  root.name = 'Edited Dataset'
  root.description = 'Saved by the integration workflow.'
  return edited
}

const cloneCrate = (crate: Crate): Crate => JSON.parse(JSON.stringify(crate))

const findEntity = (crate: Crate, entityId: string): Crate | undefined =>
  crate['@graph'].find((entity: Crate) => entity['@id'] === entityId)

describe('RO-Crate open, edit, save, and reopen integration', () => {
  let workspacePath: string
  let rootUri: URI
  let fileService: TemporaryFileService

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), 'rockit-roundtrip-'))
    rootUri = FileUri.create(workspacePath)
    fileService = new TemporaryFileService()
    await writeFile(
      path.join(workspacePath, 'ro-crate-metadata.json'),
      `${JSON.stringify(originalCrate, null, 2)}\n`,
    )
  })

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true })
  })

  it('persists an edited graph and reloads it into fresh application state', async () => {
    const first = createStateAndHistory()
    await createLoader(rootUri, fileService, first.appState, first.history).refresh()

    expect(first.appState.roCrate).toEqual(originalCrate)
    expect(first.appState.isROCrateInvalid).toBe(false)
    expect(first.appState.dirty).toBe(false)

    const edited = editedCopy(first.appState.roCrate!)
    first.history.applyRoCrateChange(edited, { label: 'Edit root dataset' })
    expect(first.appState.dirty).toBe(true)
    expect(first.history.getDebugSnapshot().undoCount).toBe(1)
    expect(
      JSON.parse(
        await readFile(path.join(workspacePath, 'ro-crate-metadata.json'), 'utf8'),
      ),
    ).toEqual(originalCrate)

    const { persistence, masks } = createPersistence(fileService, first.appState)
    await persistence.write(rootUri, first.appState.roCrate!)

    expect(first.appState.dirty).toBe(false)
    expect(masks[0].dispose).toHaveBeenCalledTimes(1)
    expect(
      JSON.parse(
        await readFile(path.join(workspacePath, 'ro-crate-metadata.json'), 'utf8'),
      ),
    ).toEqual(edited)
    expect(
      await readFile(path.join(workspacePath, 'ro-crate-preview.html'), 'utf8'),
    ).toContain('Edited Dataset')

    const reopened = createStateAndHistory()
    await createLoader(
      rootUri,
      fileService,
      reopened.appState,
      reopened.history,
    ).refresh()
    expect(reopened.appState.roCrate).toEqual(edited)
    expect(reopened.appState.dirty).toBe(false)
    expect(reopened.appState.isROCrateInvalid).toBe(false)
  })

  it('keeps the crate dirty after a failed metadata write and supports retry', async () => {
    const state = createStateAndHistory()
    await createLoader(rootUri, fileService, state.appState, state.history).refresh()
    const edited = editedCopy(state.appState.roCrate!)
    state.history.applyRoCrateChange(edited, { label: 'Edit root dataset' })
    const { persistence, masks } = createPersistence(fileService, state.appState)
    fileService.failNextMetadataWrite = true

    await expect(persistence.write(rootUri, edited)).rejects.toThrow(
      'simulated metadata write failure',
    )
    expect(state.appState.dirty).toBe(true)
    expect((state.appState as any).internalRoCrateSaveCount).toBe(0)
    expect(masks[0].dispose).toHaveBeenCalledTimes(1)
    expect(
      JSON.parse(
        await readFile(path.join(workspacePath, 'ro-crate-metadata.json'), 'utf8'),
      ),
    ).toEqual(originalCrate)
    await expect(
      readFile(path.join(workspacePath, 'ro-crate-preview.html')),
    ).rejects.toThrow()

    await persistence.write(rootUri, edited)
    expect(state.appState.dirty).toBe(false)
    expect(
      JSON.parse(
        await readFile(path.join(workspacePath, 'ro-crate-metadata.json'), 'utf8'),
      ),
    ).toEqual(edited)
  })

  it('keeps the crate dirty when preview writing fails after metadata is persisted', async () => {
    const state = createStateAndHistory()
    await createLoader(rootUri, fileService, state.appState, state.history).refresh()
    const edited = editedCopy(state.appState.roCrate!)
    state.history.applyRoCrateChange(edited, { label: 'Edit root dataset' })
    const { persistence, masks } = createPersistence(fileService, state.appState)
    fileService.failNextPreviewWrite = true

    await expect(persistence.write(rootUri, edited)).rejects.toThrow(
      'simulated preview write failure',
    )
    expect(state.appState.dirty).toBe(true)
    expect((state.appState as any).internalRoCrateSaveCount).toBe(0)
    expect(masks[0].dispose).toHaveBeenCalledTimes(1)
    expect(
      JSON.parse(
        await readFile(path.join(workspacePath, 'ro-crate-metadata.json'), 'utf8'),
      ),
    ).toEqual(edited)
    await expect(
      readFile(path.join(workspacePath, 'ro-crate-preview.html')),
    ).rejects.toThrow()

    await persistence.write(rootUri, edited)
    expect(state.appState.dirty).toBe(false)
    expect(masks[1].dispose).toHaveBeenCalledTimes(1)
    expect(
      await readFile(path.join(workspacePath, 'ro-crate-preview.html'), 'utf8'),
    ).toContain('Edited Dataset')
  })

  it('persists added, renamed, and deleted entities across reopen', async () => {
    const state = createStateAndHistory()
    await createLoader(rootUri, fileService, state.appState, state.history).refresh()

    const withAuthor = cloneCrate(state.appState.roCrate!)
    withAuthor['@graph'].push({
      '@id': '#alice',
      '@type': 'Person',
      name: 'Alice Example',
    })
    findEntity(withAuthor, './')!.author = { '@id': '#alice' }
    state.history.applyRoCrateChange(withAuthor, { label: 'Add author' })
    expect(findEntity(state.appState.roCrate!, '#alice')).toBeDefined()

    const withRenamedAuthor = cloneCrate(state.appState.roCrate!)
    findEntity(withRenamedAuthor, '#alice')!['@id'] = '#alice-smith'
    findEntity(withRenamedAuthor, './')!.author = { '@id': '#alice-smith' }
    state.history.applyRoCrateChange(withRenamedAuthor, {
      label: 'Rename author entity ID',
    })
    expect(findEntity(state.appState.roCrate!, '#alice')).toBeUndefined()
    expect(findEntity(state.appState.roCrate!, './')!.author).toEqual({
      '@id': '#alice-smith',
    })

    const withoutOriginalFile = cloneCrate(state.appState.roCrate!)
    withoutOriginalFile['@graph'] = withoutOriginalFile['@graph'].filter(
      (entity: Crate) => entity['@id'] !== 'data.txt',
    )
    findEntity(withoutOriginalFile, './')!.hasPart = []
    state.history.applyRoCrateChange(withoutOriginalFile, {
      label: 'Delete original file entity',
    })

    expect(state.appState.dirty).toBe(true)
    expect(state.history.getDebugSnapshot().undoCount).toBe(3)
    expect(
      JSON.parse(
        await readFile(path.join(workspacePath, 'ro-crate-metadata.json'), 'utf8'),
      ),
    ).toEqual(originalCrate)

    const { persistence } = createPersistence(fileService, state.appState)
    await persistence.write(rootUri, state.appState.roCrate!)

    const reopened = createStateAndHistory()
    await createLoader(
      rootUri,
      fileService,
      reopened.appState,
      reopened.history,
    ).refresh()
    const reopenedCrate = reopened.appState.roCrate!
    const reopenedRoot = findEntity(reopenedCrate, './')!

    expect(findEntity(reopenedCrate, '#alice')).toBeUndefined()
    expect(findEntity(reopenedCrate, '#alice-smith')).toEqual({
      '@id': '#alice-smith',
      '@type': 'Person',
      name: 'Alice Example',
    })
    expect(findEntity(reopenedCrate, 'data.txt')).toBeUndefined()
    expect(reopenedRoot.author).toEqual({ '@id': '#alice-smith' })
    expect(reopenedRoot.hasPart).toEqual([])
    expect(reopened.appState.dirty).toBe(false)
    expect(reopened.appState.isROCrateInvalid).toBe(false)
    expect(reopened.history.getDebugSnapshot().undoCount).toBe(0)
  })

  it('keeps undo and redo dirty state aligned with the persisted baseline', async () => {
    const state = createStateAndHistory()
    await createLoader(rootUri, fileService, state.appState, state.history).refresh()
    const edited = editedCopy(state.appState.roCrate!)

    state.history.applyRoCrateChange(edited, { label: 'Edit root dataset' })
    expect(state.appState.roCrate).toEqual(edited)
    expect(state.appState.dirty).toBe(true)
    expect(state.history.canUndo()).toBe(true)

    state.history.undo()
    expect(state.appState.roCrate).toEqual(originalCrate)
    expect(state.appState.dirty).toBe(false)
    expect(state.history.canRedo()).toBe(true)

    state.history.redo()
    expect(state.appState.roCrate).toEqual(edited)
    expect(state.appState.dirty).toBe(true)

    const { persistence } = createPersistence(fileService, state.appState)
    await persistence.write(rootUri, state.appState.roCrate!)
    expect(state.appState.dirty).toBe(false)

    state.history.undo()
    expect(state.appState.roCrate).toEqual(originalCrate)
    expect(state.appState.dirty).toBe(true)

    state.history.redo()
    expect(state.appState.roCrate).toEqual(edited)
    expect(state.appState.dirty).toBe(false)

    const reopened = createStateAndHistory()
    await createLoader(
      rootUri,
      fileService,
      reopened.appState,
      reopened.history,
    ).refresh()
    expect(reopened.appState.roCrate).toEqual(edited)
    expect(reopened.appState.dirty).toBe(false)
    expect(reopened.history.canUndo()).toBe(false)
    expect(reopened.history.canRedo()).toBe(false)
  })
})

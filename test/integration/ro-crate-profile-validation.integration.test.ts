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
import { SchemaValidatorService } from 'schema-validator/lib/browser/schema-validator-service'

type Crate = Record<string, any>

const profileUrl = 'https://example.test/profiles/required-description'
const convertedPath = 'profiles/required-description.json'
const builtInProfileUrl = 'https://w3id.org/ro/crate/1.1'

const baseProfile = {
  classes: {},
  layouts: [],
  localisation: { language: 'en' },
}

const selectedProfile = {
  metadata: {
    name: 'Required description metadata',
    description: 'Requires a description for datasets using this profile.',
  },
  classes: {
    Dataset: {
      inputs: [
        {
          name: 'description',
          label: 'Description',
          type: ['Text'],
          required: true,
          multiple: false,
        },
      ],
    },
  },
  layouts: [],
  localisation: {},
}

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
      name: 'Profile persistence example',
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

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

const createProfileManager = () => ({
  loadAllProfiles: jest.fn().mockResolvedValue([
    {
      id: 'required-description',
      conformsTo: profileUrl,
      files: { convertedPath },
    },
  ]),
  getConvertedProfileContent: jest.fn().mockResolvedValue(selectedProfile),
  getMergedProfile: jest.fn(
    async (crate: Crate, profileToAdd: Crate, profile: Crate, conformsToUrl: string) => {
      const merged = clone(profile)
      merged.classes ??= {}

      for (const entity of crate['@graph'] ?? []) {
        const conformsToValues = Array.isArray(entity.conformsTo)
          ? entity.conformsTo
          : [entity.conformsTo]
        const usesProfile = conformsToValues.some(
          (value: string | { '@id'?: string } | undefined) =>
            (typeof value === 'string' ? value : value?.['@id']) === conformsToUrl,
        )
        if (!usesProfile || entity['@type'] === 'CreativeWork') continue

        const entityType = Array.isArray(entity['@type'])
          ? entity['@type'][0]
          : entity['@type']
        merged.classes[entityType] = clone(profileToAdd.classes.Dataset)
      }

      return merged
    },
  ),
})

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
  profileManager: ReturnType<typeof createProfileManager>,
) => {
  const loader = new RoCrateLoaderContribution() as any
  loader.appStateService = appState
  loader.roCrateHistoryService = history
  loader.profileManagerService = profileManager
  loader.initialProfileTemplate = baseProfile
  loader.workspaceService = { tryGetRoots: () => [{ resource: rootUri }] }
  loader.fileService = fileService
  loader.commandService = { executeCommand: jest.fn() }
  loader.messageService = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  loader.appStatePreferences = {}
  loader.preferenceService = { set: jest.fn() }
  loader.frontendStarted = true
  loader.ensureMetadataWatch = jest.fn()
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

const createValidator = (
  appState: AppStateService,
  profileManager: ReturnType<typeof createProfileManager>,
) => {
  const validator = new SchemaValidatorService() as any
  validator.appStateService = appState
  validator.profileManagerService = profileManager
  return validator as SchemaValidatorService
}

const findRoot = (crate: Crate): Crate =>
  crate['@graph'].find((entity: Crate) => entity['@id'] === './')

describe('RO-Crate profile selection and validation persistence', () => {
  let workspacePath: string
  let rootUri: URI
  let fileService: TemporaryFileService
  let originalConsoleWarn: typeof console.warn

  beforeEach(async () => {
    originalConsoleWarn = console.warn
    jest.spyOn(console, 'warn').mockImplementation((message, ...details) => {
      const isExpectedBuiltInProfileWarning =
        message === 'No profile found in state for conformsTo URL:' &&
        details[0] === builtInProfileUrl
      if (!isExpectedBuiltInProfileWarning) originalConsoleWarn(message, ...details)
    })
    workspacePath = await mkdtemp(path.join(tmpdir(), 'rockit-profile-validation-'))
    rootUri = FileUri.create(workspacePath)
    fileService = new TemporaryFileService()
    await writeFile(
      path.join(workspacePath, 'ro-crate-metadata.json'),
      `${JSON.stringify(originalCrate, null, 2)}\n`,
    )
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await rm(workspacePath, { recursive: true, force: true })
  })

  it('reloads a selected profile and applies its validation rules after each save', async () => {
    const first = createStateAndHistory()
    const firstProfileManager = createProfileManager()
    await createLoader(
      rootUri,
      fileService,
      first.appState,
      first.history,
      firstProfileManager,
    ).refresh()

    const withProfile = clone(first.appState.roCrate!)
    findRoot(withProfile).conformsTo = { '@id': profileUrl }
    first.history.applyRoCrateChange(withProfile, { label: 'Select metadata profile' })
    await createPersistence(fileService, first.appState).write(rootUri, withProfile)

    const reopened = createStateAndHistory()
    const reopenedProfileManager = createProfileManager()
    await createLoader(
      rootUri,
      fileService,
      reopened.appState,
      reopened.history,
      reopenedProfileManager,
    ).refresh()

    expect(findRoot(reopened.appState.roCrate!).conformsTo).toEqual({
      '@id': profileUrl,
    })
    expect(reopened.appState.profileList).toEqual([
      { id: profileUrl, content: selectedProfile, flag: '' },
    ])
    expect(reopened.appState.completeProfile?.classes.Dataset.inputs).toEqual(
      selectedProfile.classes.Dataset.inputs,
    )
    expect(reopenedProfileManager.loadAllProfiles).toHaveBeenCalledTimes(1)
    expect(reopenedProfileManager.getConvertedProfileContent).toHaveBeenCalledWith(
      convertedPath,
    )

    const validator = createValidator(reopened.appState, reopenedProfileManager)
    const errors = await validator.validateEntities(
      reopened.appState.roCrate!,
      baseProfile,
    )
    expect(errors).toEqual([
      expect.objectContaining({
        entityId: './',
        entityType: 'Dataset',
        fieldName: 'description',
        errorCode: 'REQUIRED_NOT_SET',
      }),
    ])

    const corrected = clone(reopened.appState.roCrate!)
    findRoot(corrected).description = 'The required description is now present.'
    reopened.history.applyRoCrateChange(corrected, {
      label: 'Add required description',
    })
    await createPersistence(fileService, reopened.appState).write(rootUri, corrected)

    const correctedReopen = createStateAndHistory()
    const correctedProfileManager = createProfileManager()
    await createLoader(
      rootUri,
      fileService,
      correctedReopen.appState,
      correctedReopen.history,
      correctedProfileManager,
    ).refresh()

    expect(findRoot(correctedReopen.appState.roCrate!).description).toBe(
      'The required description is now present.',
    )
    expect(correctedReopen.appState.profileList?.[0]?.id).toBe(profileUrl)
    await expect(
      createValidator(correctedReopen.appState, correctedProfileManager).validateEntities(
        correctedReopen.appState.roCrate!,
        baseProfile,
      ),
    ).resolves.toBeUndefined()
  })
})

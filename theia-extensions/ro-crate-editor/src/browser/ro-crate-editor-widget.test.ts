import 'reflect-metadata'

jest.mock('@theia/workspace/lib/browser', () => ({
  WorkspaceCommands: { CLOSE: { id: 'workspace.close' } },
  WorkspaceService: class WorkspaceService {},
}))
jest.mock('rockit-common/lib/browser', () => ({
  MetadataSchemaManager: class MetadataSchemaManager {},
  SchemaValidatorManager: class SchemaValidatorManager {},
  writeUtf8TextFile: jest.fn(),
}))
jest.mock('rockit-common/lib/common/ro-crate-entity-name', () => ({
  findMissingRoCrateEntityNames: jest.fn().mockReturnValue([]),
  repairMissingRoCrateEntityNames: jest.fn((crate) => crate),
}))
jest.mock('app-state/lib/browser/state/ro-crate-history-service', () => ({
  RoCrateHistoryService: class RoCrateHistoryService {},
}))
jest.mock('app-state/lib/browser/state/ro-crate-missing-names-dialog', () => ({
  RoCrateMissingNamesDialog: class RoCrateMissingNamesDialog {},
}))
jest.mock('rockit-loadmask/lib/browser/loadmask-service', () => ({
  LoadMaskService: class LoadMaskService {},
}))
jest.mock('save-ro-crate/lib/browser/ro-crate-persistence-service', () => ({
  RoCratePersistenceService: class RoCratePersistenceService {},
}))
jest.mock('./recrate-wrapper', () => ({
  DescriboCrateBuilderWrapper: jest.fn(),
}))

import { RoCrateEditorWidget } from './ro-crate-editor-widget'

const crateWithFileId = (fileId: string): Record<string, any> => ({
  '@context': 'https://w3id.org/ro/crate/1.1/context',
  '@graph': [
    {
      '@id': 'ro-crate-metadata.json',
      '@type': 'CreativeWork',
      about: { '@id': './' },
      conformsTo: { '@id': 'https://w3id.org/ro/crate/1.1' },
    },
    {
      '@id': './',
      '@type': 'Dataset',
      name: 'Root dataset',
      hasPart: [{ '@id': fileId }],
    },
    {
      '@id': fileId,
      '@type': 'File',
      name: 'Dinosaur image',
      encodingFormat: 'image/jpeg',
    },
  ],
})

describe('RoCrateEditorWidget dirty state', () => {
  it('stays dirty when rejecting an external entity-id rename changes the crate in memory', async () => {
    const externallyRenamedCrate = crateWithFileId('dino1111.jpg')
    const rejectedCrate = crateWithFileId('dino11.jpg')
    const widget = new RoCrateEditorWidget() as any

    widget.assignedEntityId = 'dino1111.jpg'
    widget.localSelectedEntityId = 'dino1111.jpg'
    widget.baselineEntityId = 'dino1111.jpg'
    widget.baselineEntitySnapshot = widget.serializeEntitySnapshot(
      'dino1111.jpg',
      externallyRenamedCrate,
    )
    widget.dirtyState = false
    widget.setDirtyState = jest.fn((dirty: boolean) => {
      widget.dirtyState = dirty
    })
    widget.updateTitleLabel = jest.fn()
    widget.update = jest.fn()
    widget.validateCurrentCrate = jest.fn().mockResolvedValue(undefined)
    widget.onContentChangedEmitter = { fire: jest.fn() }
    widget.roCrateHistoryService = { applyRoCrateChange: jest.fn() }
    widget.appStateService = {
      roCrate: externallyRenamedCrate,
      dirty: false,
      isRoCrateDirty: jest.fn().mockReturnValue(true),
      registerEntityEditor: jest.fn(),
    }

    await widget.handleSaveCrate({
      crate: rejectedCrate,
      entityId: 'dino11.jpg',
    })

    expect(widget.appStateService.roCrate).toBe(rejectedCrate)
    expect(widget.getAssignedEntityId()).toBe('dino11.jpg')
    expect(widget.appStateService.dirty).toBe(true)
    expect(widget.dirty).toBe(true)
  })
})

describe('RoCrateEditorWidget entity fallback', () => {
  it('keeps the editor open and falls back to the root when the active entity is removed', async () => {
    const externallyRenamedCrate = crateWithFileId('dino1111.jpg')
    const rejectedCrate = crateWithFileId('dino11.jpg')
    const subscriptions: Array<(value: any) => unknown> = []
    const disposable = { dispose: jest.fn() }
    const widget = new RoCrateEditorWidget() as any

    widget.close = jest.fn()
    widget.update = jest.fn()
    widget.updateTitleLabel = jest.fn()
    widget.validateCurrentCrate = jest.fn().mockResolvedValue(undefined)
    widget.updateProfileWithEntitySchemas = jest.fn().mockResolvedValue(undefined)
    widget.schemaManagerService = {
      onDidChangeSchemas: jest.fn().mockReturnValue(disposable),
    }
    widget.messageService = {
      info: jest.fn(),
      error: jest.fn(),
    }
    widget.appStateService = {
      EIRCEIA: { 'test-editor': 'dino1111.jpg' },
      roCrate: externallyRenamedCrate,
      roCrateApproval: undefined,
      completeProfile: undefined,
      profileList: [],
      schemaSelectorContext: undefined,
      getInitialProfileTemplate: jest.fn().mockReturnValue({}),
      registerEntityEditor: jest.fn(),
      onDidChangeSelector: jest.fn(
        () => (listener: (value: any) => unknown) => {
          subscriptions.push(listener)
          return disposable
        },
      ),
    }

    await widget.initialize({
      instanceId: 'test-editor',
      entityId: 'dino1111.jpg',
    })

    expect(subscriptions).not.toHaveLength(0)
    await subscriptions[0](rejectedCrate)

    expect(widget.close).not.toHaveBeenCalled()
    expect(widget.getAssignedEntityId()).toBe('./')
    expect(widget.appStateService.registerEntityEditor).toHaveBeenLastCalledWith(
      'test-editor',
      './',
    )
  })

  it('selects the root before handleSaveCrate synchronously publishes a rejected crate', async () => {
    const externallyRenamedCrate = crateWithFileId('dino1111.jpg')
    const rejectedCrate = crateWithFileId('dino11.jpg')
    const subscriptions: Array<(value: any) => unknown> = []
    const publicationPromises: Array<Promise<unknown>> = []
    const entityIdsObservedDuringPublication: Array<string | undefined> = []
    const disposable = { dispose: jest.fn() }
    let currentCrate = externallyRenamedCrate
    let widget: any

    const appStateService: any = {
      EIRCEIA: { 'save-test-editor': 'dino1111.jpg' },
      roCrateApproval: undefined,
      completeProfile: undefined,
      profileList: [],
      schemaSelectorContext: undefined,
      dirty: false,
      getInitialProfileTemplate: jest.fn().mockReturnValue({}),
      isRoCrateDirty: jest.fn().mockReturnValue(true),
      registerEntityEditor: jest.fn(),
      onDidChangeSelector: jest.fn(
        () => (listener: (value: any) => unknown) => {
          subscriptions.push(listener)
          return disposable
        },
      ),
    }
    Object.defineProperty(appStateService, 'roCrate', {
      configurable: true,
      get: () => currentCrate,
      set: (nextCrate) => {
        if (nextCrate === currentCrate) {
          return
        }
        currentCrate = nextCrate
        entityIdsObservedDuringPublication.push(widget.getAssignedEntityId())
        const result = subscriptions[0]?.(nextCrate)
        publicationPromises.push(Promise.resolve(result))
      },
    })

    widget = new RoCrateEditorWidget() as any
    widget.close = jest.fn()
    widget.update = jest.fn()
    widget.updateTitleLabel = jest.fn()
    widget.validateCurrentCrate = jest.fn().mockResolvedValue(undefined)
    widget.updateProfileWithEntitySchemas = jest.fn().mockResolvedValue(undefined)
    widget.schemaManagerService = {
      onDidChangeSchemas: jest.fn().mockReturnValue(disposable),
    }
    widget.messageService = {
      info: jest.fn(),
      error: jest.fn(),
    }
    widget.appStateService = appStateService
    widget.roCrateHistoryService = {
      applyRoCrateChange: jest.fn((nextCrate) => {
        // The real history service publishes app state synchronously.
        appStateService.roCrate = nextCrate
        return true
      }),
    }

    await widget.initialize({
      instanceId: 'save-test-editor',
      entityId: 'dino1111.jpg',
    })

    await widget.handleSaveCrate({
      crate: rejectedCrate,
      // Recrate still reports the entity that Reject All just removed.
      entityId: 'dino1111.jpg',
    })
    await Promise.all(publicationPromises)

    expect(widget.roCrateHistoryService.applyRoCrateChange).toHaveBeenCalledWith(
      rejectedCrate,
      expect.any(Object),
    )
    expect(entityIdsObservedDuringPublication).toEqual(['./'])
    expect(widget.close).not.toHaveBeenCalled()
    expect(widget.getAssignedEntityId()).toBe('./')
    expect(appStateService.registerEntityEditor).toHaveBeenLastCalledWith(
      'save-test-editor',
      './',
    )
    expect(appStateService.roCrate).toBe(rejectedCrate)
  })
})

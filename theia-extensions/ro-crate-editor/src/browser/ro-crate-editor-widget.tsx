import type { SaveOptions } from '@theia/core/lib/browser/saveable'
import { SaveReason, setDirty } from '@theia/core/lib/browser/saveable'
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { CommandService } from '@theia/core/lib/common'
import { Emitter } from '@theia/core/lib/common/event'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { RoCrateHtmlGenerator } from 'aroma2-common/lib/browser';
import { inject, injectable } from 'inversify'
import * as React from 'react'
import { RoCrateHtmlGenerator } from 'save-ro-crate/lib/browser/ro-crate-html-generator'

import '@arpproject/recrate/style.css'
import { Message } from '@lumino/messaging'
import type { Disposable } from '@theia/core'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { SchemaManagerService } from 'metadata-schema-manager/lib/browser/services/metadata-schema-manager-service'

import { DescriboCrateBuilderWrapper } from './recrate-wrapper'

interface RoCrateEditorWidgetOptions {
  instanceId?: string
  entityId?: string
}

@injectable()
export class RoCrateEditorWidget extends ReactWidget {
  static readonly ID = 'rocrate-editor-widget'

  @inject(SchemaManagerService)
  protected readonly schemaManagerService: SchemaManagerService

  protected instanceId: string = ''
  protected assignedEntityId?: string

  @inject(AppStateService)
  protected readonly appStateService: AppStateService

  @inject(CommandService)
  protected readonly commandService: CommandService

  @inject(FileService)
  protected readonly fileService: FileService

  @inject(WorkspaceService)
  protected readonly workspaceService: WorkspaceService

  @inject(RoCrateHtmlGenerator)
  protected readonly roCrateHtmlGenerator: RoCrateHtmlGenerator

  protected readonly onDirtyChangedEmitter = new Emitter<void>()
  protected readonly onContentChangedEmitter = new Emitter<void>()
  protected dirtyState = false
  protected persistPromise?: Promise<void>

  protected crateSubscription?: Disposable
  protected profileSubscription?: Disposable
  protected selectedEntityIdSubscription?: Disposable
  protected dirtySubscription?: Disposable

  protected localCrate: Record<string, any> | undefined
  protected localProfile: Record<string, any> | undefined
  protected localSelectedEntityId: string | undefined
  protected conformsToIds: string[] = []
  protected isRefreshingProfile = false
  protected profileRevision = 0

  constructor() {
    super()
    this.addClass('rocrate-editor')
    this.title.closable = true
    this.node.tabIndex = 0
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg)
    this.node.addEventListener('mousedown', () => {
      this.activate()
    })
  }

  async initialize(options: RoCrateEditorWidgetOptions = {}): Promise<void> {
    this.instanceId =
      options.instanceId ??
      `${RoCrateEditorWidget.ID}:${Math.random().toString(36).substring(2)}`

    this.id = this.instanceId

    // Assign initial values from app-state on component load
    this.localCrate = this.appStateService.roCrate
    this.localProfile = this.appStateService.profile
    // Ensure localProfile is initialized if it's undefined from app state
    if (!this.localProfile) {
      this.localProfile = { classes: {}, layouts: [], localisation: {} }
    }
    this.setDirtyState(this.appStateService.dirty)

    this.crateSubscription = this.appStateService.onDidChangeSelector((s) => s.roCrate)(
      (crate) => {
        this.localCrate = crate
        console.log('crate update')
        this.updateTitleLabel()
        this.update()
        const entityId = this.localSelectedEntityId ?? this.assignedEntityId ?? './'
        const nextConformsToIds = this.extractConformsToIds(entityId)
        if (!this.isSameStringSet(this.conformsToIds, nextConformsToIds)) {
          this.conformsToIds = nextConformsToIds
          void this.refreshProfileForSelectedEntity()
        }
      },
    )
    this.profileSubscription = this.appStateService.onDidChangeSelector((s) => s.profile)(
      (profile) => {
        this.localProfile = profile
        console.log('profile update')
        this.profileRevision += 1
        this.update()
      },
    )
    this.dirtySubscription = this.appStateService.onDidChangeSelector((s) => s.dirty)(
      (dirty) => {
        this.setDirtyState(dirty)
      },
    )
    this.selectedEntityIdSubscription = this.appStateService.onDidChangeSelector(
      (s) => s.selectedEntityId,
    )(async (selectedEntityId) => {
      if (selectedEntityId === this.assignedEntityId) {
        const prev = this.localSelectedEntityId
        this.localSelectedEntityId = selectedEntityId
        console.log('selectedEntityId update', { prev, next: selectedEntityId })
        this.updateTitleLabel()
        this.update()
        await this.refreshProfileForSelectedEntity()
      }
    })

    const persistedEntity = this.appStateService.getEntityForWidget(this.instanceId)
    const initialEntity =
      persistedEntity ?? options.entityId ?? this.appStateService.selectedEntityId ?? './'
    this.assignEntity(initialEntity)

    await this.refreshProfileForSelectedEntity()
  }

  protected handleSaveCrate = (saveData: any) => {
    console.log('saveData', saveData)
    const crate = saveData && (saveData as any).crate ? (saveData as any).crate : saveData
    this.appStateService.roCrate = crate
    this.localCrate = crate
    const isDirty = this.appStateService.isRoCrateDirty(crate)
    this.appStateService.dirty = isDirty
    this.onContentChangedEmitter.fire()
  }

  protected handleNavigation = (entity: any) => {
    const nextId = entity && entity['@id']
    console.log('navigation event', entity)
    if (!nextId || nextId === this.assignedEntityId) {
      return
    }
    const prevId = this.assignedEntityId
    this.assignEntity(nextId)
    this.appStateService.selectedEntityId = nextId
    console.log('selectedEntityId set', {
      prev: prevId,
      next: this.appStateService.selectedEntityId,
    })
  }

  protected handleSetProfile = (profile: any) => {
    this.appStateService.profile = profile
    this.localProfile = profile
  }

  protected handleOpenSchemaManager = (requested: boolean) => {
    if (requested) {
      this.appStateService.openSchemaSelectorWindow = true
    }
  }

  render(): React.ReactNode {
    console.log('conformsToIds', this.conformsToIds)
    return (
      <div style={{ padding: '1rem' }}>
        <h3>Panel ID:</h3>
        <pre>{this.instanceId}</pre>
        <DescriboCrateBuilderWrapper
          crate={this.localCrate}
          profile={this.localProfile}
          entityId={this.localSelectedEntityId}
          profileKey={this.profileRevision}
          onSaveCrate={this.handleSaveCrate}
          onNavigation={this.handleNavigation}
          //onSetProfile={this.handleSetProfile}
          onOpenSchemaManager={this.handleOpenSchemaManager}
        />
      </div>
    )
  }

  get dirty(): boolean {
    return this.dirtyState
  }

  get onDirtyChanged() {
    return this.onDirtyChangedEmitter.event
  }

  get onContentChanged() {
    return this.onContentChangedEmitter.event
  }

  async save(options?: SaveOptions): Promise<void> {
    const reason = options?.saveReason
    if (reason === SaveReason.AfterDelay || reason === SaveReason.FocusChange) {
      await this.persistRoCrateToDisk()
      return
    }
    try {
      await this.commandService.executeCommand('ro-crate.save')
    } catch (error) {
      console.error('Failed to save RO-Crate via command:', error)
    }
  }

  protected assignEntity(entityId: string): void {
    if (!this.id) {
      return
    }
    const prev = this.assignedEntityId
    this.assignedEntityId = entityId
    this.localSelectedEntityId = entityId
    this.appStateService.registerEntityEditor(this.id, entityId)
    console.log('Assigned entity to widget', { widget: this.id, prev, next: entityId })
    this.updateTitleLabel()
  }

  protected updateTitleLabel(): void {
    const entityId = this.assignedEntityId ?? './'
    const entityDisplay = this.getEntityDisplayName(entityId)
    this.title.label = `ROC-edit:${entityDisplay}`
  }

  protected getEntityDisplayName(entityId: string): string {
    if (entityId === './') {
      return './'
    }
    const rawGraph = this.localCrate?.['@graph']
    const graph = Array.isArray(rawGraph) ? (rawGraph as Record<string, any>[]) : []
    const entity = graph.find(
      (entry) => entry && typeof entry === 'object' && String(entry['@id']) === entityId,
    )
    if (entity) {
      const name = entity.name ?? entity.title ?? entity['@id']
      if (typeof name === 'string' && name.trim()) {
        return name.trim()
      }
    }
    return entityId
  }

  protected computeConformsToIdsForSelectedEntity(): void {
    const entityId = this.localSelectedEntityId ?? this.assignedEntityId ?? './'
    this.conformsToIds = this.extractConformsToIds(entityId)
  }

  protected extractConformsToIds(entityId: string): string[] {
    const rawGraph = this.localCrate?.['@graph']
    const graph = Array.isArray(rawGraph) ? (rawGraph as Record<string, any>[]) : []
    const entity = graph.find(
      (entry) => entry && typeof entry === 'object' && String(entry['@id']) === entityId,
    )
    const value: any = entity?.conformsTo
    const ids: string[] = []
    const pushId = (val: any) => {
      if (!val) return
      if (typeof val === 'string') {
        const t = val.trim()
        if (t) ids.push(t)
        return
      }
      if (typeof val === 'object') {
        const idVal = (val as any)['@id'] ?? (val as any).id
        if (typeof idVal === 'string') {
          const t = idVal.trim()
          if (t) ids.push(t)
        }
      }
    }
    if (Array.isArray(value)) {
      for (const v of value) pushId(v)
    } else {
      pushId(value)
    }
    return Array.from(new Set(ids))
  }

  protected isSameStringSet(a: string[], b: string[]): boolean {
    if (a.length !== b.length) {
      return false
    }
    const setA = new Set(a)
    if (setA.size !== b.length) {
      return false
    }
    for (const value of b) {
      if (!setA.has(value)) {
        return false
      }
    }
    return true
  }

  protected async refreshProfileForSelectedEntity(): Promise<void> {
    if (this.isRefreshingProfile) {
      return
    }
    this.isRefreshingProfile = true
    try {
      this.computeConformsToIdsForSelectedEntity()
      const conformsToUrls = this.schemaManagerService.convertW3idUrlsToCedarTemplateUrls(
        this.conformsToIds,
      )
      const allSchemas = await this.schemaManagerService.loadAllSchemas()
      for (const conformsToUrl of conformsToUrls) {
        const matchingSchema = allSchemas.find(
          (schema) => schema.reference === conformsToUrl,
        )
        if (matchingSchema) {
          const convertedContent =
            await this.schemaManagerService.getConvertedProfileContent(
              matchingSchema.path,
            )
          if (convertedContent) {
            const currentCrate = this.localCrate || { '@graph': [] }
            const baseProfile = this.appStateService.profile ||
              this.localProfile || { classes: {}, layouts: [], localisation: {} }
            const merged = await this.schemaManagerService.getMergedProfile(
              currentCrate,
              convertedContent,
              baseProfile,
            )
            this.localProfile = merged
            this.appStateService.profile = merged
            this.profileRevision += 1
          }
        }
      }
      this.update()
    } finally {
      this.isRefreshingProfile = false
    }
  }

  protected setDirtyState(dirty: boolean): void {
    if (this.dirtyState === dirty) {
      return
    }
    this.dirtyState = dirty
    setDirty(this, dirty)
    this.onDirtyChangedEmitter.fire()
  }

  protected unregisterFromAppState(): void {
    if (!this.id) {
      return
    }
    this.appStateService.unregisterEntityEditor(this.id)
  }

  getAssignedEntityId(): string | undefined {
    return this.assignedEntityId
  }

  protected async persistRoCrateToDisk(): Promise<void> {
    if (!this.appStateService.roCrate) {
      return
    }
    if (this.persistPromise) {
      return this.persistPromise
    }
    this.persistPromise = this.writeRoCrateFiles()
    try {
      await this.persistPromise
    } finally {
      this.persistPromise = undefined
    }
  }

  protected async writeRoCrateFiles(): Promise<void> {
    const crateData = this.appStateService.roCrate
    const roots = this.workspaceService.tryGetRoots()
    const rootUri = roots?.[0]?.resource
    if (!crateData || !rootUri) {
      return
    }
    const metadataUri = rootUri.resolve('ro-crate-metadata.json')
    const previewUri = rootUri.resolve('ro-crate-preview.html')
    try {
      await this.fileService.create(metadataUri, JSON.stringify(crateData, null, 2), {
        overwrite: true,
      })
      const htmlContent = this.roCrateHtmlGenerator.generate(crateData)
      await this.fileService.create(previewUri, htmlContent, { overwrite: true })
      this.appStateService.setRoCrateSnapshot(crateData)
      this.appStateService.dirty = false
    } catch (error) {
      console.error('Failed to persist RO-Crate metadata:', error)
    }
  }

  dispose(): void {
    this.unregisterFromAppState()
    this.crateSubscription?.dispose()
    this.profileSubscription?.dispose()
    this.selectedEntityIdSubscription?.dispose()
    this.dirtySubscription?.dispose()
    this.onDirtyChangedEmitter.dispose()
    this.onContentChangedEmitter.dispose()
    super.dispose()
  }
}

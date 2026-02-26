import type { Navigatable } from '@theia/core/lib/browser'
import type { SaveOptions } from '@theia/core/lib/browser/saveable'
import { SaveReason, setDirty } from '@theia/core/lib/browser/saveable'
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { CommandService } from '@theia/core/lib/common'
import { Emitter } from '@theia/core/lib/common/event'
import URI from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import { RoCrateHtmlGenerator, MetadataSchemaManager, SchemaValidatorManager, SchemaValidator } from 'aroma2-common/lib/browser';
import { inject, injectable } from 'inversify'
import * as React from 'react'

import '@arpproject/recrate/style.css'
import { Message } from '@lumino/messaging'
import type { Disposable } from '@theia/core'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'

import { DescriboCrateBuilderWrapper } from './recrate-wrapper'

interface RoCrateEditorWidgetOptions {
  instanceId?: string
  entityId?: string
}

@injectable()
export class RoCrateEditorWidget extends ReactWidget implements Navigatable {
  static readonly ID = 'rocrate-editor-widget'

  @inject(MetadataSchemaManager)
  protected readonly schemaManagerService: MetadataSchemaManager

  @inject(SchemaValidatorManager)
  protected readonly schemaValidator: SchemaValidator

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
  protected completeProfileSubscription?: Disposable
  protected eirceiaSubscription?: Disposable
  protected dirtySubscription?: Disposable
  protected schemasSubscription?: Disposable

  protected localCrate: Record<string, any> | undefined
  protected localProfile: Record<string, any> | undefined
  protected baseProfile: Record<string, any> | undefined
  protected localCompleteProfile: Record<string, any> | undefined
  protected localSelectedEntityId: string | undefined
  protected isRefreshingProfile = false
  protected pendingSchemasRefresh = false
  protected profileRevision = 0
  protected async validateCurrentCrate(): Promise<void> {
    const crate = this.localCrate ?? this.appStateService.roCrate
    const baseProfile = this.baseProfile
    const profile = this.localProfile
    const completeProfile = this.localCompleteProfile

    this.appStateService.validationErrors = []

    if (!crate || !Array.isArray(crate['@graph']) || !baseProfile || !profile || !completeProfile) {
      return
    }

    const baseProfileClone = JSON.parse(JSON.stringify(baseProfile))
    const validationErrors = await this.schemaValidator.validateEntities(
      crate,
      baseProfileClone,
      profile,
      completeProfile,
    )
    this.appStateService.validationErrors = validationErrors
  }

  constructor() {
    super()
    this.addClass('rocrate-editor')
    this.title.closable = true
    this.node.tabIndex = 0
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg)
  }

  protected async onActivateRequest(msg: Message): Promise<void> {
    super.onActivateRequest(msg)
    const entityId = this.assignedEntityId ?? this.localSelectedEntityId ?? './'
    if (this.baseProfile) {
      await this.updateProfileWithEntitySchemas(this.baseProfile, entityId)
    }
    this.update()
  }

  async initialize(options: RoCrateEditorWidgetOptions = {}): Promise<void> {
    this.instanceId =
      options.instanceId ??
      `${RoCrateEditorWidget.ID}:${Math.random().toString(36).substring(2)}`

    this.id = this.instanceId

    try {
      const mapping = this.appStateService.EIRCEIA
      const storedEntityId = mapping && this.id in mapping ? mapping[this.id] : undefined
      const trimmed = typeof storedEntityId === 'string' ? storedEntityId.trim() : ''

      if (trimmed) {
        this.localSelectedEntityId = trimmed
        console.log('RoCrateEditorWidget: entityId loaded from app-state', {
          widget: this.id,
          entityId: trimmed,
        })
      } else {
        console.warn('RoCrateEditorWidget: no entityId in app-state for widget', {
          widget: this.id,
        })
      }
    } catch (error) {
      console.error('RoCrateEditorWidget: failed to read entityId from app-state', {
        widget: this.id,
        error,
      })
    }

    // Assign initial values from app-state on component load
    this.localCrate = this.appStateService.roCrate
    this.localCompleteProfile = this.appStateService.completeProfile
    this.baseProfile = this.appStateService.getInitialProfileTemplate()
    this.localProfile = this.baseProfile ? JSON.parse(JSON.stringify(this.baseProfile)) : this.baseProfile
    console.log("baseProfile", this.baseProfile)
    console.log("localCompleteProfile", this.localCompleteProfile)
    this.setDirtyState(this.appStateService.dirty)

    this.crateSubscription = this.appStateService.onDidChangeSelector((s) => s.roCrate)(
      async (crate) => {
        this.localCrate = crate
        console.log('crate update')
        this.updateTitleLabel()
        const entityId = this.assignedEntityId ?? this.localSelectedEntityId ?? './'
        await this.updateProfileWithEntitySchemas(this.baseProfile!, entityId)
        this.update()
      },
    )
    this.completeProfileSubscription = this.appStateService.onDidChangeSelector(
      (s) => s.completeProfile,
    )((profile) => {
      this.localCompleteProfile = profile
      this.updateTitleLabel()
    })
    this.dirtySubscription = this.appStateService.onDidChangeSelector((s) => s.dirty)(
      (dirty) => {
        this.setDirtyState(dirty)
      },
    )

    this.schemasSubscription = this.schemaManagerService.onDidChangeSchemas(async () => {
      if (!this.baseProfile || !this.localCrate) {
        return
      }
      const entityId = this.assignedEntityId ?? this.localSelectedEntityId ?? './'
      await this.updateProfileWithEntitySchemas(this.baseProfile, entityId)
      this.update()
    })

    this.eirceiaSubscription = this.appStateService.onDidChangeSelector((s) => s.EIRCEIA)(
      async (mapping) => {
        const storedEntityId = mapping?.[this.id]
        const trimmed = typeof storedEntityId === 'string' ? storedEntityId.trim() : ''
        if (!trimmed) {
          return
        }

        if (trimmed === this.assignedEntityId) {
          if (this.localSelectedEntityId !== trimmed) {
            this.localSelectedEntityId = trimmed
            this.updateTitleLabel()
            this.update()
          }
          return
        }

        const prev = this.assignedEntityId
        this.assignedEntityId = trimmed
        this.localSelectedEntityId = trimmed
        console.log('RoCrateEditorWidget: entityId updated from app-state', {
          widget: this.id,
          prev,
          next: trimmed,
        })
        this.updateTitleLabel()
        this.update()
        if (this.baseProfile && this.localCrate) {
          await this.updateProfileWithEntitySchemas(this.baseProfile, trimmed)
        }
      },
    )

    this.schemasSubscription = this.schemaManagerService.onDidChangeSchemas(async () => {
      if (this.isRefreshingProfile) {
        this.pendingSchemasRefresh = true
        return
      }
      if (!this.baseProfile || !this.localCrate) {
        return
      }
      const entityId = this.assignedEntityId ?? this.localSelectedEntityId ?? './'
      await this.updateProfileWithEntitySchemas(this.baseProfile, entityId)
      this.update()
    })

    const initialEntity = this.localSelectedEntityId ?? options.entityId ?? './'

    this.assignEntity(initialEntity)

    if (this.baseProfile && this.localCrate && Array.isArray(this.localCrate['@graph'])) {
      await this.updateProfileWithEntitySchemas(
        this.baseProfile,
        this.assignedEntityId ?? this.localSelectedEntityId ?? './',
      )
    }

    await this.validateCurrentCrate()
  }

  protected handleSaveCrate = async (saveData: any) => {
    console.log('saveData', saveData)
    const crate = saveData && (saveData as any).crate ? (saveData as any).crate : saveData
    this.appStateService.roCrate = crate
    this.localCrate = crate

    await this.validateCurrentCrate()

    const isDirty = this.appStateService.isRoCrateDirty(crate)
    this.appStateService.dirty = isDirty
    this.onContentChangedEmitter.fire()
  }

  protected handleNavigation = (entity: any) => {
    const nextId = entity && entity['@id']
    console.log('navigation event', entity)
    if (!nextId) {
      console.warn('handleNavigation: missing entity id', { entity })
      return
    }
    if (nextId === this.assignedEntityId) {
      return
    }
    const prevId = this.assignedEntityId
    this.assignEntity(nextId)
    console.log('RoCrateEditorWidget: entityId set from navigation', {
      widget: this.id,
      prev: prevId,
      next: nextId,
    })
  }

  protected handleSetProfile = (profile: any) => {
    this.localProfile = profile
    this.profileRevision += 1
    this.update()
  }

  protected handleOpenSchemaManager = (requested: boolean) => {
    if (!requested || !this.id) {
      return
    }
    const entityId = this.assignedEntityId ?? this.localSelectedEntityId ?? './'
    this.appStateService.updateState({
      openSchemaSelectorWindow: true,
      schemaSelectorContext: { widgetId: this.id, entityId },
    })
  }

  protected handleRemoveProfile = async (payload: any) => {
    console.log('handleRemoveProfile', payload)
    const entityId = payload?.entityId ?? this.localSelectedEntityId
    const profileUrl = payload?.tab?.profileUrl

    if (!entityId || !profileUrl) {
      return
    }

    const targetUrl = typeof profileUrl === 'string' ? profileUrl.trim() : ''
    const crate = this.appStateService.roCrate ?? this.localCrate
    if (!crate || !targetUrl) {
      return
    }
    const graph = Array.isArray(crate['@graph']) ? (crate['@graph'] as any[]) : []
    const index = graph.findIndex(
      (e) => e && typeof e === 'object' && String(e['@id']) === entityId,
    )
    if (index < 0) {
      return
    }
    const entity = { ...graph[index] }
    const value: any = entity.conformsTo
    const matches = (v: any) => {
      if (!v) return false
      if (typeof v === 'string') return v.trim() === targetUrl
      const idVal = (v as any)['@id'] ?? (v as any).id
      return typeof idVal === 'string' && idVal.trim() === targetUrl
    }
    let updatedConformsTo: any
    if (Array.isArray(value)) {
      updatedConformsTo = value.filter((v) => !matches(v))
    } else {
      updatedConformsTo = matches(value) ? undefined : value
    }
    if (
      !updatedConformsTo ||
      (Array.isArray(updatedConformsTo) && updatedConformsTo.length === 0)
    ) {
      delete (entity as any).conformsTo
    } else {
      ;(entity as any).conformsTo = updatedConformsTo
    }
    const updatedGraph = [...graph]
    updatedGraph[index] = entity
    const updatedCrate = { ...crate, '@graph': updatedGraph }
    this.appStateService.roCrate = updatedCrate
    this.localCrate = updatedCrate
    const schemaName = this.schemaManagerService.nameWithoutMetadataSuffix(
      payload?.tab?.name,
    )
    const profile = this.localProfile
    await this.removeSchemaMetadata(updatedCrate, entityId, schemaName, profile, targetUrl)
    await this.handleSaveCrate(updatedCrate)
    this.update()
    await this.updateProfileWithEntitySchemas(this.baseProfile!, entityId)
  }

  render(): React.ReactNode {
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
          onOpenSchemaManager={this.handleOpenSchemaManager}
          onRemoveProfile={this.handleRemoveProfile}
        />
      </div>
    )
  }

  getResourceUri(): URI | undefined {
    if (!this.id) {
      return undefined
    }
    const entityId = this.assignedEntityId ?? './'
    const encodedWidgetId = encodeURIComponent(this.id)
    const encodedEntityId = encodeURIComponent(entityId)
    return new URI(`rocrate:/editor/${encodedWidgetId}/${encodedEntityId}`)
  }

  createMoveToUri(resourceUri: URI): URI | undefined {
    if (resourceUri.scheme === 'rocrate') {
      return resourceUri
    }
    return undefined
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

      await this.validateCurrentCrate()

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
    this.updateOpenEditorsLabel()
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

  protected updateOpenEditorsLabel(): void {
    const entityId = this.assignedEntityId ?? './'
    const entityType = this.getEntityDisplayType(entityId)
    const entityDisplay = this.getEntityDisplayName(entityId)
    this.title.caption = `${entityType} - ${entityDisplay}`
  }

  protected getEntityDisplayType(entityId: string): string {
    const rawGraph = this.localCrate?.['@graph']
    const graph = Array.isArray(rawGraph) ? (rawGraph as Record<string, any>[]) : []
    const entity = graph.find(
      (entry) => entry && typeof entry === 'object' && String(entry['@id']) === entityId,
    )
    if (!entity) {
      return 'Unknown'
    }
    const typeLabels = this.getEntityTypeLabels(entity, this.localCompleteProfile)
    if (!typeLabels.length) {
      return 'Unknown'
    }
    return typeLabels[0]
  }

  protected getEntityTypeLabels(
    entity: Record<string, any>,
    profile?: Record<string, any>,
  ): string[] {
    const rawTypes = entity?.['@type']
    if (!rawTypes) {
      return ['Unknown']
    }
    const typeList = Array.isArray(rawTypes) ? rawTypes : [rawTypes]
    const filtered = this.stripCreativeWork(typeList.map((type) => String(type).trim()))
    return filtered.map((raw) => {
      const tail = raw.includes('/') ? raw.split('/').pop() || raw : raw
      const localized = profile?.localisation?.[tail] ?? profile?.classes?.[tail]?.label
      return localized?.trim() || this.formatTypeLabel(tail)
    })
  }

  protected stripCreativeWork(types: string[]): string[] {
    if (types.length <= 1) {
      return types
    }
    const filtered = types.filter((type) => {
      const value = String(type)
      return value !== 'CreativeWork' && !value.endsWith('/CreativeWork')
    })
    return filtered.length ? filtered : types
  }

  protected formatTypeLabel(rawType: string): string {
    const trimmed = rawType.trim()
    if (!trimmed) {
      return 'Unknown'
    }
    const tail = trimmed.includes('/') ? trimmed.split('/').pop() || trimmed : trimmed
    return tail.charAt(0).toUpperCase() + tail.slice(1)
  }

  protected computeConformsToIdsForSelectedEntity(entityId: string): string[] {
    if (!entityId) {
      return []
    }
    return this.extractConformsToIds(entityId)
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

  protected async updateProfileWithEntitySchemas(baseProfile: Record<string, any>, entityId: string) {
    if (this.isRefreshingProfile) {
      return
    }

    this.isRefreshingProfile = true

    try {
      if (!this.localCrate || !Array.isArray(this.localCrate['@graph'])) {
        return
      }

      const entity = this.findEntity(this.localCrate, entityId)
      if (!entity) {
        return
      }

      const entityType = Array.isArray(entity["@type"]) ? entity["@type"][0] : entity["@type"]
      if (entityType !== 'Dataset' && entityType !== 'File') {
        this.localProfile = JSON.parse(JSON.stringify(this.localCompleteProfile))
        this.profileRevision += 1
        this.update()
        return
      }

      const conformsTos = this.computeConformsToIdsForSelectedEntity(entityId)
      if (!conformsTos || conformsTos.length === 0) {
        this.localProfile = JSON.parse(JSON.stringify(baseProfile))
        this.profileRevision += 1
        this.update()
        return
      }

      const allSchemas = await this.schemaManagerService.loadAllSchemas()

      let updateProfile = JSON.parse(JSON.stringify(baseProfile))
      let didUpdateProfile = false
      let foundMatchingSchema = false
      for (const conformsToUrl of conformsTos) {
        const matchingSchema = allSchemas.find((schema) => schema.conformsTo === conformsToUrl)

        if (matchingSchema) {
          foundMatchingSchema = true
          const convertedContent = await this.schemaManagerService.getConvertedProfileContent(matchingSchema.files.convertedPath)

          if (convertedContent && this.localCrate) {
            const merged = await this.schemaManagerService.getMergedProfile(
              this.localCrate!,
              convertedContent,
              updateProfile,
              conformsToUrl,
            )
            updateProfile = merged
            didUpdateProfile = true
            this.updateEntityConformsTo(entityId, conformsToUrl)
          }
        } else {
          console.warn(`No schema found for conformsTo URL: ${conformsToUrl}`)
        }
      }
      if (didUpdateProfile || !foundMatchingSchema) {
        this.localProfile = updateProfile
        this.profileRevision += 1
      }
      this.update()
    } finally {
      await this.validateCurrentCrate()
      this.isRefreshingProfile = false

      if (this.pendingSchemasRefresh) {
        this.pendingSchemasRefresh = false
        const baseProfile = this.baseProfile
        const crate = this.localCrate
        const entityId = this.assignedEntityId ?? this.localSelectedEntityId ?? './'
        if (baseProfile && crate) {
          queueMicrotask(() => {
            void this.updateProfileWithEntitySchemas(baseProfile, entityId)
          })
        }
      }
    }
  }


  protected findEntity(crate: Record<string, any>, id: string) {
    return (crate['@graph'] as Record<string, any>[]).find(
      (entity) => entity['@id'] === id,
    )
  }

  protected updateEntityConformsTo(entityId: string, conformsToUrl: string) {
    const crate = this.appStateService.roCrate ?? this.localCrate
    if (!crate || !entityId || !conformsToUrl) {
      return
    }
    const entity = this.findEntity(crate, entityId)
    if (!entity) {
      return
    }

    const rawConformsTo = entity.conformsTo
    const conformsToField = Array.isArray(rawConformsTo)
      ? [...rawConformsTo]
      : rawConformsTo
        ? [rawConformsTo]
        : []
    const trimmedConformsToUrl = conformsToUrl.trim()
    if (
      conformsToField.some((v: any) =>
        typeof v === 'string'
          ? v.trim() === trimmedConformsToUrl
          : (v as any)['@id'] === trimmedConformsToUrl || (v as any).id === trimmedConformsToUrl,
      )
    ) {
      return
    }
    conformsToField.push({ '@id': trimmedConformsToUrl })
    entity.conformsTo = conformsToField

    this.handleSaveCrate(crate)
  }

  protected async removeSchemaMetadata(
    crate: Record<string, any>,
    entityId: string,
    layout: string | null,
    profile: Record<string, any> | undefined,
    profileUrl?: string,
    keepOrphans = false,
  ) {
    const entity = this.findEntity(crate, entityId)
    if (!entity || !entity['@type']) return

    const entityType = Array.isArray(entity['@type']) ? entity['@type'][0] : entity['@type']
    const inputNames: string[] = []

    if (profile && entityType && profile.classes && profile.classes[entityType]) {
      const classProfile = profile.classes[entityType]
      if (classProfile && Array.isArray(classProfile.inputs)) {
        for (const input of classProfile.inputs) {
          if (layout && input.group === layout && input?.name) {
            inputNames.push(input.name)
          }
        }
      }
    }

    if (inputNames.length === 0 && profileUrl) {
      const allSchemas = await this.schemaManagerService.loadAllSchemas()
      const matchingSchema = allSchemas.find(
        (schema) => schema.conformsTo === profileUrl || schema.aux.reference === profileUrl,
      )
      if (matchingSchema) {
        const convertedContent = await this.schemaManagerService.getConvertedProfileContent(
          matchingSchema.files.convertedPath,
        )
        const schemaInputs = convertedContent?.classes?.Dataset?.inputs
        if (Array.isArray(schemaInputs)) {
          for (const input of schemaInputs) {
            if (input?.name) {
              inputNames.push(input.name)
            }
          }
        }
      }
    }

    for (const inputName of inputNames) {
      const value = (entity as any)[inputName]
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && item['@id']) {
            this.removeEntityFromGraph(crate, item['@id'], keepOrphans)
          }
        }
      } else if (value && typeof value === 'object' && value['@id']) {
        this.removeEntityFromGraph(crate, value['@id'], keepOrphans)
      }
      if (value !== undefined) {
        delete (entity as any)[inputName]
      }
    }
    await this.updateProfileWithEntitySchemas(this.baseProfile!, entityId)
    this.update()
  }

  protected removeEntityFromGraph(
    crate: Record<string, any>,
    entityId: string,
    keepOrphans: boolean = false,
  ) {
    const entityToRemove = this.findEntity(crate, entityId)

    if (entityToRemove) {
      // Check if child entities exist and try to remove them
      for (const key in entityToRemove) {
        if (entityToRemove[key]['@id']) {
          this.removeEntityFromGraph(crate, entityToRemove[key]['@id'], keepOrphans)
        }
      }

      const graph = crate['@graph'] as Record<string, any>[]

      // If keepOrphans is true, we don't check for references and move on.
      if (!keepOrphans) {
        let referenceCount = 0

        for (const entity of graph) {
          for (const key in entity) {
            if (
              entity[key]['@id'] &&
              entity[key]['@id'] === entityId &&
              entity['@id'] !== entityId
            ) {
              referenceCount++
            }
          }
        }

        if (referenceCount <= 1) {
          const entityIndex = graph.indexOf(entityToRemove)
          if (entityIndex !== -1) {
            graph.splice(entityIndex, 1)
          }
        }
      }
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

    // Perform validation before saving
    const crate = this.appStateService.roCrate;
    const profile = this.localProfile;
    const completeProfile = this.localCompleteProfile;

    if (crate && profile && completeProfile) {
      await this.validateCurrentCrate()
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
    this.completeProfileSubscription?.dispose()
    this.eirceiaSubscription?.dispose()
    this.dirtySubscription?.dispose()
    this.schemasSubscription?.dispose()
    this.schemasSubscription?.dispose()
    this.onDirtyChangedEmitter.dispose()
    this.onContentChangedEmitter.dispose()
    super.dispose()
  }
}

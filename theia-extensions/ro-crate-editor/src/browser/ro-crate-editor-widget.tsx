import type { Navigatable } from '@theia/core/lib/browser'
import type { SaveOptions } from '@theia/core/lib/browser/saveable'
import { SaveReason, setDirty } from '@theia/core/lib/browser/saveable'
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { CommandService, MessageService } from '@theia/core/lib/common'
import { Emitter } from '@theia/core/lib/common/event'
import URI from '@theia/core/lib/common/uri'
import { FileService } from '@theia/filesystem/lib/browser/file-service'
import { WorkspaceService } from '@theia/workspace/lib/browser'
import {
  MetadataSchemaManager,
  RoCrateHtmlGenerator,
  SchemaValidator,
  SchemaValidatorManager,
  type ValidationError,
} from 'aroma2-common/lib/browser'
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

type NavigationEntity = { ['@id']?: string } & Record<string, unknown>

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

  @inject(MessageService)
  protected readonly messageService: MessageService

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
  protected profileListSubscription?: Disposable
  protected eirceiaSubscription?: Disposable
  protected schemasSubscription?: Disposable

  protected localCrate: Record<string, any> | undefined
  protected localProfile: Record<string, any> | undefined
  protected baseProfile: Record<string, any> | undefined
  protected localCompleteProfile: Record<string, any> | undefined
  protected localSelectedEntityId: string | undefined
  protected isRefreshingProfile = false
  protected pendingSchemasRefresh = false
  protected pendingSchemasRefreshBaseProfile?: Record<string, any>
  protected pendingSchemasRefreshEntityId?: string
  protected profileRevision = 0
  protected lastSeenNonMissingProfileCount = 0
  protected lastFocusedElement?: HTMLElement
  protected lastSelectionStart?: number
  protected lastSelectionEnd?: number

  protected lastAppliedEntityId?: string
  protected lastAppliedCrate: Record<string, any> | undefined
  protected lastAppliedProfileList: Record<string, any> | undefined
  protected lastAppliedConformsTo: string[] = []

  protected baselineEntityId?: string
  protected baselineEntitySnapshot?: string

  protected validationTimer?: ReturnType<typeof setTimeout>
  protected validationRun = 0

  protected normalizeValidationErrors(
    errors: ValidationError[] | undefined,
  ): ValidationError[] {
    if (!errors || errors.length === 0) {
      return []
    }

    const seen = new Set<string>()
    const result: ValidationError[] = []

    for (const error of errors) {
      if (!error) {
        continue
      }
      const key = [
        error.entityId ?? '',
        error.entityType ?? '',
        error.fieldName ?? '',
        error.fieldLabel ?? '',
        error.errorCode ?? '',
        error.error ?? '',
        error.path ?? '',
      ].join('|')

      if (seen.has(key)) {
        continue
      }

      seen.add(key)
      result.push(error)
    }

    return result
  }

  protected async validateCurrentCrate(): Promise<void> {
    const run = ++this.validationRun

    if (this.validationTimer) {
      clearTimeout(this.validationTimer)
    }

    this.validationTimer = setTimeout(() => {
      this.validationTimer = undefined

      const idle: any = (globalThis as any).requestIdleCallback
      if (typeof idle === 'function') {
        idle(
          () => {
            void this.performCrateValidation(run)
          },
          { timeout: 1500 },
        )
        return
      }

      void this.performCrateValidation(run)
    }, 500)
  }

  protected async performCrateValidation(run: number): Promise<void> {
    const crate = this.localCrate ?? this.appStateService.roCrate
    const baseProfile = this.baseProfile

    if (!crate || !Array.isArray(crate['@graph']) || !baseProfile) {
      if (run === this.validationRun) {
        this.appStateService.validationErrors = []
      }
      return
    }

    if (run === this.validationRun) {
      this.appStateService.validationErrors = []
    }

    let validationErrors: ValidationError[] | undefined
    try {
      const baseProfileClone = JSON.parse(JSON.stringify(baseProfile))
      validationErrors = await this.schemaValidator.validateEntities(
        crate,
        baseProfileClone,
      )
    } catch (error) {
      console.warn('RoCrateEditorWidget: validation failed', error)
      validationErrors = []
    }

    if (run !== this.validationRun) {
      return
    }

    this.appStateService.validationErrors = this.normalizeValidationErrors(validationErrors)
  }

  constructor() {
    super()
    this.addClass('rocrate-editor')
    this.title.closable = true
    this.title.iconClass = 'fa fa-pencil-square-o'
    this.node.tabIndex = 0
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg)
    this.node.addEventListener('focusin', this.handleFocusIn, true)
  }

  protected handleFocusIn = (e: Event): void => {
    const t = e.target as any
    this.lastFocusedElement = t as HTMLElement
    if (t && typeof t.selectionStart === 'number' && typeof t.selectionEnd === 'number') {
      this.lastSelectionStart = t.selectionStart
      this.lastSelectionEnd = t.selectionEnd
    }
  }

  protected async onActivateRequest(msg: Message): Promise<void> {
    super.onActivateRequest(msg)
    if (this.node && typeof (this.node as any).focus === 'function') {
      ;(this.node as any).focus()
    }
    if (this.lastFocusedElement && this.node.contains(this.lastFocusedElement)) {
      const el: any = this.lastFocusedElement
      if (el && typeof el.focus === 'function') {
        el.focus()
        if (
          typeof this.lastSelectionStart === 'number' &&
          typeof this.lastSelectionEnd === 'number' &&
          typeof el.setSelectionRange === 'function'
        ) {
          try {
            el.setSelectionRange(this.lastSelectionStart, this.lastSelectionEnd)
          } catch {}
        }
      }
    }
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

    this.localCrate = this.appStateService.roCrate
    this.localCompleteProfile = this.appStateService.completeProfile
    this.baseProfile = this.appStateService.getInitialProfileTemplate()
    this.localProfile = this.baseProfile
      ? JSON.parse(JSON.stringify(this.baseProfile))
      : this.baseProfile
    console.log('baseProfile', this.baseProfile)
    console.log('localCompleteProfile', this.localCompleteProfile)
    this.setDirtyState(false)
    this.lastSeenNonMissingProfileCount = Array.isArray(this.appStateService.profileList)
      ? this.appStateService.profileList.filter(
          (p: any) => (p as any)?.flag !== 'missing',
        ).length
      : 0

    this.crateSubscription = this.appStateService.onDidChangeSelector((s) => s.roCrate)(
      async (crate) => {
        this.localCrate = crate
        this.ensureEntityBaselineInitialized(crate)
        const selectorContext = this.appStateService.schemaSelectorContext
        if (selectorContext?.widgetId === this.id) {
          this.updateDirtyStateForCurrentEntity(crate)
        }
        console.log('crate update')
        this.updateTitleLabel()
        const entityId = this.getActiveEntityId()
        if (!entityId) {
          return
        }
        await this.updateProfileWithEntitySchemas(this.baseProfile!, entityId)
      },
    )

    this.completeProfileSubscription = this.appStateService.onDidChangeSelector(
      (s) => s.completeProfile,
    )((profile) => {
      this.localCompleteProfile = profile
      this.updateTitleLabel()
    })

    this.profileListSubscription = this.appStateService.onDidChangeSelector(
      (s) => s.profileList,
    )(async (profileList) => {
      const nextList = Array.isArray(profileList) ? profileList : []
      const nextNonMissingCount = nextList.filter(
        (p: any) => (p as any)?.flag !== 'missing',
      ).length
      const isAddingProfile = nextNonMissingCount > this.lastSeenNonMissingProfileCount
      this.lastSeenNonMissingProfileCount = nextNonMissingCount

      if (isAddingProfile) {
        this.messageService.info('Adding profile…', { timeout: 10000 })
      }

      if (this.isRefreshingProfile) {
        this.pendingSchemasRefresh = true
        return
      }
      if (!this.baseProfile || !this.localCrate) {
        return
      }
      const entityId = this.getActiveEntityId()
      if (!entityId) {
        return
      }

      try {
        await this.updateProfileWithEntitySchemas(this.baseProfile, entityId)
        if (isAddingProfile) {
          this.messageService.info('Profile added.', { timeout: 5000 })
        }
      } catch (error) {
        if (isAddingProfile) {
          this.messageService.error('Failed to add profile.', { timeout: 7000 })
        }
        throw error
      }
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
        this.captureEntityBaseline(
          trimmed,
          this.localCrate ?? this.appStateService.roCrate,
        )
        console.log('RoCrateEditorWidget: entityId updated from app-state', {
          widget: this.id,
          prev,
          next: trimmed,
        })
        this.updateTitleLabel()
        if (this.baseProfile && this.localCrate) {
          void this.updateProfileWithEntitySchemas(this.baseProfile, trimmed)
        } else {
          this.update()
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
      const entityId = this.getActiveEntityId()
      if (!entityId) {
        return
      }
      await this.updateProfileWithEntitySchemas(this.baseProfile, entityId)
    })

    const initialEntity = this.resolveInitialEntityId(options.entityId)
    this.assignEntity(initialEntity)

    if (this.baseProfile && this.localCrate && Array.isArray(this.localCrate['@graph'])) {
      const entityId = this.getActiveEntityId()
      if (entityId) {
        await this.updateProfileWithEntitySchemas(this.baseProfile, entityId)
      }
    }

    await this.validateCurrentCrate()
  }

  protected handleSaveCrate = async (saveData: any) => {
    const crate = saveData && (saveData as any).crate ? (saveData as any).crate : saveData
    const currentCrate = this.appStateService.roCrate
    const hasCrateChanged = !this.areCratesEquivalent(currentCrate, crate)

    if (hasCrateChanged) {
      this.appStateService.roCrate = crate
      this.localCrate = crate
    } else {
      this.localCrate = crate
    }

    this.updateDirtyStateForCurrentEntity(crate)

    await this.validateCurrentCrate()

    if (hasCrateChanged) {
      const isDirty = this.appStateService.isRoCrateDirty(crate)
      this.appStateService.dirty = isDirty
      this.onContentChangedEmitter.fire()
    }
  }

  protected areCratesEquivalent(
    a: Record<string, any> | undefined,
    b: Record<string, any> | undefined,
  ): boolean {
    if (a === b) {
      return true
    }
    if (!a || !b) {
      return false
    }
    try {
      return (
        JSON.stringify(this.toStableComparableValue(a)) ===
        JSON.stringify(this.toStableComparableValue(b))
      )
    } catch {
      return false
    }
  }

  protected toStableComparableValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.toStableComparableValue(entry))
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>
      const sortedKeys = Object.keys(obj).sort((left, right) => left.localeCompare(right))
      const normalized: Record<string, unknown> = {}
      for (const key of sortedKeys) {
        normalized[key] = this.toStableComparableValue(obj[key])
      }
      return normalized
    }
    return value
  }

  protected getActiveEntityId(): string | undefined {
    return this.assignedEntityId ?? this.localSelectedEntityId
  }

  protected resolveInitialEntityId(optionEntityId?: string): string {
    const fromState =
      typeof this.localSelectedEntityId === 'string'
        ? this.localSelectedEntityId.trim()
        : ''
    if (fromState) {
      return fromState
    }

    const fromOption = typeof optionEntityId === 'string' ? optionEntityId.trim() : ''
    if (fromOption) {
      return fromOption
    }

    return './'
  }

  protected handleNavigation = (entity: NavigationEntity): void => {
    const raw = entity?.['@id']
    const nextId = typeof raw === 'string' ? raw : ''
    if (!nextId) {
      console.warn('handleNavigation: missing entity id', { entity })
      return
    }
    if (nextId === this.assignedEntityId) {
      return
    }
    const widgetId = this.id
    if (!widgetId) {
      return
    }
    this.appStateService.registerEntityEditor(widgetId, nextId)
    const prevId = this.assignedEntityId
    this.assignedEntityId = nextId
    this.localSelectedEntityId = nextId
    this.captureEntityBaseline(nextId, this.localCrate ?? this.appStateService.roCrate)
    this.updateTitleLabel()
    this.update()
    console.log('RoCrateEditorWidget: entityId set from navigation', {
      widget: widgetId,
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

    this.appStateService.updateState({ openSchemaSelectorWindow: false })

    queueMicrotask(() => {
      this.appStateService.updateState({
        openSchemaSelectorWindow: true,
        schemaSelectorContext: { widgetId: this.id, entityId },
      })
    })
  }

  protected handleRemoveProfile = async (payload: any) => {
    console.log('handleRemoveProfile', payload)
    const entityId = payload?.entityId ?? this.localSelectedEntityId
    const profileUrl = payload?.tab?.profileUrl

    if (!entityId || !profileUrl) {
      return
    }

    this.messageService.info('Removing profile…', { timeout: 10000 })

    try {
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
      await this.removeSchemaMetadata(
        updatedCrate,
        entityId,
        schemaName,
        profile,
        targetUrl,
      )
      await this.handleSaveCrate(updatedCrate)
      this.update()
      await this.updateProfileWithEntitySchemas(this.baseProfile!, entityId)

      this.messageService.info('Profile removed.', { timeout: 5000 })
    } catch (error) {
      this.messageService.error('Failed to remove profile.', { timeout: 7000 })
      throw error
    }
  }

  render(): React.ReactNode {
    return (
      <div style={{ padding: '1rem' }}>
        <DescriboCrateBuilderWrapper
          key={this.getActiveEntityId() ?? 'unresolved-entity'}
          crate={this.localCrate}
          profile={this.localProfile}
          entityId={this.getActiveEntityId()}
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
    try {
      await this.validateCurrentCrate()
      await this.persistRoCrateToDisk()
    } catch (error) {
      const reasonLabel =
        options?.saveReason !== undefined ? SaveReason[options.saveReason] : 'manual'
      console.error(`Failed to save RO-Crate editor (${reasonLabel}):`, error)
    }
  }

  protected assignEntity(entityId: string): void {
    if (!this.id) {
      return
    }
    const prev = this.assignedEntityId
    this.assignedEntityId = entityId
    this.localSelectedEntityId = entityId
    this.captureEntityBaseline(entityId, this.localCrate ?? this.appStateService.roCrate)
    this.appStateService.registerEntityEditor(this.id, entityId)
    console.log('Assigned entity to widget', { widget: this.id, prev, next: entityId })
    this.updateTitleLabel()
  }

  protected ensureEntityBaselineInitialized(
    crate: Record<string, any> | undefined,
  ): void {
    const entityId = this.assignedEntityId ?? this.localSelectedEntityId
    if (!entityId) {
      return
    }
    if (this.baselineEntityId === entityId && this.baselineEntitySnapshot !== undefined) {
      return
    }
    this.captureEntityBaseline(entityId, crate)
  }

  protected captureEntityBaseline(
    entityId: string,
    crate: Record<string, any> | undefined,
  ): void {
    this.baselineEntityId = entityId
    this.baselineEntitySnapshot = this.serializeEntitySnapshot(entityId, crate)
    this.setDirtyState(false)
  }

  protected updateDirtyStateForCurrentEntity(
    crate: Record<string, any> | undefined,
  ): void {
    const entityId = this.assignedEntityId ?? this.localSelectedEntityId
    if (!entityId) {
      this.setDirtyState(false)
      return
    }
    if (this.baselineEntityId !== entityId) {
      this.captureEntityBaseline(entityId, crate)
      return
    }
    const currentSnapshot = this.serializeEntitySnapshot(entityId, crate)
    const isDirtyForEntity = currentSnapshot !== this.baselineEntitySnapshot
    this.setDirtyState(isDirtyForEntity)
  }

  protected serializeEntitySnapshot(
    entityId: string,
    crate: Record<string, any> | undefined,
  ): string | undefined {
    if (!crate || !Array.isArray(crate['@graph'])) {
      return undefined
    }
    const entity = (crate['@graph'] as Record<string, unknown>[]).find(
      (entry) => entry && String(entry['@id']) === entityId,
    )
    if (!entity) {
      return undefined
    }
    try {
      return JSON.stringify(this.toStableEntityComparableValue(entity))
    } catch {
      return undefined
    }
  }

  protected toStableEntityComparableValue(value: unknown, parentKey?: string): unknown {
    if (parentKey === 'conformsTo') {
      const refs = this.normalizeReferenceArray(value)
      if (refs.length === 0) {
        return undefined
      }
      return refs.sort((a, b) => a['@id'].localeCompare(b['@id']))
    }

    if (Array.isArray(value)) {
      const normalized = value
        .map((entry) => this.toStableEntityComparableValue(entry, parentKey))
        .filter((entry) => entry !== undefined)

      if (
        parentKey === '@type' &&
        normalized.every((entry) => typeof entry === 'string')
      ) {
        return [...(normalized as string[])].sort((a, b) => a.localeCompare(b))
      }

      return normalized
    }

    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>
      const sortedKeys = Object.keys(obj).sort((left, right) => left.localeCompare(right))
      const normalized: Record<string, unknown> = {}
      for (const key of sortedKeys) {
        const normalizedValue = this.toStableEntityComparableValue(obj[key], key)
        if (normalizedValue !== undefined) {
          normalized[key] = normalizedValue
        }
      }
      return normalized
    }

    return value
  }

  protected normalizeReferenceArray(value: unknown): Array<{ '@id': string }> {
    if (!value) {
      return []
    }
    const raw = Array.isArray(value) ? value : [value]
    const refs: Array<{ '@id': string }> = []
    const seen = new Set<string>()
    for (const entry of raw) {
      let id: string | undefined
      if (typeof entry === 'string') {
        const trimmed = entry.trim()
        id = trimmed || undefined
      } else if (entry && typeof entry === 'object') {
        const rawId = (entry as any)['@id'] ?? (entry as any).id
        if (typeof rawId === 'string') {
          const trimmed = rawId.trim()
          id = trimmed || undefined
        }
      }
      if (!id || seen.has(id)) {
        continue
      }
      seen.add(id)
      refs.push({ '@id': id })
    }
    return refs
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
    const result = entityId ? this.extractConformsToIds(entityId) : []
    return result
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
    const result = Array.from(new Set(ids))
    return result
  }

  protected isSameStringSet(a: string[], b: string[]): boolean {
    let result = true
    if (a.length !== b.length) {
      result = false
    } else {
      const setA = new Set(a)
      if (setA.size !== b.length) {
        result = false
      } else {
        for (const value of b) {
          if (!setA.has(value)) {
            result = false
            break
          }
        }
      }
    }
    return result
  }

  protected async updateProfileWithEntitySchemas(
    baseProfile: Record<string, any>,
    entityId: string,
  ) {
    const crateAtStart = this.localCrate
    const profileRevisionAtStart = this.profileRevision

    if (this.isRefreshingProfile) {
      this.pendingSchemasRefresh = true
      this.pendingSchemasRefreshBaseProfile = baseProfile
      this.pendingSchemasRefreshEntityId = entityId
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

      const profileList = this.appStateService.profileList
      const conformsTos = this.computeConformsToIdsForSelectedEntity(entityId)

      if (
        this.lastAppliedEntityId === entityId &&
        this.isSameStringSet(this.lastAppliedConformsTo, conformsTos) &&
        this.lastAppliedCrate === this.localCrate &&
        this.lastAppliedProfileList === profileList
      ) {
        return
      }

      if (!conformsTos || conformsTos.length === 0) {
        const nextProfile = JSON.parse(JSON.stringify(baseProfile))
        const didProfileChange = this.localProfile !== nextProfile

        this.localProfile = nextProfile
        if (didProfileChange) {
          this.profileRevision += 1
        }

        this.lastAppliedEntityId = entityId
        this.lastAppliedConformsTo = []
        this.lastAppliedCrate = this.localCrate
        this.lastAppliedProfileList = profileList
        this.update()
        return
      }

      let updateProfile = JSON.parse(JSON.stringify(baseProfile))
      let didUpdateProfile = false
      let foundMatchingProfile = false

      for (const conformsToUrl of conformsTos) {
        const convertedContent = profileList?.find(
          (p: any) => (p?.id ?? '').trim() === conformsToUrl.trim(),
        )?.content

        if (convertedContent) {
          foundMatchingProfile = true
          if (this.localCrate) {
            const merged = await this.schemaManagerService.getMergedProfile(
              this.localCrate,
              convertedContent,
              updateProfile,
              conformsToUrl,
            )
            updateProfile = merged
            didUpdateProfile = true
            this.updateEntityConformsTo(entityId, conformsToUrl)
          }
        } else {
          const id = typeof conformsToUrl === 'string' ? conformsToUrl.trim() : ''
          if (id) {
            const hasEntry = Array.isArray(profileList)
              ? profileList.some((p: any) => (p?.id ?? '').trim() === id)
              : false

            if (!hasEntry) {
              const prev = Array.isArray(this.appStateService.profileList)
                ? this.appStateService.profileList
                : []
              this.appStateService.profileList = [
                ...prev,
                { id, content: undefined, flag: 'missing' } as any,
              ]
            }
          }
          console.warn(`No profile found in state for conformsTo URL: ${conformsToUrl}`)
        }
      }

      if (didUpdateProfile || !foundMatchingProfile) {
        this.localProfile = updateProfile
        this.profileRevision += 1
      }

      this.lastAppliedEntityId = entityId
      this.lastAppliedConformsTo = conformsTos.slice()
      this.lastAppliedCrate = this.localCrate
      this.lastAppliedProfileList = profileList
      this.update()
    } finally {
      const shouldValidate =
        crateAtStart !== this.localCrate || profileRevisionAtStart !== this.profileRevision

      if (shouldValidate) {
        await this.validateCurrentCrate()
      }

      this.isRefreshingProfile = false

      if (this.pendingSchemasRefresh) {
        this.pendingSchemasRefresh = false
        const baseProfile = this.pendingSchemasRefreshBaseProfile ?? this.baseProfile
        const crate = this.localCrate
        const entityId =
          this.pendingSchemasRefreshEntityId ??
          this.assignedEntityId ??
          this.localSelectedEntityId ??
          './'

        this.pendingSchemasRefreshBaseProfile = undefined
        this.pendingSchemasRefreshEntityId = undefined

        if (baseProfile && crate) {
          queueMicrotask(() => {
            void this.updateProfileWithEntitySchemas(baseProfile, entityId)
          })
        }
      }
    }
  }

  protected findEntity(crate: Record<string, any>, id: string) {
    const result = (crate['@graph'] as Record<string, any>[]).find(
      (entity) => entity['@id'] === id,
    )
    return result
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
          : (v as any)['@id'] === trimmedConformsToUrl ||
            (v as any).id === trimmedConformsToUrl,
      )
    ) {
      return
    }

    conformsToField.push({ '@id': trimmedConformsToUrl })
    entity.conformsTo = conformsToField

    void this.handleSaveCrate(crate)
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

    const entityType = Array.isArray(entity['@type'])
      ? entity['@type'][0]
      : entity['@type']
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
      const profileList = this.appStateService.profileList
      const trimmedProfileUrl = typeof profileUrl === 'string' ? profileUrl.trim() : ''

      let convertedContent: any | undefined =
        trimmedProfileUrl && profileList
          ? profileList.find((p: any) => (p?.id ?? '').trim() === trimmedProfileUrl)
              ?.content
          : undefined

      if (!convertedContent && trimmedProfileUrl && profileList) {
        const match = profileList.find((p: any) => {
          const value: any = p?.content as any
          const conformsTo = value?.conformsTo
          const auxRef = value?.aux?.reference
          return (
            (typeof conformsTo === 'string' && conformsTo.trim() === trimmedProfileUrl) ||
            (typeof auxRef === 'string' && auxRef.trim() === trimmedProfileUrl)
          )
        })
        convertedContent = match?.content as any
      }

      const schemaInputs =
        convertedContent?.classes?.[entityType]?.inputs ??
        convertedContent?.classes?.Dataset?.inputs ??
        convertedContent?.classes?.File?.inputs

      if (Array.isArray(schemaInputs)) {
        for (const input of schemaInputs) {
          if (input?.name) {
            inputNames.push(input.name)
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
      for (const key in entityToRemove) {
        if (entityToRemove[key]?.['@id']) {
          this.removeEntityFromGraph(crate, entityToRemove[key]['@id'], keepOrphans)
        }
      }

      const graph = crate['@graph'] as Record<string, any>[]

      if (!keepOrphans) {
        let referenceCount = 0

        for (const entity of graph) {
          for (const key in entity) {
            if (
              entity[key]?.['@id'] &&
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

    const crate = this.appStateService.roCrate
    const profile = this.localProfile
    const completeProfile = this.localCompleteProfile

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
      this.captureEntityBaseline(
        this.assignedEntityId ?? this.localSelectedEntityId ?? './',
        crateData,
      )
    } catch (error) {
      console.error('Failed to persist RO-Crate metadata:', error)
    }
  }

  dispose(): void {
    this.unregisterFromAppState()
    this.crateSubscription?.dispose()
    this.completeProfileSubscription?.dispose()
    this.profileListSubscription?.dispose()
    this.eirceiaSubscription?.dispose()
    this.schemasSubscription?.dispose()

    if (this.validationTimer) {
      clearTimeout(this.validationTimer)
      this.validationTimer = undefined
    }

    this.node.removeEventListener('focusin', this.handleFocusIn, true)
    this.onDirtyChangedEmitter.dispose()
    this.onContentChangedEmitter.dispose()
    super.dispose()
  }
}

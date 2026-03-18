import { StorageService } from '@theia/core/lib/browser/storage-service'
import type { Event } from '@theia/core/lib/common'
import { inject, injectable, postConstruct } from 'inversify'
import { type AppState, defaultAppState } from './app-state'
import { SimpleStateStore, type StateChange } from './state-store'

const STORAGE_KEY = 'theia-app-state-extension:app-state'

// Create a fresh copy so callers don't share mutable references (e.g., arrays)
export function cloneDefaultAppState(): AppState {
  return {
    ...defaultAppState,
    // copy array to avoid mutation sharing
    notifications: [...defaultAppState.notifications],
  }
}

@injectable()
export class AppStateService {
  // Default state values
  private readonly store = new SimpleStateStore<AppState>(cloneDefaultAppState())
  private roCrateSnapshot?: string

  private readonly persistIntervalMs = 5000
  private lastPersistAt = 0
  private persistTimeout: number | undefined
  private latestPersistableForPersist: Partial<AppState> | undefined
  private lastPersistableSignature: string | undefined

  @inject(StorageService)
  protected readonly storageService!: StorageService

  private readonly _ready: Promise<void>
  private _resolveReady!: () => void
  private initialProfileTemplate?: Record<string, any>

  constructor() {
    this._ready = new Promise<void>((resolve) => {
      this._resolveReady = resolve
    })
  }

  @postConstruct()
  protected init(): void {
    // restore persisted state if available (fire-and-forget to keep binding synchronous)
    this.storageService
      .getData<Partial<AppState>>(STORAGE_KEY)
      .then((stored) => {
        if (stored) {
          const {
            roCrate,
            profile,
            selectedEntityId,
            schemaSelectorContext,
            profileList,
            completeProfile,
            validationErrors,
            ...restStored
          } = stored as AppState
          this.store.setState({
            ...cloneDefaultAppState(),
            ...(restStored as any), // Only restore other properties
          })
        }
        this._resolveReady()
      })
      .catch((e) => {
        console.error('Failed to restore app state', e)
        this._resolveReady() // Resolve even on error to prevent hangs
      })

    // persist on every change
    this.onDidChangeState(({ current }) => {
      const persistable = this.toPersistableState(current)
      const signature = this.toPersistableSignature(persistable)
      if (signature === this.lastPersistableSignature) {
        return
      }

      this.lastPersistableSignature = signature
      this.latestPersistableForPersist = persistable

      const now = Date.now()
      const elapsed = now - this.lastPersistAt

      if (this.persistTimeout === undefined && elapsed >= this.persistIntervalMs) {
        this.flushPersist()
        return
      }

      if (this.persistTimeout !== undefined) {
        return
      }

      const delay = Math.max(this.persistIntervalMs - elapsed, 0)
      this.persistTimeout = window.setTimeout(() => {
        this.persistTimeout = undefined
        this.flushPersist()
      }, delay)
    })
  }

  private flushPersist(): void {
    const persistable = this.latestPersistableForPersist
    if (!persistable) {
      return
    }

    this.lastPersistAt = Date.now()
    void this.storageService.setData(STORAGE_KEY, persistable).catch((error) => {
      console.warn('Failed to persist app state to browser storage:', error)
    })
  }

  private toPersistableSignature(state: Partial<AppState>): string {
    try {
      return JSON.stringify(state)
    } catch {
      return `${Date.now()}`
    }
  }

  /**
   * Keeps persisted browser storage small to avoid quota errors on large RO-Crates.
   * Runtime-heavy data is intentionally excluded and reloaded from files/services.
   */
  private toPersistableState(state: AppState): Partial<AppState> {
    const {
      roCrate,
      profile,
      completeProfile,
      profileList,
      selectedEntityId,
      schemaSelectorContext,
      validationErrors,
      ...persistable
    } = state
    return persistable
  }

  get ready(): Promise<void> {
    return this._ready
  }

  // --- core API ---

  getState(): Readonly<AppState> {
    return this.store.getState()
  }

  updateState(partial: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) {
    this.store.updateState(partial)
  }

  readonly onDidChangeState: Event<StateChange<AppState>> = this.store.onDidChangeState

  onDidChangeSelector<R>(
    selector: (state: AppState) => R,
    equals?: (a: R, b: R) => boolean,
  ): Event<R> {
    return this.store.onDidChangeSelector(selector, equals)
  }

  reset(): void {
    console.log('AppStateService: Resetting state to defaults')
    this.store.setState(cloneDefaultAppState())
  }

  protected deepClone<T>(obj: T | undefined): T | undefined {
    try {
      return obj === undefined ? undefined : JSON.parse(JSON.stringify(obj))
    } catch {
      return undefined
    }
  }

  setInitialProfileTemplate(value: Record<string, any> | undefined): void {
    this.initialProfileTemplate = this.deepClone(value) as Record<string, any> | undefined
  }

  getInitialProfileTemplate(): Record<string, any> | undefined {
    return this.deepClone(this.initialProfileTemplate) as Record<string, any> | undefined
  }

  resetProfileToInitial(): void {
    const next = this.deepClone(this.initialProfileTemplate)
    if (next !== undefined) {
      this.updateState({ profile: next })
    }
  }

  get roCrate(): AppState['roCrate'] {
    return this.getState().roCrate
  }
  set roCrate(value: AppState['roCrate']) {
    this.updateState({ roCrate: value })
  }

  setRoCrateSnapshot(value: AppState['roCrate']): void {
    if (!value) {
      this.roCrateSnapshot = undefined
      return
    }
    try {
      this.roCrateSnapshot = JSON.stringify(value)
    } catch (error) {
      console.warn('Failed to snapshot RO-Crate:', error)
      this.roCrateSnapshot = undefined
    }
  }

  isRoCrateDirty(value: AppState['roCrate']): boolean {
    if (!value) {
      return false
    }
    try {
      const current = JSON.stringify(value)
      return this.roCrateSnapshot !== current
    } catch (error) {
      console.warn('Failed to compare RO-Crate snapshot:', error)
      return true
    }
  }

  get profile(): AppState['profile'] {
    return this.getState().profile
  }
  set profile(value: AppState['profile']) {
    this.updateState({ profile: value })
  }

  get selectedEntityId(): AppState['selectedEntityId'] {
    return this.getState().selectedEntityId
  }
  set selectedEntityId(value: AppState['selectedEntityId']) {
    this.resetProfileToInitial()
    this.updateState({ selectedEntityId: value })
  }

  get EIRCEIA(): AppState['EIRCEIA'] {
    return this.getState().EIRCEIA
  }
  set EIRCEIA(value: AppState['EIRCEIA']) {
    this.updateState({ EIRCEIA: value })
  }

  registerEntityEditor(widgetId: string, entityId: string): void {
    const mapping = { ...(this.getState().EIRCEIA ?? {}) }

    mapping[widgetId] = entityId

    this.updateState({ EIRCEIA: mapping })
  }

  unregisterEntityEditor(widgetId: string): void {
    const mapping = { ...(this.getState().EIRCEIA ?? {}) }
    if (widgetId in mapping) {
      delete mapping[widgetId]
      this.updateState({
        EIRCEIA: Object.keys(mapping).length ? mapping : undefined,
      })
    }
  }

  getEntityEditorWidgetId(entityId: string): string | undefined {
    const mapping = this.getState().EIRCEIA ?? {}
    return Object.entries(mapping).find(([, id]) => id === entityId)?.[0]
  }

  getEntityForWidget(widgetId: string): string | undefined {
    return this.getState().EIRCEIA?.[widgetId]
  }

  get isROCrateInvalid(): AppState['isROCrateInvalid'] {
    return this.getState().isROCrateInvalid
  }
  set isROCrateInvalid(value: AppState['isROCrateInvalid']) {
    this.updateState({ isROCrateInvalid: value })
  }

  get dirty(): AppState['dirty'] {
    return this.getState().dirty
  }
  set dirty(value: AppState['dirty']) {
    this.updateState({ dirty: value })
  }

  get theme(): AppState['theme'] {
    return this.getState().theme
  }
  set theme(value: AppState['theme']) {
    this.updateState({ theme: value })
  }

  get notifications(): AppState['notifications'] {
    return this.getState().notifications
  }

  set notifications(value: AppState['notifications']) {
    this.updateState({ notifications: value })
  }

  addNotification(message: string): void {
    this.updateState((prev) => ({
      notifications: [...prev.notifications, message],
    }))
  }

  readonly onDidChangeNotificationCount: Event<number> = this.onDidChangeSelector(
    (s) => s.notifications.length,
  )

  get settings(): AppState['settings'] {
    return this.getState().settings
  }
  set settings(value: AppState['settings']) {
    this.updateState({ settings: value })
  }

  get openSchemaSelectorWindow(): AppState['openSchemaSelectorWindow'] {
    return this.getState().openSchemaSelectorWindow
  }
  set openSchemaSelectorWindow(value: AppState['openSchemaSelectorWindow']) {
    this.updateState({ openSchemaSelectorWindow: value })
  }

  get schemaSelectorContext(): AppState['schemaSelectorContext'] {
    return this.getState().schemaSelectorContext
  }
  set schemaSelectorContext(value: AppState['schemaSelectorContext']) {
    this.updateState({ schemaSelectorContext: value })
  }

  get completeProfile(): AppState['completeProfile'] {
    return this.getState().completeProfile
  }
  set completeProfile(value: AppState['completeProfile']) {
    this.updateState({ completeProfile: value })
  }

  get profileList(): AppState['profileList'] {
    return this.getState().profileList
  }
  set profileList(value: AppState['profileList']) {
    this.updateState({ profileList: value })
  }
  getProfileByConformsTo(id: string): Record<string, any> | undefined {
    const key = typeof id === 'string' ? id.trim() : ''
    if (!key) return undefined
    return this.getState().profileList?.find((p) => (p?.id ?? '').trim() === key)?.content
  }

  get validationErrors(): AppState['validationErrors'] {
    return this.getState().validationErrors
  }
  set validationErrors(value: AppState['validationErrors']) {
    this.updateState({ validationErrors: value })
  }
}

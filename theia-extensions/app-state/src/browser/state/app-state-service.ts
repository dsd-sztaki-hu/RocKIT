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

  @inject(StorageService)
  protected readonly storageService: StorageService

  @postConstruct()
  protected init(): void {
    // restore persisted state if available (fire-and-forget to keep binding synchronous)
    this.storageService
      .getData<AppState>(STORAGE_KEY)
      .then((stored) => {
        if (stored) {
          this.store.setState({
            ...cloneDefaultAppState(),
            ...(stored as any), // avoid duplicate field TS error
          })
        }
      })
      .catch((e) => console.error('Failed to restore app state', e))

    // persist on every change
    this.onDidChangeState(({ current }) => {
      this.storageService.setData(STORAGE_KEY, current)
    })
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
    this.store.setState(cloneDefaultAppState())
  }

  get roCrate(): AppState['roCrate'] {
    console.log('Getting roCrate:', this.getState().roCrate)
    return this.getState().roCrate
  }
  set roCrate(value: AppState['roCrate']) {
    this.updateState({ roCrate: value })
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
}

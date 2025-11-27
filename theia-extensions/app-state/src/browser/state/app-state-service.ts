import { injectable, inject, postConstruct } from 'inversify';
import { Event } from '@theia/core/lib/common';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { AppState, cloneDefaultAppState } from './app-state';
import { SimpleStateStore, StateChange } from './state-store';

const STORAGE_KEY = 'theia-app-state-extension:app-state';

@injectable()
export class AppStateService {

    // Default state values
    private readonly store = new SimpleStateStore<AppState>(cloneDefaultAppState());

    @inject(StorageService)
    protected readonly storageService: StorageService;

    @postConstruct()
    protected init(): void {
        // restore persisted state if available (fire-and-forget to keep binding synchronous)
        this.storageService.getData<AppState>(STORAGE_KEY)
            .then(stored => {
                if (stored) {
                this.store.setState({
                    ...cloneDefaultAppState(),
                    ...(stored as any) // avoid duplicate field TS error
                });
            }
        })
        .catch(e => console.error('Failed to restore app state', e));

        // persist on every change
        this.onDidChangeState(({ current }) => {
            this.storageService.setData(STORAGE_KEY, current);
        });
    }

    // --- core API ---

    getState(): Readonly<AppState> {
        return this.store.getState();
    }

    updateState(partial: Partial<AppState> | ((prev: AppState) => Partial<AppState>)) {
        this.store.updateState(partial);
    }

    readonly onDidChangeState: Event<StateChange<AppState>> = this.store.onDidChangeState;

    onDidChangeSelector<R>(
        selector: (state: AppState) => R,
        equals?: (a: R, b: R) => boolean
    ): Event<R> {
        return this.store.onDidChangeSelector(selector, equals);
    }

    // --- convenience getters/setters/actions ---

    get roCrate(): string | undefined {
        return this.getState().roCrate;
    }
    set roCrate(json: string | undefined) {
        this.updateState({ roCrate: json });
    }

    get dirty(): boolean {
        return this.getState().dirty;
    }
    set dirty(value: boolean) {
        this.updateState({ dirty: value });
    }

    get theme(): 'light' | 'dark' {
        return this.getState().theme;
    }
    set theme(value: 'light' | 'dark') {
        this.updateState({ theme: value });
    }

    addNotification(message: string): void {
        this.updateState(prev => ({
            notifications: [...prev.notifications, message]
        }));
    }

    reset(): void {
        this.store.setState(cloneDefaultAppState());
    }

    readonly onDidChangeNotificationCount: Event<number> =
        this.onDidChangeSelector(s => s.notifications.length);
}

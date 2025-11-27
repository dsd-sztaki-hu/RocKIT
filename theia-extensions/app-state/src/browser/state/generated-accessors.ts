// AUTO-GENERATED FILE. Do not edit manually.
// Run \"yarn generate:accessors\" to regenerate after changing defaultAppState.

import { AppState } from './app-state';

export type AccessorHost = {
    getState(): Readonly<AppState>;
    updateState(patch: Partial<AppState>): void;
};

export function applyAppStateAccessors(target: AccessorHost): void {
    Object.defineProperties(target as any, {
        "roCrate": {
            get(): AppState['roCrate'] { return target.getState().roCrate; },
            set(value: AppState['roCrate']) { target.updateState({ roCrate: value }); },
            enumerable: true
        },
        "dirty": {
            get(): AppState['dirty'] { return target.getState().dirty; },
            set(value: AppState['dirty']) { target.updateState({ dirty: value }); },
            enumerable: true
        },
        "theme": {
            get(): AppState['theme'] { return target.getState().theme; },
            set(value: AppState['theme']) { target.updateState({ theme: value }); },
            enumerable: true
        },
        "notifications": {
            get(): AppState['notifications'] { return target.getState().notifications; },
            set(value: AppState['notifications']) { target.updateState({ notifications: value }); },
            enumerable: true
        }
    });
}

declare module './app-state-service' {
    interface AppStateService {
        roCrate: AppState['roCrate'];
        dirty: AppState['dirty'];
        theme: AppState['theme'];
        notifications: AppState['notifications'];
    }
}

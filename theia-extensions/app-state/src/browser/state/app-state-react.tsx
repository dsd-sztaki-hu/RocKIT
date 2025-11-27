import { useEffect, useState, createContext, useContext, ReactNode } from 'react';
import { AppState } from './app-state';
import { AppStateService } from './app-state-service';
import { Disposable } from '@theia/core';
//This is to avoid for AppStateContext.Provider:  TS2686: 'React' refers to a UMD global, but the current file is a module. Consider adding an import instead.
import * as React from 'react';

export const AppStateContext = createContext<AppStateService | undefined>(undefined);

export interface AppStateProviderProps {
    service: AppStateService;
    children: ReactNode;
}

export function AppStateProvider({ service, children }: AppStateProviderProps) {
    return (
        <AppStateContext.Provider value={service}>
            {children}
        </AppStateContext.Provider>
    );
}

export function useAppStateService(): AppStateService {
    const ctx = useContext(AppStateContext);
    if (!ctx) {
        throw new Error('useAppStateService must be used within an AppStateProvider');
    }
    return ctx;
}

/**
 * React hook to subscribe to a slice of AppState.
 * Similar to Zustand/TanStack store selectors.
 */
export function useAppState<R>(
    selector: (state: AppState) => R,
    equals: (a: R, b: R) => boolean = Object.is
): R {
    const service = useAppStateService();
    const [value, setValue] = useState(() => selector(service.getState()));

    useEffect(() => {
        let sub: Disposable | undefined;

        const event = service.onDidChangeSelector(selector, equals);
        sub = event(next => {
            setValue(prev => (equals(prev, next) ? prev : next));
        });

        return () => sub?.dispose();
    }, [service, selector, equals]);

    return value;
}

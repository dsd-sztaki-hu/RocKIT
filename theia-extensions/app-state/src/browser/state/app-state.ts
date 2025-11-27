
// Define the default application state. This defines the shape of the state and initial values.
export const defaultAppState = {
    roCrate: undefined as string | undefined,
    dirty: false,
    theme: 'light' as 'light' | 'dark',
    notifications: [] as string[]
};

export type AppState = typeof defaultAppState;

// Create a fresh copy so callers don't share mutable references (e.g., arrays)
export function cloneDefaultAppState(): AppState {
    return {
        ...defaultAppState,
        // copy array to avoid mutation sharing
        notifications: [...defaultAppState.notifications]
    };
}

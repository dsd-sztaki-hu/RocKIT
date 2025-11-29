// Define the default application state. This defines the shape of the state and initial values.
export const defaultAppState = {
  roCrate: undefined as string | undefined,
  dirty: false,
  theme: 'light' as 'light' | 'dark',
  notifications: [] as string[],
  settings: {
    autoSave: true,
    fontSize: 14,
  },
}

export type AppState = typeof defaultAppState

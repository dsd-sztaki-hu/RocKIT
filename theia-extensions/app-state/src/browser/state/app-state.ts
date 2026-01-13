//  EIRCEIA - editor id to RO-Crate entity id associations
export type EIRCEIA = Record<string, string>

// Define the default application state. This defines the shape of the state and initial values.
export const defaultAppState = {
  roCrate: undefined as Record<string, any> | undefined,
  profile: undefined as Record<string, any> | undefined,
  selectedEntityId: undefined as string | undefined,
  EIRCEIA: undefined as EIRCEIA | undefined,
  isROCrateInvalid: false,
  dirty: false,
  theme: 'light' as 'light' | 'dark',
  notifications: [] as string[],
  settings: {
    autoSave: true,
    fontSize: 14,
  },
}

export type AppState = typeof defaultAppState

export interface AppState {
    roCrate?: string;
    dirty: boolean;
    theme: 'light' | 'dark';
    notifications: string[];
}

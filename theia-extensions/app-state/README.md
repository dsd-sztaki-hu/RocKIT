# Global AppState Extension

This extension provides a global state management system for sharing data across different parts of the application.

## Usage

### Viewing the Current State

You can view the current global state at any time using the AppState Panel:

```
View  >>> Show AppState Panel
```

Example extension using the AppState service:

```
View  >>> Open AppState Sample Widget
```


### Adding New State Values

To add new state values, you need to modify the `defaultAppState` variable in `src/browser/state/app-state.ts`. THis defines the sahpe of the state object as well as defines default values.

```typescript
export const defaultAppState = {
    roCrate: undefined as string | undefined,
    dirty: false,
    theme: 'light' as 'light' | 'dark',
    notifications: [] as string[],
    // Add settings object here
    settings: {
        autoSave: true,
        fontSize: 14
    }
}
```

If you have `yarn watch:electron` or `yarn watch:browser` running accessors for the new state properties will be automatically generated in the `AppStateService` class. Otherwise , you can add them manually `src/browser/state/app-state-service.ts` like this:

```typescript
    get settings(): AppState['settings'] {
    return this.getState().settings;
}
    set settings(value: AppState['settings']) {
        this.updateState({ settings: value });
    }
```

The generated acccessors can be further customized if needed.

### Using State in Other Extensions

To use the AppState service in other extensions:

1. Import the service:
```typescript
import { AppStateService } from 'theia-extensions/app-state/lib/browser/state/app-state-service';
```

2. Inject it into your component:
```typescript
@inject(AppStateService)
protected readonly appState: AppStateService;
```

3. Use the service:
```typescript
// Get current state
const currentState = this.appState.getState();

// Get specific property
const isDirty = this.appState.dirty;

// Update state
this.appState.dirty = true;
this.appState.updateState({ theme: 'dark' });

// Listen to state changes
this.appState.onDidChangeState(({ current }) => {
    console.log('State changed:', current);
});

// Listen to specific property changes
this.appState.onDidChangeSelector(
    state => state.theme,
    (prev, next) => {
        console.log('Theme changed from', prev, 'to', next);
    }
);
```

### Using State in React Widgets

For React components, use the provided hooks:

1. Wrap your component with the AppStateProvider:
```typescript
import { AppStateProvider } from 'theia-extensions/app-state/lib/browser/state/app-state-react';

// In your widget's render method
protected render(): React.ReactNode {
    return (
        <AppStateProvider service={this.appStateService}>
            <YourComponent />
        </AppStateProvider>
    );
}
```

2. Use the hooks in your component:
```typescript
import { useAppState, useAppStateService } from 'theia-extensions/app-state/lib/browser/state/app-state-react';

function YourComponent() {
    // Get the entire state
    const appState = useAppState(state => state);
    
    // Get specific properties
    const theme = useAppState(state => state.theme);
    const dirty = useAppState(state => state.dirty);
    
    // Get the service for actions
    const appStateService = useAppStateService();
    
    const toggleTheme = () => {
        appStateService.updateState(prev => ({
            theme: prev.theme === 'light' ? 'dark' : 'light'
        }));
    };
    
    return (
        <div>
            <p>Current theme: {theme}</p>
            <p>Dirty: {dirty ? 'Yes' : 'No'}</p>
            <button onClick={toggleTheme}>Toggle Theme</button>
        </div>
    );
}
```

## API Reference

### AppStateService

#### Methods

- `getState(): Readonly<AppState>` - Get the current state
- `updateState(partial: Partial<AppState> | ((prev: AppState) => Partial<AppState>))` - Update the state
- `onDidChangeState: Event<StateChange<AppState>>` - Event fired when any part of state changes
- `onDidChangeSelector<R>(selector: (state: AppState) => R, equals?: (a: R, b: R) => boolean): Event<R>` - Event fired when selected part of state changes

#### Convenience Properties

The service provides getters and setters for each property in the AppState interface:
- `roCrate` - Get/set the RO-Crate JSON string
- `dirty` - Get/set the dirty flag
- `theme` - Get/set the current theme
- `addNotification(message: string)` - Add a new notification

### React Hooks

- `useAppState<R>(selector: (state: AppState) => R, equals?: (a: R, b: R) => boolean): R` - Subscribe to state changes
- `useAppStateService(): AppStateService` - Get the AppStateService instance

## Architecture

The extension consists of:

- `AppState` interface - TypeScript definition of the state structure
- `SimpleStateStore` - Generic state management with event notifications
- `AppStateService` - Service that manages the app state with persistence
- `AppStatePanelWidget` - React widget that displays the current state
- `AppStatePanelContribution` - Contribution that registers the panel
- React hooks for easy integration with React components

## Development

To build the extension:
```bash
yarn build
```

To watch for changes during development:
```bash
yarn watch
```

To run tests:
```bash
yarn test
# App State

Provides a shared RocKIT application state service and UI integration for Theia
extensions.

## Usage

### Viewing The Current State

You can view the current global state at any time using the AppState panel:

```text
View >>> Show AppState Panel
```

Example consumer: see `theia-extensions/app-state-sample`, which imports the
service/hooks from `app-state/lib` and exposes "Open AppState Sample Widget"
under View.

### Adding New State Values

To add new state values, modify the `defaultAppState` variable in
`src/browser/state/app-state.ts`. This defines the shape of the state object and
its default values.

```ts
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
```

If you have `yarn watch:electron` or `yarn watch:browser` running, accessors for
the new state properties will be automatically generated in the
`AppStateService` class. Otherwise, you can add them manually in
`src/browser/state/app-state-service.ts` like this:

```ts
get settings(): AppState['settings'] {
  return this.getState().settings
}

set settings(value: AppState['settings']) {
  this.updateState({ settings: value })
}
```

The generated accessors can be further customized if needed.

### Using State In Other Extensions

Use `theia-extensions/app-state-sample` as the canonical reference. Minimal
steps:

```ts
// inject the shared service
import { inject } from '@theia/core/shared/inversify'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'

@inject(AppStateService)
protected readonly appState: AppStateService

// read / write primitives
const current = this.appState.getState()
this.appState.dirty = true

// update nested object immutably so change events fire
this.appState.settings = {
  ...this.appState.settings,
  fontSize: this.appState.settings.fontSize + 1,
}

// or reducer-style update
this.appState.updateState((prev) => ({
  settings: { ...prev.settings, autoSave: !prev.settings.autoSave },
}))

// listen
this.appState.onDidChangeState(({ current }) => console.log(current.settings))
this.appState.onDidChangeSelector((s) => s.settings.fontSize, (a, b) => a === b)
```

### Immutable Updates: Arrays And Objects

Change detection uses reference equality by default. To ensure events fire:

- Replace arrays: `appState.notifications = [...appState.notifications, 'New']`
- Replace objects: `appState.settings = { ...appState.settings, fontSize: appState.settings.fontSize + 1 }`
- Use reducer style: `appState.updateState(prev => ({ settings: { ...prev.settings, autoSave: !prev.settings.autoSave } }))`

Avoid mutating existing arrays/objects in place, as the reference will not
change and selector listeners may not fire.

### Using State In React Widgets

In another extension, see
`app-state-sample/src/browser/sample-react-widget.tsx`:

```tsx
import { AppStateProvider, useAppState, useAppStateService } from 'app-state/lib/browser/state/app-state-react'
import { AppState } from 'app-state/lib/browser/state/app-state'

function SampleView() {
  const svc = useAppStateService()
  const theme = useAppState((s: AppState) => s.theme)
  return (
    <div>
      <p>Theme: {theme}</p>
      <button onClick={() => svc.updateState((p) => ({ theme: p.theme === 'light' ? 'dark' : 'light' }))}>
        Toggle theme
      </button>
    </div>
  )
}

// In your widget render
<AppStateProvider service={this.appStateService}>
  <SampleView />
</AppStateProvider>
```

## API Reference

### AppStateService

- `getState(): Readonly<AppState>` - Get the current state.
- `updateState(partial: Partial<AppState> | ((prev: AppState) => Partial<AppState>))` - Update the state.
- `onDidChangeState: Event<StateChange<AppState>>` - Event fired when any part of state changes.
- `onDidChangeSelector<R>(selector: (state: AppState) => R, equals?: (a: R, b: R) => boolean): Event<R>` - Event fired when a selected part of state changes.

### React Hooks

- `useAppState<R>(selector: (state: AppState) => R, equals?: (a: R, b: R) => boolean): R` - Subscribe to state changes.
- `useAppStateService(): AppStateService` - Get the `AppStateService` instance.

## Authorship

This package is maintained by SZTAKI, Department of Distributed Systems
(<https://dsd.sztaki.hu>).

Contact: [rockit@dsd.sztaki.hu](mailto:rockit@dsd.sztaki.hu).

Individual contributors are listed in `package.json`.

## License

This package is licensed under the Apache License, Version 2.0. See
[LICENSE.md](../../LICENSE.md) for details.

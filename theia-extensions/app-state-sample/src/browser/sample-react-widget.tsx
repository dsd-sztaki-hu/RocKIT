import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { nls } from '@theia/core/lib/common/nls'
import type { AppState } from 'app-state/lib/browser/state/app-state'
import {
  AppStateProvider,
  useAppState,
  useAppStateService,
} from 'app-state/lib/browser/state/app-state-react'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { inject, injectable } from 'inversify'

function SampleView() {
  const service = useAppStateService()
  const dirty = useAppState((s: AppState) => s.dirty)
  const theme = useAppState((s: AppState) => s.theme)
  const notifCount = useAppState((s: AppState) => s.notifications.length)
  const settings = useAppState((s: AppState) => s.settings)
  const localizedTheme =
    theme === 'light'
      ? nls.localize('rockit/appState/sample/light', 'light')
      : theme === 'dark'
        ? nls.localize('rockit/appState/sample/dark', 'dark')
        : theme

  return (
    <div style={{ padding: '1rem' }}>
      <h2>
        {nls.localize(
          'rockit/appState/sample/heading',
          'Sample React Widget with Global AppState',
        )}
      </h2>
      <p>
        {nls.localize('rockit/appState/sample/dirty', 'Dirty')}: {dirty
          ? nls.localize('rockit/common/yes', 'yes')
          : nls.localize('rockit/common/no', 'no')}
      </p>
      <p>
        {nls.localize('rockit/appState/sample/theme', 'Theme')}: {localizedTheme}
      </p>
      <p>
        {nls.localize('rockit/appState/sample/notifications', 'Notifications')}:{' '}
        {notifCount}
      </p>
      <p>
        {nls.localize('rockit/appState/sample/settings', 'Settings')}: autoSave=
        {settings.autoSave
          ? nls.localize('rockit/common/on', 'on')
          : nls.localize('rockit/common/off', 'off')}, fontSize=
        {settings.fontSize}
      </p>

      <button type="button" onClick={() => (service.dirty = !dirty)}>
        {nls.localize('rockit/appState/sample/toggleDirty', 'Toggle dirty')}
      </button>
      <button
        type="button"
        onClick={() =>
          service.updateState((prev) => ({
            theme: prev.theme === 'light' ? 'dark' : 'light',
          }))
        }
        style={{ marginLeft: '0.5rem' }}
      >
        {nls.localize('rockit/appState/sample/toggleTheme', 'Toggle theme')}
      </button>
      <button
        onClick={() =>
          service.addNotification(
            nls.localize(
              'rockit/appState/sample/notificationMessage',
              'Hello from SampleView',
            ),
          )
        }
        style={{ marginLeft: '0.5rem' }}
      >
        {nls.localize(
          'rockit/appState/sample/addNotification',
          'Add notification',
        )}
      </button>
      <button
        onClick={() =>
          service.updateState((prev) => ({
            settings: { ...prev.settings, autoSave: !prev.settings.autoSave },
          }))
        }
        style={{ marginLeft: '0.5rem' }}
      >
        {nls.localize(
          'rockit/appState/sample/toggleAutoSave',
          'Toggle autoSave',
        )}
      </button>
      <button
        onClick={() =>
          service.updateState((prev) => ({
            settings: { ...prev.settings, fontSize: prev.settings.fontSize + 1 },
          }))
        }
        style={{ marginLeft: '0.5rem' }}
      >
        {nls.localize('rockit/appState/sample/increaseFont', 'Font +1')}
      </button>
    </div>
  )
}

@injectable()
export class SampleReactWidget extends ReactWidget {
  static readonly ID = 'theia-app-state-sample:sample-react-widget'
  static readonly LABEL = nls.localize(
    'rockit/appState/sample/title',
    'AppState Sample',
  )

  @inject(AppStateService)
  protected readonly appStateService: AppStateService

  constructor() {
    super()
    this.id = SampleReactWidget.ID
    this.title.label = SampleReactWidget.LABEL
    this.title.caption = SampleReactWidget.LABEL
    this.title.closable = true
    this.title.iconClass = 'fa fa-sliders'
    this.update()
  }

  protected render(): React.ReactNode {
    return (
      <AppStateProvider service={this.appStateService}>
        <SampleView />
      </AppStateProvider>
    )
  }
}

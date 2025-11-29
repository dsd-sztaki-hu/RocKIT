import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { inject, injectable } from 'inversify'
import {
  AppStateProvider,
  useAppState,
  useAppStateService,
} from './state/app-state-react'
import { AppStateService } from './state/app-state-service'

import React = require('react')

function AppStatePanelView() {
  const appState = useAppState((state) => state)
  const service = useAppStateService()

  const formatStateForDisplay = (state: any) => {
    return JSON.stringify(state, null, 2)
  }

  return (
    <div
      style={{
        padding: '10px',
        height: '100%',
        overflow: 'auto',
        fontFamily: 'monospace',
        fontSize: '12px',
      }}
    >
      <h3 style={{ marginTop: '0', marginBottom: '10px' }}>Global AppState</h3>
      <button
        type="button"
        onClick={() => service.reset()}
        style={{ marginBottom: '10px', padding: '6px 10px', cursor: 'pointer' }}
      >
        Reset state to defaults
      </button>
      <pre
        style={{
          backgroundColor: '#f5f5f5',
          padding: '10px',
          borderRadius: '4px',
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {formatStateForDisplay(appState)}
      </pre>
    </div>
  )
}

@injectable()
export class AppStatePanelWidget extends ReactWidget {
  static readonly ID = 'theia-app-state-extension:app-state-panel'
  static readonly LABEL = 'AppState Panel'

  @inject(AppStateService)
  protected readonly appStateService: AppStateService

  constructor() {
    super()
    this.id = AppStatePanelWidget.ID
    this.title.label = AppStatePanelWidget.LABEL
    this.title.caption = AppStatePanelWidget.LABEL
    this.title.closable = true
    this.title.iconClass = 'fa fa-database'

    // trigger initial render
    this.update()
  }

  protected render(): React.ReactNode {
    return (
      <AppStateProvider service={this.appStateService}>
        <AppStatePanelView />
      </AppStateProvider>
    )
  }
}

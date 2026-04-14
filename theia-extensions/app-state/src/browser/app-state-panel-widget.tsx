import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { inject, injectable } from 'inversify'
import {
  AppStateProvider,
  useAppState,
  useAppStateService,
} from './state/app-state-react'
import { AppStateService } from './state/app-state-service'
import { RoCrateHistoryService } from './state/ro-crate-history-service'
import './app-state-panel-widget.css'

import React = require('react')

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isExpandable(value: unknown): boolean {
  return Array.isArray(value) || isObject(value)
}

function Preview({ value }: { value: any }) {
  if (Array.isArray(value)) {
    return <span>[{value.length}]</span>
  }
  if (isObject(value)) {
    const keys = Object.keys(value)
    return <span>{`{${keys.length}}`}</span>
  }
  if (typeof value === 'string') {
    return <span>"{value}"</span>
  }
  return <span>{String(value)}</span>
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[exponent]}`
}

function JsonNode({
  label,
  value,
  path,
  expanded,
  onToggle,
  depth = 0,
}: {
  label?: string
  value: any
  path: string
  expanded: Set<string>
  onToggle: (path: string) => void
  depth?: number
}) {
  const canExpand = isExpandable(value)
  const isOpen = expanded.has(path)

  const INDENT_STEP = 8
  const indent = depth * INDENT_STEP

  return (
    <div style={{ paddingLeft: indent }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: canExpand ? 'pointer' : 'default',
          userSelect: 'none',
          lineHeight: 1.6,
        }}
        onClick={() => (canExpand ? onToggle(path) : undefined)}
      >
        {canExpand ? (
          <span style={{ width: 14, display: 'inline-block' }}>{isOpen ? '▾' : '▸'}</span>
        ) : (
          <span style={{ width: 14, display: 'inline-block' }} />
        )}

        {label !== undefined && <span style={{ fontWeight: 600 }}>{label}:</span>}

        {!canExpand && <Preview value={value} />}

        {canExpand && !isOpen && (
          <span style={{ opacity: 0.7 }}>
            <Preview value={value} />
          </span>
        )}
      </div>

      {canExpand && isOpen && (
        <div>
          {Array.isArray(value) ? (
            value.length === 0 ? (
              <div style={{ paddingLeft: 14, opacity: 0.7 }}>[empty]</div>
            ) : (
              value.map((item, idx) => (
                <JsonNode
                  key={`${path}[${idx}]`}
                  label={`${idx}`}
                  value={item}
                  path={`${path}[${idx}]`}
                  expanded={expanded}
                  onToggle={onToggle}
                  depth={depth + 1}
                />
              ))
            )
          ) : Object.keys(value).length === 0 ? (
            <div style={{ paddingLeft: 14, opacity: 0.7 }}>{'{ }'}</div>
          ) : (
            Object.entries(value).map(([k, v]) => (
              <JsonNode
                key={`${path}.${k}`}
                label={k}
                value={v}
                path={`${path}.${k}`}
                expanded={expanded}
                onToggle={onToggle}
                depth={depth + 1}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function AppStatePanelView({ historyService }: { historyService: RoCrateHistoryService }) {
  const appState = useAppState((state) => state)
  const service = useAppStateService()
  const [historyRefreshTick, setHistoryRefreshTick] = React.useState(0)

  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(['root']))

  const historySnapshot = React.useMemo(
    () => historyService.getDebugSnapshot(50),
    [historyService, appState, historyRefreshTick],
  )

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const collapseAll = () => {
    setExpanded(new Set(['root', 'historyRoot']))
  }

  return (
    <div className="app-state-panel">
      <h3 className="app-state-panel-title">Global AppState</h3>

      <div className="app-state-panel-actions">
        <button
          type="button"
          className="theia-button app-state-panel-button"
          onClick={() => service.reset()}
        >
          Reset state to defaults
        </button>

        <button
          type="button"
          className="theia-button app-state-panel-button"
          onClick={collapseAll}
        >
          Collapse all
        </button>

        <button
          type="button"
          className="theia-button app-state-panel-button"
          onClick={() => setHistoryRefreshTick((v) => v + 1)}
        >
          Refresh history
        </button>

        <button
          type="button"
          className="theia-button app-state-panel-button"
          onClick={() => {
            historyService.clear()
            setHistoryRefreshTick((v) => v + 1)
          }}
        >
          Clear history
        </button>
      </div>

      <div className="app-state-panel-json">
        <JsonNode
          value={appState}
          path="root"
          expanded={expanded}
          onToggle={toggle}
          depth={0}
        />

        <h3 className="app-state-panel-title" style={{ marginTop: 16 }}>
          RO-Crate History (Temporary Debug)
        </h3>
        <div style={{ marginBottom: 8 }}>
          undo: <strong>{historySnapshot.undoCount}</strong> | redo:{' '}
          <strong>{historySnapshot.redoCount}</strong> | open transactions:{' '}
          <strong>{historySnapshot.transactionDepth}</strong>
        </div>
        <div style={{ marginBottom: 8 }}>
          rfc6902 patch bytes (approx, forward+backward):{' '}
          <strong>{formatBytes(historySnapshot.totalPatchBytes)}</strong> | undo-forward:{' '}
          <strong>{formatBytes(historySnapshot.undoPatchBytes)}</strong> | redo-forward:{' '}
          <strong>{formatBytes(historySnapshot.redoPatchBytes)}</strong>
        </div>
        <JsonNode
          value={historySnapshot}
          path="historyRoot"
          expanded={expanded}
          onToggle={toggle}
          depth={0}
        />
      </div>
    </div>
  )
}

@injectable()
export class AppStatePanelWidget extends ReactWidget {
  static readonly ID = 'theia-app-state-extension:app-state-panel'
  static readonly LABEL = 'AppState Panel'

  @inject(AppStateService)
  protected readonly appStateService: AppStateService

  @inject(RoCrateHistoryService)
  protected readonly roCrateHistoryService: RoCrateHistoryService

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
        <AppStatePanelView historyService={this.roCrateHistoryService} />
      </AppStateProvider>
    )
  }
}

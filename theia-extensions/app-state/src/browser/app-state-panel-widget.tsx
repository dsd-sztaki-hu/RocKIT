import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { inject, injectable } from 'inversify'
import {
  AppStateProvider,
  useAppState,
  useAppStateService,
} from './state/app-state-react'
import { AppStateService } from './state/app-state-service'

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

function AppStatePanelView() {
  const appState = useAppState((state) => state)
  const service = useAppStateService()

  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(['root']))

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const collapseAll = () => {
    setExpanded(new Set(['root']))
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
      <h3 style={{ marginTop: 0, marginBottom: 10 }}>Global AppState</h3>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => service.reset()}
          style={{ padding: '6px 10px', cursor: 'pointer' }}
        >
          Reset state to defaults
        </button>

        <button
          type="button"
          onClick={collapseAll}
          style={{ padding: '6px 10px', cursor: 'pointer' }}
        >
          Collapse all
        </button>
      </div>

      <div
        style={{
          backgroundColor: '#f5f5f5',
          padding: '10px',
          borderRadius: '4px',
          overflow: 'auto',
          whiteSpace: 'normal',
          wordBreak: 'break-word',
        }}
      >
        <JsonNode
          value={appState}
          path="root"
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

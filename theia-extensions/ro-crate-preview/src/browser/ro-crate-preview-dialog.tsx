import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import { AlertMessage } from '@theia/core/lib/browser/widgets/alert-message'
import { inject, injectable } from '@theia/core/shared/inversify'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import * as React from 'react'
import ReactJson from 'react-json-view'

const RO_CRATE_METADATA_FILE = 'ro-crate-metadata.json'

// --- JSON COMPONENT ---
const RoCrateJsonView = React.memo<{ jsonObject: any }>(({ jsonObject }) => {
  return (
    <div style={jsonContainerStyle}>
      <ReactJson
        src={jsonObject}
        theme="monokai"
        iconStyle={'triangle'}
        collapsed={2}
        displayDataTypes={false}
        enableClipboard={true}
        style={{ backgroundColor: 'transparent', fontSize: '12px' }}
      />
    </div>
  )
})

// --- MAIN CONTENT COMPONENT ---
interface RoCrateContentProps {
  jsonObject: any
  error: string | null
}

const RoCrateContent: React.FC<RoCrateContentProps> = ({ jsonObject, error }) => {
  const [isCopied, setIsCopied] = React.useState(false)

  // --- COPY HANDLER ---
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(JSON.stringify(jsonObject, null, 2))
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 5000)
    } catch (err) {
      console.error('Failed to copy to clipboard', err)
    }
  }

  return (
    <div style={contentWrapperStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <h3
          style={{
            margin: 0,
            fontSize: '14px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <i className="fa fa-code" style={{ color: 'var(--theia-brand-color)' }} />
          RO-Crate Source:
          <span style={{ color: '#ce9178', fontFamily: 'monospace' }}>
            {RO_CRATE_METADATA_FILE}
          </span>
        </h3>

        <button
          title="Copy raw JSON to clipboard"
          onClick={handleCopy}
          style={{
            background: 'none',
            border: 'none',
            outline: 'none',
            cursor: 'pointer',
            padding: '4px 8px',
            color: isCopied ? '#4caf50' : 'var(--theia-ui-font-color1)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontWeight: 'bold',
            fontSize: '12px',
          }}
        >
          {isCopied ? <span>Copied</span> : <span>Copy JSON</span>}
          <i
            className={isCopied ? 'fa fa-check' : 'fa fa-clipboard'}
            style={{ fontSize: '14px' }}
          ></i>
        </button>
      </div>

      {/* Content Area */}
      {error ? (
        <div style={{ marginTop: '10px' }}>
          <AlertMessage type="ERROR" header="Error">
            {error}
          </AlertMessage>
        </div>
      ) : (
        <RoCrateJsonView jsonObject={jsonObject} />
      )}
    </div>
  )
}

// --- STYLES ---

const contentWrapperStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: '1000px',
  minWidth: '800px',
  overflow: 'hidden',
}

const headerStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--theia-tree-indentGuidesStroke)',
  paddingBottom: '10px',
  marginBottom: '10px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexShrink: 0,
}

const jsonContainerStyle: React.CSSProperties = {
  backgroundColor: '#2d2d2d', // Or use var(--theia-editor-background)
  padding: '10px',
  borderRadius: '4px',
  overflowY: 'auto',
  flexGrow: 1,
  border: '1px solid var(--theia-tree-indentGuidesStroke)',
  cursor: 'text',
}

// --- THEIA DIALOG CLASS ---

@injectable()
export class ROCratePreviewDialog extends ReactDialog<string> {
  constructor(
    @inject(AppStateService) protected readonly appStateService: AppStateService,
  ) {
    super({ title: 'RO-Crate Preview' })
    this.appendCloseButton('Close')
  }

  protected render(): React.ReactNode {
    let jsonObject = {}
    let error: string | null = null

    try {
      // Fetch data directly from the service when rendering
      jsonObject = this.appStateService.roCrate || {}

      // Optional: Check if object is empty to show a friendly message
      if (Object.keys(jsonObject).length === 0) {
        error = 'The RO-Crate object is empty or could not be loaded.'
      }
    } catch (err: any) {
      error = `Could not read RO-Crate from Appstate: ${err.message}`
    }

    return <RoCrateContent jsonObject={jsonObject} error={error} />
  }

  // Standard Dialog value getter
  get value(): string {
    return ''
  }
}

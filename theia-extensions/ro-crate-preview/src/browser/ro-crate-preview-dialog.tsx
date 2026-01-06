import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import { AlertMessage } from '@theia/core/lib/browser/widgets/alert-message'
import { inject, injectable } from '@theia/core/shared/inversify'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import * as React from 'react'
import ReactJson from 'react-json-view'

const RoCrateJsonView = React.memo<{ jsonObject: any }>(({ jsonObject }) => {
  return (
    <div className={'roCratePreviewJsonContainer'}>
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

interface RoCrateContentProps {
  jsonObject: any
  error: string | null
}

const RoCrateContent: React.FC<RoCrateContentProps> = ({ jsonObject, error }) => {
  const [isCopied, setIsCopied] = React.useState(false)

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
    <div className={'roCratePreviewContentWrapper'}>
      {/* Header */}
      <div className={'roCratePreviewHeader'}>
        <h3>
          <i className="fa fa-code" style={{ color: 'var(--theia-brand-color)' }} />
          RO-Crate Source:
          <span style={{ color: '#ce9178', fontFamily: 'monospace' }}>AppState</span>
        </h3>

        <button
          className={'roCratePreviewCopyButton'}
          title="Copy raw JSON to clipboard"
          onClick={handleCopy}
          style={{
            color: isCopied ? '#4caf50' : 'var(--theia-ui-font-color1)',
          }}
        >
          {isCopied ? <span>Copied</span> : <span>Copy JSON</span>}
          <i
            className={isCopied ? 'fa fa-check' : 'fa fa-clipboard'}
            style={{ fontSize: '14px' }}
          ></i>
        </button>
      </div>

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
      jsonObject = this.appStateService.roCrate || {}

      if (Object.keys(jsonObject).length === 0) {
        error = 'The RO-Crate object is empty or could not be loaded.'
      }
    } catch (err: any) {
      error = `Could not read RO-Crate from Appstate: ${err.message}`
    }

    return <RoCrateContent jsonObject={jsonObject} error={error} />
  }

  get value(): string {
    return ''
  }
}

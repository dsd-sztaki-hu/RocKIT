// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import { AlertMessage } from '@theia/core/lib/browser/widgets/alert-message'
import { nls } from '@theia/core/lib/common'
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
  onOpenDocumentation: () => void
}

const RoCrateContent: React.FC<RoCrateContentProps> = ({
  jsonObject,
  error,
  onOpenDocumentation,
}) => {
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
          {nls.localize('rockit/roCratePreview/source', 'RO-Crate Source:')}{' '}
          <span style={{ color: '#ce9178', fontFamily: 'monospace' }}>AppState</span>
        </h3>

        <div className="roCratePreviewHeaderActions">
          <button
            className={'roCratePreviewCopyButton roCratePreviewHelpButton'}
            title={nls.localize(
              'rockit/roCratePreview/openDocumentation',
              'Open RO-Crate Preview documentation',
            )}
            onClick={(event) => {
              event.stopPropagation()
              onOpenDocumentation()
            }}
          >
            <i className="codicon codicon-info" style={{ fontSize: '14px' }} />
          </button>

          <button
            className={'roCratePreviewCopyButton'}
            title={nls.localize(
              'rockit/roCratePreview/copyToClipboard',
              'Copy raw JSON to clipboard',
            )}
            onClick={handleCopy}
            style={{
              color: isCopied ? '#4caf50' : 'var(--theia-ui-font-color1)',
            }}
          >
            {isCopied ? (
              <span>{nls.localize('rockit/roCratePreview/copied', 'Copied')}</span>
            ) : (
              <span>{nls.localize('rockit/roCratePreview/copyJson', 'Copy JSON')}</span>
            )}
            <i
              className={isCopied ? 'fa fa-check' : 'fa fa-clipboard'}
              style={{ fontSize: '14px' }}
            ></i>
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ marginTop: '10px' }}>
          <AlertMessage
            type="ERROR"
            header={nls.localize('rockit/roCratePreview/error', 'Error')}
          >
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
    protected readonly onOpenDocumentation: () => void,
  ) {
    super({ title: nls.localize('rockit/roCratePreview/title', 'RO-Crate Preview') })
    this.appendCloseButton(nls.localize('rockit/roCratePreview/close', 'Close'))
  }

  protected render(): React.ReactNode {
    let jsonObject = {}
    let error: string | null = null

    try {
      jsonObject = this.appStateService.roCrate || {}

      if (Object.keys(jsonObject).length === 0) {
        error = nls.localize(
          'rockit/roCratePreview/empty',
          'The RO-Crate object is empty or could not be loaded.',
        )
      }
    } catch (err: any) {
      error = nls.localize(
        'rockit/roCratePreview/readFailed',
        'Could not read RO-Crate from AppState: {0}',
        err.message,
      )
    }

    return (
      <RoCrateContent
        jsonObject={jsonObject}
        error={error}
        onOpenDocumentation={this.onOpenDocumentation}
      />
    )
  }

  get value(): string {
    return ''
  }
}

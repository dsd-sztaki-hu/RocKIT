import { AbstractDialog, Message } from '@theia/core/lib/browser'
import { Input } from 'antd'
import * as React from 'react'
import { createRoot, Root } from 'react-dom/client'

import '../styles/arp-ro-crate-import-dialog.css'

export interface ArpRoCrateImportInput {
  datasetUrl: string
}

export interface ArpRoCrateImportDialogOptions {
  title?: string
  description?: string
  placeholder?: string
}

export class ArpRoCrateImportDialog extends AbstractDialog<ArpRoCrateImportInput | undefined> {
  private reactRoot: Root | undefined
  private datasetUrl = ''

  constructor(protected readonly options: ArpRoCrateImportDialogOptions = {}) {
    super({ title: options.title ?? 'Import ARP RO-Crate' })

    this.contentNode.style.width = '560px'
    this.contentNode.style.maxWidth = '90vw'
    this.contentNode.style.padding = '0'

    this.appendCloseButton()
    this.appendAcceptButton('Continue')
  }

  get value(): ArpRoCrateImportInput | undefined {
    return this.isValid(undefined) ? { datasetUrl: this.datasetUrl.trim() } : undefined
  }

  protected isValid(_value: ArpRoCrateImportInput | undefined): boolean {
    return this.datasetUrl.trim().length > 0
  }

  protected render(): void {
    if (!this.reactRoot) {
      this.reactRoot = createRoot(this.contentNode)
    }

    this.reactRoot.render(
      <div className="arp-import-dialog">
        <div className="arp-import-dialog__description">
          {this.options.description ??
            'Enter the full handle or dataset URL for the ARP dataset to import.'}
        </div>
        <label className="arp-import-dialog__field">
          <span className="arp-import-dialog__label">Dataset URL</span>
          <Input
            className="arp-import-dialog__input"
            value={this.datasetUrl}
            autoFocus
            placeholder={this.options.placeholder ?? 'https://hdl.handle.net/21.T15999/...'}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              this.datasetUrl = event.target.value
              this.refresh()
            }}
            onPressEnter={() => {
              if (this.isValid(undefined)) {
                this.accept()
              }
            }}
          />
        </label>
      </div>,
    )
  }

  protected refresh(): void {
    this.render()
    this.update()
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg)
    this.render()
  }

  protected onBeforeDetach(msg: Message): void {
    if (this.reactRoot) {
      this.reactRoot.unmount()
      this.reactRoot = undefined
    }
    super.onBeforeDetach(msg)
  }
}

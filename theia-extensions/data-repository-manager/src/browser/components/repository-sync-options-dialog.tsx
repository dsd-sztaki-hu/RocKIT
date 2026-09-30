// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { AbstractDialog, Message } from '@theia/core/lib/browser'
import { nls } from '@theia/core/lib/common/nls'
import { Radio } from 'antd'
import * as React from 'react'
import { createRoot, Root } from 'react-dom/client'
import '../styles/repository-sync-options-dialog.css'
import { RepositorySyncMode } from '../types'

export interface RepositorySyncOptions {
  metadataMode: RepositorySyncMode
}

export class RepositorySyncOptionsDialog extends AbstractDialog<RepositorySyncOptions | undefined> {
  private reactRoot: Root | undefined
  private metadataMode: RepositorySyncMode = 'remote-additions'

  constructor() {
    super({
      title: nls.localize('rockit/dataRepository/syncFromRemote', 'Sync from remote'),
    })
    this.contentNode.style.width = '620px'
    this.contentNode.style.maxWidth = '90vw'
    this.contentNode.style.padding = '0'
    this.appendCloseButton()
    this.appendAcceptButton(nls.localize('rockit/dataRepository/syncFromRemote', 'Sync from remote'))
  }

  get value(): RepositorySyncOptions | undefined {
    return {
      metadataMode: this.metadataMode,
    }
  }

  protected isValid(_value: RepositorySyncOptions | undefined): boolean {
    return true
  }

  protected render(): void {
    if (!this.reactRoot) {
      this.reactRoot = createRoot(this.contentNode)
    }
    this.reactRoot.render(
      <div className="repository-sync-options">
        <p className="repository-sync-options__primary">
          {nls.localize(
            'rockit/dataRepository/syncFromRemotePrimaryWarning',
            'By continuing, the local version of this dataset might be overwritten.',
          )}
        </p>
        <p className="repository-sync-options__secondary">
          {nls.localize(
            'rockit/dataRepository/syncFromRemoteDetails',
            'Remote dataset metadata will be applied to the local RO-Crate using the selected crosswalk file. New or changed remote files will be downloaded. Local files removed remotely will stay in the workspace but may become orphaned.',
          )}
        </p>
        <Radio.Group
          className="repository-sync-options__form"
          value={this.metadataMode}
          onChange={(event) => {
            this.metadataMode = event.target.value as RepositorySyncMode
            this.refresh()
          }}
        >
          {this.renderOption(
            'complete',
            nls.localize('rockit/dataRepository/completeSync', 'Complete sync'),
            nls.localize('rockit/dataRepository/completeSyncDescription', 'Use the remote crate structure and metadata. Local files removed remotely remain on disk as orphaned files.'),
          )}
          {this.renderOption(
            'remote-additions',
            nls.localize('rockit/dataRepository/keepRemoteAdditions', 'Download remote additions'),
            nls.localize('rockit/dataRepository/keepRemoteAdditionsDescription', 'Keep local entities and edits, and add entities that exist only in the remote crate with their relationships.'),
          )}
          {this.renderOption(
            'local-additions',
            nls.localize('rockit/dataRepository/keepLocalAdditions', 'Keep only the local additions'),
            nls.localize('rockit/dataRepository/keepLocalAdditionsDescription', 'Use the remote crate as the base, then restore entities that exist only in the local crate with their relationships.'),
          )}
        </Radio.Group>
      </div>,
    )
  }

  private renderOption(value: RepositorySyncMode, label: string, description: string): React.ReactNode {
    return (
      <Radio value={value} className="repository-sync-options__option">
        <span className="repository-sync-options__option-content">
          <strong>{label}</strong>
          <small>{description}</small>
        </span>
      </Radio>
    )
  }

  private refresh(): void {
    this.render()
    this.update()
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg)
    this.render()
  }

  protected onBeforeDetach(msg: Message): void {
    this.reactRoot?.unmount()
    this.reactRoot = undefined
    super.onBeforeDetach(msg)
  }
}

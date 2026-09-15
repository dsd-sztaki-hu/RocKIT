// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { AbstractDialog, Message } from '@theia/core/lib/browser'
import { nls } from '@theia/core/lib/common/nls'
import { Checkbox } from 'antd'
import * as React from 'react'
import { createRoot, Root } from 'react-dom/client'
import '../styles/repository-sync-options-dialog.css'

export interface RepositorySyncOptions {
  replaceLocalMetadataWithUploadedRoCrate: boolean
}

export class RepositorySyncOptionsDialog extends AbstractDialog<RepositorySyncOptions | undefined> {
  private reactRoot: Root | undefined
  private replaceLocalMetadataWithUploadedRoCrate = false

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
      replaceLocalMetadataWithUploadedRoCrate: this.replaceLocalMetadataWithUploadedRoCrate,
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
        <div className="repository-sync-options__form">
          <Checkbox
            className="repository-sync-options__checkbox"
            checked={this.replaceLocalMetadataWithUploadedRoCrate}
            onChange={(event) => {
              this.replaceLocalMetadataWithUploadedRoCrate = event.target.checked
              this.refresh()
            }}
          >
            {nls.localize(
              'rockit/dataRepository/replaceLocalMetadataWithUploadedRoCrate',
              'Replace local RO-Crate metadata with the uploaded remote ro-crate-metadata.json first',
            )}
          </Checkbox>
          <p className="repository-sync-options__description">
            {nls.localize(
              'rockit/dataRepository/replaceLocalMetadataWithUploadedRoCrateDescription',
              'When enabled, RocKIT downloads the uploaded ro-crate-metadata.json from the remote repository, localizes its entity IDs, and uses it as the base before applying the repository metadata fields. When disabled, the current local ro-crate-metadata.json is kept as the base.',
            )}
          </p>
        </div>
      </div>,
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

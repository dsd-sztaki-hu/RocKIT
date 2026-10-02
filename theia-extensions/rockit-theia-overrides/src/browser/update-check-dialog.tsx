// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import { nls } from '@theia/core/lib/common'
import * as React from 'react'

import '../../src/browser/style/update-check-dialog.css'

export type UpdateCheckDialogState =
  | { status: 'checking' }
  | {
      status: 'update-available'
      currentVersion: string
      latestVersion: string
    }
  | {
      status: 'up-to-date'
      currentVersion: string
      latestVersion: string
    }
  | {
      status: 'error'
      detail: string
    }

interface UpdateCheckDialogProps {
  state: UpdateCheckDialogState
  doNotRemind: boolean
  onDoNotRemindChanged: (value: boolean) => void
  onOpenReleasePage: () => void
}

function UpdateCheckContent({
  state,
  doNotRemind,
  onDoNotRemindChanged,
  onOpenReleasePage,
}: UpdateCheckDialogProps): React.ReactElement {
  const openReleasePage = (event: React.MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault()
    onOpenReleasePage()
  }

  return (
    <div className="rockit-update-dialog">
      {state.status === 'checking' && (
        <>
          <h2>{nls.localize('rockit/updates/checkingTitle', 'Checking for updates')}</h2>
          <p>
            {nls.localize(
              'rockit/updates/checkingDescription',
              'RocKIT is checking GitHub for the latest available release.',
            )}
          </p>
        </>
      )}

      {state.status === 'update-available' && (
        <>
          <h2>
            {nls.localize('rockit/updates/availableTitle', 'A new version is available')}
          </h2>
          <p>
            {nls.localize(
              'rockit/updates/availableDescription',
              'RocKIT {0} is available. You are currently using version {1}.',
              state.latestVersion,
              state.currentVersion,
            )}
          </p>
          <p>
            {nls.localize(
              'rockit/updates/availableRecommendation',
              'Updating is recommended to receive the latest improvements and fixes.',
            )}
          </p>
        </>
      )}

      {state.status === 'up-to-date' && (
        <>
          <h2>{nls.localize('rockit/updates/currentTitle', 'RocKIT is up to date')}</h2>
          <p>
            {nls.localize(
              'rockit/updates/currentDescription',
              'You are using RocKIT {0}, which is the latest available version.',
              state.currentVersion,
            )}
          </p>
        </>
      )}

      {state.status === 'error' && (
        <>
          <h2>
            {nls.localize('rockit/updates/errorTitle', 'Unable to check for updates')}
          </h2>
          <p>
            {nls.localize(
              'rockit/updates/errorDescription',
              'RocKIT could not retrieve the latest release information from GitHub.',
            )}
          </p>
          <p className="rockit-update-error">{state.detail}</p>
        </>
      )}

      <p className="rockit-update-release-link">
        {nls.localize(
          'rockit/updates/releaseLinkPrefix',
          'You can view available releases on the',
        )}{' '}
        <a
          href="https://github.com/dsd-sztaki-hu/RocKIT/releases"
          onClick={openReleasePage}
        >
          {nls.localize('rockit/updates/releaseLink', 'RocKIT GitHub Releases page')}
        </a>
        .
      </p>

      {state.status !== 'checking' && (
        <label className="rockit-update-reminder">
          <input
            type="checkbox"
            checked={doNotRemind}
            onChange={(event) => onDoNotRemindChanged(event.currentTarget.checked)}
          />
          <span>
            {nls.localize(
              'rockit/updates/doNotRemind',
              "Don't notify me automatically about available updates",
            )}
          </span>
        </label>
      )}
    </div>
  )
}

export class UpdateCheckDialog extends ReactDialog<boolean> {
  protected state: UpdateCheckDialogState
  protected doNotRemind: boolean

  constructor(protected readonly updateProps: UpdateCheckDialogProps) {
    super({
      title: nls.localize('rockit/updates/dialogTitle', 'RocKIT Update'),
      maxWidth: 640,
      wordWrap: 'break-word',
    })
    this.state = updateProps.state
    this.doNotRemind = updateProps.doNotRemind
    this.appendCloseButton(nls.localize('rockit/updates/close', 'Close'))
  }

  setState(state: UpdateCheckDialogState, doNotRemind = false): void {
    this.state = state
    this.doNotRemind = doNotRemind
    this.update()
  }

  protected render(): React.ReactNode {
    return (
      <UpdateCheckContent
        {...this.updateProps}
        state={this.state}
        doNotRemind={this.doNotRemind}
        onDoNotRemindChanged={(value) => {
          this.doNotRemind = value
          this.updateProps.onDoNotRemindChanged(value)
          this.update()
        }}
      />
    )
  }

  get value(): boolean {
    return this.doNotRemind
  }
}

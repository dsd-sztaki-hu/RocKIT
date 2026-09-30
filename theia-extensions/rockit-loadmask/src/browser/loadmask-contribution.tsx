// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import type {
  FrontendApplication,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser'
import { DisposableCollection } from '@theia/core/lib/common'
import { inject, injectable } from '@theia/core/shared/inversify'
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LoadMaskService, type LoadMaskState } from './loadmask-service'

@injectable()
export class LoadMaskContribution implements FrontendApplicationContribution {
  @inject(LoadMaskService)
  protected readonly loadMaskService: LoadMaskService

  protected readonly toDispose = new DisposableCollection()
  protected host?: HTMLDivElement
  protected root?: Root
  protected shellNode?: HTMLElement
  protected wasVisible = false
  protected shellMasked = false
  protected shellWasInert = false
  protected shellAriaBusy: string | null = null

  onStart(app: FrontendApplication): void {
    this.shellNode = app.shell.node
    this.host = document.createElement('div')
    this.host.id = 'rockit-loadmask-host'
    document.body.appendChild(this.host)
    this.root = createRoot(this.host)

    this.toDispose.push(this.loadMaskService.onDidChange((state) => this.render(state)))
    this.render(this.loadMaskService.state)
  }

  onStop(): void {
    this.toDispose.dispose()
    this.root?.unmount()
    this.host?.remove()
    this.setShellBusy(false)
  }

  protected render(state: LoadMaskState): void {
    const shouldFocusOverlay = state.visible && !this.wasVisible
    this.setShellBusy(state.visible)
    this.root?.render(
      state.visible ? (
        <div
          className="rockit-loadmask-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rockit-loadmask-message"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && state.cancellable && !state.cancelRequested) {
              void this.loadMaskService.cancelCurrent()
            }
          }}
        >
          <div className="rockit-loadmask-card">
            <div className="rockit-loadmask-spinner" aria-hidden="true" />
            <div id="rockit-loadmask-message" className="rockit-loadmask-message">
              {state.message}
            </div>
            {state.progress
              ? this.renderProgress(state.progress.worked, state.progress.total)
              : undefined}
            {state.activeCount > 1 ? (
              <div className="rockit-loadmask-count">
                {state.activeCount} operations in progress
              </div>
            ) : undefined}
            {state.cancellable ? (
              <button
                type="button"
                className="theia-button secondary rockit-loadmask-cancel"
                disabled={state.cancelRequested}
                onClick={() => void this.loadMaskService.cancelCurrent()}
              >
                {state.cancelRequested ? 'Cancelling…' : 'Cancel'}
              </button>
            ) : undefined}
          </div>
        </div>
      ) : undefined,
    )
    if (shouldFocusOverlay) {
      window.requestAnimationFrame(() => {
        this.host?.querySelector<HTMLElement>('.rockit-loadmask-overlay')?.focus()
      })
    }
    this.wasVisible = state.visible
  }

  protected renderProgress(worked: number, total: number): React.ReactNode {
    const percentage = Math.round(
      Math.min(100, Math.max(0, (worked / total) * 100)),
    )
    return (
      <div className="rockit-loadmask-progress-group">
        <div
          className="rockit-loadmask-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={worked}
          aria-label={`${percentage}% complete`}
        >
          <div
            className="rockit-loadmask-progress-value"
            style={{ width: `${percentage}%` }}
          />
        </div>
        <span className="rockit-loadmask-progress-label">{percentage}%</span>
      </div>
    )
  }

  protected setShellBusy(busy: boolean): void {
    if (!this.shellNode || busy === this.shellMasked) {
      return
    }
    if (busy) {
      this.shellWasInert = this.shellNode.hasAttribute('inert')
      this.shellAriaBusy = this.shellNode.getAttribute('aria-busy')
      this.shellNode.setAttribute('aria-busy', 'true')
      this.shellNode.setAttribute('inert', '')
    } else {
      if (this.shellAriaBusy === null) {
        this.shellNode.removeAttribute('aria-busy')
      } else {
        this.shellNode.setAttribute('aria-busy', this.shellAriaBusy)
      }
      if (!this.shellWasInert) {
        this.shellNode.removeAttribute('inert')
      }
      if (this.wasVisible) {
        this.shellNode.focus()
      }
    }
    this.shellMasked = busy
  }
}

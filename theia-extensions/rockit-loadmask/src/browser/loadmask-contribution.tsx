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
  protected shellAriaBusy: string | null = null
  protected readonly blockedNodes = new Map<
    HTMLElement,
    { inert: string | null; marker: string | null }
  >()
  protected backgroundObserver?: MutationObserver
  protected hostObserver?: MutationObserver
  protected hostInert: string | null = null
  protected previousFocus?: HTMLElement

  protected readonly blockBackgroundEvent = (event: Event): void => {
    if (!this.shellMasked) return
    const insideOverlay =
      event.target instanceof Node && this.host?.contains(event.target)
    if (event instanceof KeyboardEvent) {
      // Theia also handles keys on document/body, outside the inert shell.
      // Consume them here so Escape cannot dismiss a background dialog.
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.type === 'keydown') {
        const state = this.loadMaskService.state
        const cancel = this.host?.querySelector<HTMLButtonElement>(
          'button:not(:disabled)',
        )
        if (event.key === 'Escape' && state.cancellable && !state.cancelRequested) {
          void this.loadMaskService.cancelCurrent()
        } else if (event.key === 'Tab') {
          if (cancel) cancel.focus()
          else this.focusOverlay()
        } else if (
          insideOverlay &&
          (event.key === 'Enter' || event.key === ' ') &&
          event.target === cancel
        ) {
          cancel?.click()
        }
      }
      return
    }
    // Keep the overlay's own cancellation control usable.
    if (
      insideOverlay &&
      event.target instanceof Element &&
      event.target.closest('.rockit-loadmask-cancel')
    )
      return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  protected readonly keepFocusInOverlay = (event: FocusEvent): void => {
    if (
      this.shellMasked &&
      event.target instanceof Node &&
      !this.host?.contains(event.target)
    ) {
      event.stopImmediatePropagation()
      this.focusOverlay()
    }
  }

  protected focusOverlay(): void {
    const target =
      this.host?.querySelector<HTMLElement>('.rockit-loadmask-overlay') ?? this.host
    target?.focus({ preventScroll: true })
  }

  protected blockBackgroundNodes(): void {
    for (const node of Array.from(document.body.children)) {
      if (
        !(node instanceof HTMLElement) ||
        node === this.host ||
        this.blockedNodes.has(node)
      )
        continue
      this.blockedNodes.set(node, {
        inert: node.getAttribute('inert'),
        marker: node.getAttribute('data-rockit-loadmask-blocked'),
      })
      node.setAttribute('inert', '')
      node.setAttribute('data-rockit-loadmask-blocked', '')
    }
  }

  protected readonly blockedEvents = [
    'keydown',
    'keyup',
    'keypress',
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'click',
    'dblclick',
    'contextmenu',
    'wheel',
    'touchstart',
    'touchmove',
    'touchend',
    'dragstart',
    'drop',
  ]

  onStart(app: FrontendApplication): void {
    this.shellNode = app.shell.node
    this.host = document.createElement('div')
    this.host.id = 'rockit-loadmask-host'
    this.host.tabIndex = -1
    this.host.hidden = true
    document.body.appendChild(this.host)
    this.root = createRoot(this.host)

    this.toDispose.push(this.loadMaskService.onDidChange((state) => this.render(state)))
    this.render(this.loadMaskService.state)
  }

  onStop(): void {
    this.setShellBusy(false)
    this.toDispose.dispose()
    this.root?.unmount()
    this.host?.remove()
  }

  protected render(state: LoadMaskState): void {
    const shouldFocusOverlay = state.visible && !this.wasVisible
    if (this.host) this.host.hidden = !state.visible
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
        if (this.shellMasked) this.focusOverlay()
      })
    }
    this.wasVisible = state.visible
  }

  protected renderProgress(worked: number, total: number): React.ReactNode {
    const percentage = Math.round(Math.min(100, Math.max(0, (worked / total) * 100)))
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
    if (busy === this.shellMasked) {
      return
    }
    this.shellMasked = busy
    if (busy) {
      this.previousFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : undefined
      this.shellAriaBusy = this.shellNode?.getAttribute('aria-busy') ?? null
      this.shellNode?.setAttribute('aria-busy', 'true')
      // Theia dialogs mark all body siblings inert, including this host. The
      // mask must stay interactive above those dialogs while work is running.
      this.hostInert = this.host?.getAttribute('inert') ?? null
      this.host?.removeAttribute('inert')
      this.hostObserver = new MutationObserver(() => {
        if (this.shellMasked && this.host?.hasAttribute('inert')) {
          this.hostInert = this.host.getAttribute('inert')
          this.host.removeAttribute('inert')
          this.focusOverlay()
        }
      })
      if (this.host)
        this.hostObserver.observe(this.host, {
          attributes: true,
          attributeFilter: ['inert'],
        })
      this.blockBackgroundNodes()
      this.backgroundObserver = new MutationObserver(() => this.blockBackgroundNodes())
      this.backgroundObserver.observe(document.body, { childList: true })
      for (const type of this.blockedEvents)
        window.addEventListener(type, this.blockBackgroundEvent, {
          capture: true,
          passive: false,
        })
      window.addEventListener('focusin', this.keepFocusInOverlay, true)
      this.focusOverlay()
    } else {
      this.hostObserver?.disconnect()
      this.hostObserver = undefined
      this.backgroundObserver?.disconnect()
      this.backgroundObserver = undefined
      for (const type of this.blockedEvents)
        window.removeEventListener(type, this.blockBackgroundEvent, true)
      window.removeEventListener('focusin', this.keepFocusInOverlay, true)
      for (const [node, original] of this.blockedNodes) {
        if (original.inert === null) node.removeAttribute('inert')
        else node.setAttribute('inert', original.inert)
        if (original.marker === null) node.removeAttribute('data-rockit-loadmask-blocked')
        else node.setAttribute('data-rockit-loadmask-blocked', original.marker)
      }
      this.blockedNodes.clear()
      if (this.hostInert === null) this.host?.removeAttribute('inert')
      else this.host?.setAttribute('inert', this.hostInert)
      if (this.shellAriaBusy === null) {
        this.shellNode?.removeAttribute('aria-busy')
      } else {
        this.shellNode?.setAttribute('aria-busy', this.shellAriaBusy)
      }
      if (this.previousFocus?.isConnected)
        this.previousFocus.focus({ preventScroll: true })
      this.previousFocus = undefined
    }
  }
}

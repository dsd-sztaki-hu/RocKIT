// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import {
  app,
  BrowserWindow,
  dialog,
  Event,
  WebContents,
} from '@theia/core/electron-shared/electron'
import { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application'
import { injectable } from '@theia/core/shared/inversify'

@injectable()
export class RendererFailureContribution
  implements ElectronMainApplicationContribution
{
  protected readonly observedWebContents = new Set<number>()
  protected readonly openUnresponsiveDialogs = new Set<number>()
  protected readonly locales = new Map<number, string>()
  protected stopping = false
  protected terminating = false

  onStart(): void {
    app.on('web-contents-created', this.handleWebContentsCreated)

    for (const window of BrowserWindow.getAllWindows()) {
      this.observeWebContents(window.webContents)
    }
  }

  onStop(): void {
    this.stopping = true
    app.removeListener('web-contents-created', this.handleWebContentsCreated)
  }

  protected readonly handleWebContentsCreated = (
    _event: Event,
    contents: WebContents,
  ): void => {
    this.observeWebContents(contents)
  }

  protected observeWebContents(contents: WebContents): void {
    if (
      this.observedWebContents.has(contents.id) ||
      !BrowserWindow.fromWebContents(contents)
    ) {
      return
    }

    this.observedWebContents.add(contents.id)
    contents.on('did-finish-load', () => {
      void this.captureLocale(contents)
    })
    contents.on('render-process-gone', (_event, details) => {
      this.handleRendererGone(contents, details.reason)
    })
    contents.on('unresponsive', () => {
      void this.handleRendererUnresponsive(contents)
    })
    contents.once('destroyed', () => {
      this.observedWebContents.delete(contents.id)
      this.openUnresponsiveDialogs.delete(contents.id)
      this.locales.delete(contents.id)
    })
  }

  protected async captureLocale(contents: WebContents): Promise<void> {
    try {
      const locale = await contents.executeJavaScript(
        "window.localStorage.getItem('localeId')",
      )
      if (typeof locale === 'string') {
        this.locales.set(contents.id, locale)
      } else {
        this.locales.delete(contents.id)
      }
    } catch {
      // The renderer may disappear while the locale is being read. English is
      // the safe fallback until the next successful page load.
    }
  }

  protected handleRendererGone(contents: WebContents, reason: string): void {
    if (this.stopping || this.terminating || reason === 'clean-exit') {
      return
    }

    this.terminating = true
    const hungarian = this.isHungarian(contents)
    const outOfMemory = reason === 'oom'
    const message = hungarian
      ? outOfMemory
        ? 'Az alkalmazás kifogyott a rendelkezésre álló memóriából.'
        : 'Az alkalmazás súlyos hibát észlelt, ezért nem tud tovább működni.'
      : outOfMemory
        ? 'The application has run out of available memory.'
        : 'The application encountered a serious problem and cannot continue.'
    const detail = hungarian
      ? outOfMemory
        ? 'Ez nagyon nagy adatcsomag vagy művelet használatakor fordulhat elő. A RocKIT-nek most be kell záródnia. A nem mentett módosítások elveszhettek.'
        : 'A RocKIT-nek most be kell záródnia, hogy ne maradjon használhatatlan állapotban. A nem mentett módosítások elveszhettek.'
      : outOfMemory
        ? 'This can happen when working with a very large dataset or operation. RocKIT must now close. Any changes that were not saved may have been lost.'
        : 'RocKIT must now close to avoid leaving the application in an unusable state. Any changes that were not saved may have been lost.'

    dialog.showMessageBoxSync({
      type: 'error',
      title: hungarian ? 'A RocKIT-nek be kell záródnia' : 'RocKIT needs to close',
      message,
      detail,
      buttons: [hungarian ? 'Alkalmazás bezárása' : 'Close Application'],
      defaultId: 0,
      noLink: true,
    })
    app.exit(1)
  }

  protected async handleRendererUnresponsive(
    contents: WebContents,
  ): Promise<void> {
    if (
      this.stopping ||
      this.terminating ||
      contents.isDestroyed() ||
      this.openUnresponsiveDialogs.has(contents.id)
    ) {
      return
    }

    this.openUnresponsiveDialogs.add(contents.id)
    try {
      const hungarian = this.isHungarian(contents)
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: hungarian ? 'A RocKIT nem válaszol' : 'RocKIT is not responding',
        message: hungarian
          ? 'Az alkalmazás nem válaszol.'
          : 'The application is not responding.',
        detail: hungarian
          ? 'Ha vár, egy nagy méretű művelet még befejeződhet. Zárja be az alkalmazást, ha továbbra sem használható.'
          : 'A large operation may still finish if you wait. Close the application if it remains unusable.',
        buttons: hungarian
          ? ['Várakozás', 'Alkalmazás bezárása']
          : ['Wait', 'Close Application'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })

      if (result.response === 1 && !this.terminating) {
        this.terminating = true
        app.exit(1)
      }
    } finally {
      this.openUnresponsiveDialogs.delete(contents.id)
    }
  }

  protected isHungarian(contents: WebContents): boolean {
    return this.locales.get(contents.id)?.toLowerCase().startsWith('hu') ?? false
  }
}

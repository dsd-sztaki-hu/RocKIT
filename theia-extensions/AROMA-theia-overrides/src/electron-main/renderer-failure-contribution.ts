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
    contents.on('render-process-gone', (_event, details) => {
      this.handleRendererGone(details.reason)
    })
    contents.on('unresponsive', () => {
      void this.handleRendererUnresponsive(contents)
    })
    contents.once('destroyed', () => {
      this.observedWebContents.delete(contents.id)
      this.openUnresponsiveDialogs.delete(contents.id)
    })
  }

  protected handleRendererGone(reason: string): void {
    if (this.stopping || this.terminating || reason === 'clean-exit') {
      return
    }

    this.terminating = true
    const message =
      reason === 'oom'
        ? 'The application has run out of available memory.'
        : 'The application encountered a serious problem and cannot continue.'
    const detail =
      reason === 'oom'
        ? 'This can happen when working with a very large dataset or operation. AROMA-2 must now close. Any changes that were not saved may have been lost.'
        : 'AROMA-2 must now close to avoid leaving the application in an unusable state. Any changes that were not saved may have been lost.'

    dialog.showMessageBoxSync({
      type: 'error',
      title: 'AROMA-2 needs to close',
      message,
      detail,
      buttons: ['Close Application'],
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
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: 'AROMA-2 is not responding',
        message: 'The application is not responding.',
        detail:
          'A large operation may still finish if you wait. Close the application if it remains unusable.',
        buttons: ['Wait', 'Close Application'],
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
}

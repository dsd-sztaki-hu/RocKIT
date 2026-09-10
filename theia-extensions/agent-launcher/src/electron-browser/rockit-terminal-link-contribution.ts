import { injectable } from '@theia/core/shared/inversify'
import type { TheiaCoreAPI } from '@theia/core/lib/electron-common/electron-api'
import type {
  TerminalContribution,
  TerminalWidgetImpl,
} from '@theia/terminal/lib/browser/terminal-widget-impl'

export type SystemLinkOpener = (href: string) => void

export function createRockitTerminalLinkHandler(openSystemApp: SystemLinkOpener) {
  return {
    activate: (event: MouseEvent, text: string): void => {
      event.preventDefault()

      const href = text.trim()
      let url: URL

      try {
        url = new URL(href)
      } catch {
        return
      }

      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return
      }

      openSystemApp(href)
    },
  }
}

@injectable()
export class RockitTerminalLinkContribution implements TerminalContribution {
  onCreate(terminal: TerminalWidgetImpl): void {
    terminal.getTerminal().options.linkHandler = createRockitTerminalLinkHandler((href) => {
      const { electronTheiaCore } = window as Window & { electronTheiaCore: TheiaCoreAPI }
      electronTheiaCore.openWithSystemApp(href)
    })
  }
}

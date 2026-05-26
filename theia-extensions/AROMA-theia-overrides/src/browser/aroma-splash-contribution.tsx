import {
  CommonMenus,
  FrontendApplicationContribution,
  OpenerService,
  open,
} from '@theia/core/lib/browser'
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import {
  ApplicationInfo,
  ApplicationServer,
} from '@theia/core/lib/common/application-protocol'
import {
  Command,
  CommandContribution,
  CommandRegistry,
  MenuContribution,
  MenuModelRegistry,
  PreferenceScope,
  PreferenceService,
} from '@theia/core/lib/common'
import URI from '@theia/core/lib/common/uri'
import { inject, injectable } from '@theia/core/shared/inversify'
import * as React from 'react'
import corePackage = require('@theia/core/package.json')
import { AROMA_SPLASH_SHOW_AT_STARTUP } from '../common/aroma-splash-preferences'

import '../../src/browser/style/aroma-splash.css'

const THEIA_VERSION = (corePackage as { version?: string }).version || 'unknown'
const DEFAULT_APP_INFO: ApplicationInfo = {
  name: 'AROMA-2',
  version: THEIA_VERSION,
}
const RO_CRATE_DOCUMENTATION_URL = 'https://www.researchobject.org/ro-crate/'
const DSD_URL = 'https://dsd.sztaki.hu/hu'
const SUPPORT_EMAIL = 'aroma-support@example.org'

export const ABOUT_AROMA_COMMAND: Command = {
  id: 'aroma.about',
  label: 'About AROMA-2',
}

interface AromaSplashDialogProps {
  appInfo: ApplicationInfo
  showAtStartup: boolean
  onShowAtStartupChanged: (value: boolean) => void
  onOpenLink: (url: string) => void
}

function versionPathSegment(version: string): string {
  const trimmed = version.trim().replace(/^v\s*/i, '')
  return trimmed || 'latest'
}

function buildVersionedUrl(version: string, page: string): string {
  const segment = encodeURIComponent(versionPathSegment(version))
  return `https://aroma-project.github.io/aroma-2/${segment}/${page}`
}

function AromaSplashContent({
  appInfo,
  showAtStartup,
  onShowAtStartupChanged,
  onOpenLink,
}: AromaSplashDialogProps): React.ReactElement {
  const version = appInfo.version || DEFAULT_APP_INFO.version
  const userGuideUrl = buildVersionedUrl(version, 'help')

  const openLink = (event: React.MouseEvent<HTMLAnchorElement>, url: string): void => {
    event.preventDefault()
    onOpenLink(url)
  }

  return (
    <div className="aroma-splash">
      <div className="aroma-splash-header">
        <div className="aroma-splash-logo" aria-hidden="true" />
        <div>
          <div className="aroma-splash-title">AROMA-2</div>
          <div className="aroma-splash-version">Version {version}</div>
        </div>
      </div>

      <div className="aroma-splash-section">
        <h3>RO-Crate Resources</h3>
        <p>
          Access the version-matched RO-Crate reference material and application
          help for this AROMA-2 build.
        </p>
        <div className="aroma-splash-links">
          <a
            href={RO_CRATE_DOCUMENTATION_URL}
            onClick={(event) => openLink(event, RO_CRATE_DOCUMENTATION_URL)}
          >
            RO-Crate information
          </a>
          <a href={userGuideUrl} onClick={(event) => openLink(event, userGuideUrl)}>
            AROMA-2 Documentation
          </a>
        </div>
      </div>

      <div className="aroma-splash-section aroma-splash-developers">
        <h3>Developed By</h3>
        <p>
          AROMA-2 is developed by{' '}
          <a
            href={DSD_URL}
            onClick={(event) => openLink(event, DSD_URL)}
          >
            HUN-REN SZTAKI DSD
          </a>
          .
        </p>
        <p>
          For support, contact{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>

      <label className="aroma-splash-startup">
        <input
          type="checkbox"
          checked={!showAtStartup}
          onChange={(event) => onShowAtStartupChanged(!event.currentTarget.checked)}
        />
        <span>Do not show this window again</span>
      </label>
    </div>
  )
}

class AromaSplashDialog extends ReactDialog<boolean> {
  protected showAtStartup: boolean

  constructor(
    protected readonly splashProps: AromaSplashDialogProps,
  ) {
    super({ title: 'About AROMA-2' })
    this.showAtStartup = splashProps.showAtStartup
    this.appendCloseButton('Close')
  }

  protected render(): React.ReactNode {
    return (
      <AromaSplashContent
        {...this.splashProps}
        showAtStartup={this.showAtStartup}
        onShowAtStartupChanged={(value) => {
          this.showAtStartup = value
          this.splashProps.onShowAtStartupChanged(value)
          this.update()
        }}
      />
    )
  }

  get value(): boolean {
    return this.showAtStartup
  }
}

@injectable()
export class AromaSplashContribution implements FrontendApplicationContribution, CommandContribution, MenuContribution {
  @inject(PreferenceService)
  protected readonly preferenceService: PreferenceService

  @inject(ApplicationServer)
  protected readonly applicationServer: ApplicationServer

  @inject(OpenerService)
  protected readonly openerService: OpenerService

  protected appInfo: ApplicationInfo = DEFAULT_APP_INFO
  protected showAtStartup = true

  async onStart(): Promise<void> {
    const [appInfo] = await Promise.all([
      this.applicationServer.getApplicationInfo(),
    ])

    this.appInfo = {
      name: appInfo?.name || DEFAULT_APP_INFO.name,
      version: THEIA_VERSION,
    }
    this.showAtStartup = this.preferenceService.get<boolean>(
      AROMA_SPLASH_SHOW_AT_STARTUP,
      true,
    )

    if (this.showAtStartup) {
      setTimeout(() => {
        void this.openSplash()
      }, 0)
    }
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(ABOUT_AROMA_COMMAND, {
      execute: () => this.openSplash(),
    })
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.HELP, {
      commandId: ABOUT_AROMA_COMMAND.id,
      label: ABOUT_AROMA_COMMAND.label,
      order: '9a',
    })
  }

  protected async openSplash(): Promise<void> {
    const dialog = new AromaSplashDialog({
      appInfo: this.appInfo,
      showAtStartup: this.showAtStartup,
      onShowAtStartupChanged: (value) => {
        this.showAtStartup = value
        void this.preferenceService.set(
          AROMA_SPLASH_SHOW_AT_STARTUP,
          value,
          PreferenceScope.User,
        )
      },
      onOpenLink: (url) => {
        void open(this.openerService, new URI(url), { openExternalApp: true })
      },
    })

    await dialog.open()
  }
}

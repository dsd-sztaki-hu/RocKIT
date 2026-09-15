// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

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
  nls,
} from '@theia/core/lib/common'
import URI from '@theia/core/lib/common/uri'
import { inject, injectable } from '@theia/core/shared/inversify'
import * as React from 'react'
import { buildDocumentationUrl } from 'rockit-common/lib/browser'
import { ROCKIT_SPLASH_SHOW_AT_STARTUP } from '../common/rockit-splash-preferences'

import '../../src/browser/style/rockit-splash.css'

const APP_FULL_NAME = 'RocKIT - RO-Crate Kit'
const DEFAULT_APP_INFO: ApplicationInfo = {
  name: APP_FULL_NAME,
  version: 'unknown',
}
const RO_CRATE_DOCUMENTATION_URL = 'https://www.researchobject.org/ro-crate/'
const DSD_URL = 'https://dsd.sztaki.hu/hu'
const SUPPORT_EMAIL = 'rockit-support@example.org'

export const ABOUT_ROCKIT_COMMAND: Command = {
  id: 'rockit.about',
  label: nls.localize('rockit/about/command', 'About RocKIT'),
}

interface RockitSplashDialogProps {
  appInfo: ApplicationInfo
  showAtStartup: boolean
  onShowAtStartupChanged: (value: boolean) => void
  onOpenLink: (url: string) => void
}

function RockitSplashContent({
  appInfo,
  showAtStartup,
  onShowAtStartupChanged,
  onOpenLink,
}: RockitSplashDialogProps): React.ReactElement {
  const version = appInfo.version || DEFAULT_APP_INFO.version
  const userGuideUrl = buildDocumentationUrl(version)

  const openLink = (event: React.MouseEvent<HTMLAnchorElement>, url: string): void => {
    event.preventDefault()
    onOpenLink(url)
  }

  return (
    <div className="rockit-splash">
      <div className="rockit-splash-header">
        <div className="rockit-splash-logo" role="img" aria-label={APP_FULL_NAME} />
        <div>
          <div className="rockit-splash-title">{APP_FULL_NAME}</div>
          <div className="rockit-splash-version">
            {nls.localize('rockit/about/version', 'Version {0}', version)}
          </div>
        </div>
      </div>

      <div className="rockit-splash-section">
        <h3>{nls.localize('rockit/about/resources', 'RO-Crate Resources')}</h3>
        <p>
          {nls.localize(
            'rockit/about/resourcesDescription',
            'Access the version-matched RO-Crate reference material and application help for this RocKIT build.',
          )}
        </p>
        <div className="rockit-splash-links">
          <a
            href={RO_CRATE_DOCUMENTATION_URL}
            onClick={(event) => openLink(event, RO_CRATE_DOCUMENTATION_URL)}
          >
            {nls.localize('rockit/about/roCrateInformation', 'RO-Crate information')}
          </a>
          <a href={userGuideUrl} onClick={(event) => openLink(event, userGuideUrl)}>
            {nls.localize('rockit/about/documentation', 'RocKIT Documentation')}
          </a>
        </div>
      </div>

      <div className="rockit-splash-section rockit-splash-developers">
        <h3>{nls.localize('rockit/about/developedBy', 'Developed By')}</h3>
        <p>
          {nls.localize(
            'rockit/about/developedByText',
            'RocKIT - RO-Crate Kit is developed by',
          )}{' '}
          <a
            href={DSD_URL}
            onClick={(event) => openLink(event, DSD_URL)}
          >
            HUN-REN SZTAKI DSD
          </a>
          .
        </p>
        <p>
          {nls.localize('rockit/about/support', 'For support, contact')}{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>

      <label className="rockit-splash-startup">
        <input
          type="checkbox"
          checked={!showAtStartup}
          onChange={(event) => onShowAtStartupChanged(!event.currentTarget.checked)}
        />
        <span>
          {nls.localize(
            'rockit/about/doNotShowAgain',
            'Do not show this window again',
          )}
        </span>
      </label>
    </div>
  )
}

class RockitSplashDialog extends ReactDialog<boolean> {
  protected showAtStartup: boolean

  constructor(
    protected readonly splashProps: RockitSplashDialogProps,
  ) {
    super({ title: nls.localize('rockit/about/command', 'About RocKIT') })
    this.showAtStartup = splashProps.showAtStartup
    this.appendCloseButton(nls.localize('rockit/about/close', 'Close'))
  }

  protected render(): React.ReactNode {
    return (
      <RockitSplashContent
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
export class RockitSplashContribution implements FrontendApplicationContribution, CommandContribution, MenuContribution {
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
      version: appInfo?.version || DEFAULT_APP_INFO.version,
    }
    this.showAtStartup = this.preferenceService.get<boolean>(
      ROCKIT_SPLASH_SHOW_AT_STARTUP,
      true,
    )

    if (this.showAtStartup) {
      setTimeout(() => {
        void this.openSplash()
      }, 0)
    }
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(ABOUT_ROCKIT_COMMAND, {
      execute: () => this.openSplash(),
    })
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.HELP, {
      commandId: ABOUT_ROCKIT_COMMAND.id,
      label: ABOUT_ROCKIT_COMMAND.label,
      order: '9a',
    })
  }

  protected async openSplash(): Promise<void> {
    const dialog = new RockitSplashDialog({
      appInfo: this.appInfo,
      showAtStartup: this.showAtStartup,
      onShowAtStartupChanged: (value) => {
        this.showAtStartup = value
        void this.preferenceService.set(
          ROCKIT_SPLASH_SHOW_AT_STARTUP,
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

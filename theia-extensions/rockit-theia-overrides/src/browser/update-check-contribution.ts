// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import {
  CommonMenus,
  FrontendApplicationContribution,
  OpenerService,
  open,
} from '@theia/core/lib/browser'
import {
  Command,
  CommandContribution,
  CommandRegistry,
  environment,
  MenuContribution,
  MenuModelRegistry,
  nls,
  PreferenceScope,
  PreferenceService,
} from '@theia/core/lib/common'
import { ApplicationServer } from '@theia/core/lib/common/application-protocol'
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables'
import URI from '@theia/core/lib/common/uri'
import { inject, injectable } from '@theia/core/shared/inversify'
import { RequestContext, RequestService } from '@theia/request'
import { ROCKIT_UPDATE_NOTIFY_AT_STARTUP } from '../common/rockit-preferences'
import { isNewerVersion, normalizeVersion } from '../common/version-comparison'
import { UpdateCheckDialog, UpdateCheckDialogState } from './update-check-dialog'

const LATEST_RELEASE_API_URL =
  'https://api.github.com/repos/dsd-sztaki-hu/RocKIT/releases/latest'
const RELEASES_PAGE_URL = 'https://github.com/dsd-sztaki-hu/RocKIT/releases'
const DEVELOPMENT_VERSION_OVERRIDE = 'ROCKIT_UPDATE_CURRENT_VERSION'
const STARTUP_CHECK_DELAY_MS = 3000

interface GitHubReleaseResponse {
  tag_name?: unknown
}

interface UpdateCheckResult {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
}

export const CHECK_FOR_UPDATES_COMMAND: Command = {
  id: 'rockit.checkForUpdates',
  label: nls.localize('rockit/updates/check', 'Check for Updates...'),
}

@injectable()
export class UpdateCheckContribution
  implements FrontendApplicationContribution, CommandContribution, MenuContribution
{
  @inject(ApplicationServer)
  protected readonly applicationServer: ApplicationServer

  @inject(EnvVariablesServer)
  protected readonly envVariablesServer: EnvVariablesServer

  @inject(OpenerService)
  protected readonly openerService: OpenerService

  @inject(PreferenceService)
  protected readonly preferenceService: PreferenceService

  @inject(RequestService)
  protected readonly requestService: RequestService

  protected activeCheck: Promise<UpdateCheckResult> | undefined
  protected activeDialog: UpdateCheckDialog | undefined
  protected notifyAtStartup = true

  onStart(): void {
    if (!environment.electron.is()) {
      return
    }

    this.notifyAtStartup = this.preferenceService.get<boolean>(
      ROCKIT_UPDATE_NOTIFY_AT_STARTUP,
      true,
    )
    if (this.notifyAtStartup) {
      setTimeout(() => {
        void this.runStartupCheck()
      }, STARTUP_CHECK_DELAY_MS)
    }
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(CHECK_FOR_UPDATES_COMMAND, {
      execute: () => this.openManualCheck(),
      isEnabled: () => environment.electron.is(),
      isVisible: () => environment.electron.is(),
    })
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.HELP, {
      commandId: CHECK_FOR_UPDATES_COMMAND.id,
      label: CHECK_FOR_UPDATES_COMMAND.label,
      order: '8a',
    })
  }

  protected async runStartupCheck(): Promise<void> {
    try {
      const result = await this.checkForUpdates()
      if (result.updateAvailable) {
        this.showDialog(this.toDialogState(result))
      }
    } catch {
      // Automatic update checks remain silent when GitHub is unavailable.
    }
  }

  protected openManualCheck(): void {
    if (this.activeDialog && !this.activeDialog.isDisposed) {
      this.activeDialog.activate()
      return
    }

    const dialog = this.showDialog({ status: 'checking' })
    void this.populateManualDialog(dialog)
  }

  protected async populateManualDialog(dialog: UpdateCheckDialog): Promise<void> {
    try {
      const result = await this.checkForUpdates()
      if (!dialog.isDisposed) {
        dialog.setState(this.toDialogState(result), !this.notifyAtStartup)
      }
    } catch (error) {
      if (!dialog.isDisposed) {
        dialog.setState({
          status: 'error',
          detail: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  protected checkForUpdates(): Promise<UpdateCheckResult> {
    if (this.activeCheck) {
      return this.activeCheck
    }

    this.activeCheck = this.doCheckForUpdates().finally(() => {
      this.activeCheck = undefined
    })
    return this.activeCheck
  }

  protected async doCheckForUpdates(): Promise<UpdateCheckResult> {
    const [appInfo, applicationRoot, versionOverride] = await Promise.all([
      this.applicationServer.getApplicationInfo(),
      this.applicationServer.getApplicationRoot(),
      this.envVariablesServer.getValue(DEVELOPMENT_VERSION_OVERRIDE),
    ])

    if (!appInfo?.version) {
      throw new Error('The running application did not report a version.')
    }

    const isPackaged = /(?:^|[\\/])[^\\/]+\.asar(?:[\\/]|$)/i.test(applicationRoot)
    const configuredOverride = versionOverride?.value?.trim()
    const currentVersion = normalizeVersion(
      !isPackaged && configuredOverride ? configuredOverride : appInfo.version,
    )
    const response = await this.requestService.request({
      url: LATEST_RELEASE_API_URL,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'RocKIT',
      },
      timeout: 10000,
      followRedirects: 3,
    })
    const release = RequestContext.asJson<GitHubReleaseResponse>(response)
    if (typeof release.tag_name !== 'string') {
      throw new Error('The GitHub release response did not contain a version tag.')
    }

    const latestVersion = normalizeVersion(release.tag_name)
    return {
      currentVersion,
      latestVersion,
      updateAvailable: isNewerVersion(latestVersion, currentVersion),
    }
  }

  protected toDialogState(result: UpdateCheckResult): UpdateCheckDialogState {
    return result.updateAvailable
      ? {
          status: 'update-available',
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
        }
      : {
          status: 'up-to-date',
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
        }
  }

  protected showDialog(state: UpdateCheckDialogState): UpdateCheckDialog {
    if (this.activeDialog && !this.activeDialog.isDisposed) {
      this.activeDialog.setState(state, !this.notifyAtStartup)
      this.activeDialog.activate()
      return this.activeDialog
    }

    const dialog = new UpdateCheckDialog({
      state,
      doNotRemind: !this.notifyAtStartup,
      onDoNotRemindChanged: (value) => {
        this.notifyAtStartup = !value
        void this.preferenceService.set(
          ROCKIT_UPDATE_NOTIFY_AT_STARTUP,
          this.notifyAtStartup,
          PreferenceScope.User,
        )
      },
      onOpenReleasePage: () => {
        void open(this.openerService, new URI(RELEASES_PAGE_URL), {
          openExternalApp: true,
        })
      },
    })
    this.activeDialog = dialog
    void dialog.open().finally(() => {
      if (this.activeDialog === dialog) {
        this.activeDialog = undefined
      }
    })
    return dialog
  }
}

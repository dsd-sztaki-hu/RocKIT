// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import type {
  CommandContribution,
  MenuContribution,
  MenuModelRegistry,
} from '@theia/core'
import { CommonMenus } from '@theia/core/lib/browser'
import { OpenerService } from '@theia/core/lib/browser'
import { ApplicationServer } from '@theia/core/lib/common/application-protocol'
import type { Command, CommandRegistry } from '@theia/core/lib/common/command'
import { inject, injectable } from '@theia/core/shared/inversify'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { openRockitDocumentationPage, ROCKIT_DOCUMENTATION_PAGES } from 'rockit-common/lib/browser'
import { ROCratePreviewDialog } from './ro-crate-preview-dialog'

export const RoCratePreviewCommand: Command = { id: 'RO-Crate Preview' }

@injectable()
export class RoCratePreviewContribution implements CommandContribution, MenuContribution {
  @inject(AppStateService)
  protected readonly appStateService!: AppStateService
  @inject(ApplicationServer)
  protected readonly applicationServer!: ApplicationServer
  @inject(OpenerService)
  protected readonly openerService!: OpenerService

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(RoCratePreviewCommand, {
      execute: async () => {
        const dialog = new ROCratePreviewDialog(this.appStateService, () => {
          void openRockitDocumentationPage(
            this.applicationServer,
            this.openerService,
            ROCKIT_DOCUMENTATION_PAGES.PREVIEW,
          )
        })
        await dialog.open()
      },
    })
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.FILE, {
      commandId: RoCratePreviewCommand.id,
      label: RoCratePreviewCommand.label,
    })
  }
}

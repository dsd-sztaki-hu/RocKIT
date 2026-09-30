// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify'
import { nls } from '@theia/core/lib/common/nls'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateHistoryService } from 'app-state/lib/browser/state/ro-crate-history-service'
import {
    MetadataProfileManager as MetadataProfileManagerToken,
    type MetadataProfileManager,
} from 'rockit-common/lib/browser'
import { LoadMaskService } from 'rockit-loadmask/lib/browser/loadmask-service'
import { MultiEditDialog } from './multi-edit-dialog'

@injectable()
export class MultiEditDialogService {
    @inject(AppStateService)
    protected readonly appStateService!: AppStateService

    @inject(RoCrateHistoryService)
    protected readonly roCrateHistoryService!: RoCrateHistoryService

    @inject(MetadataProfileManagerToken)
    @optional()
    protected readonly profileManagerService?: MetadataProfileManager

    @inject(LoadMaskService)
    protected readonly loadMaskService!: LoadMaskService

    async open(entityIds: string[]): Promise<void> {
        const isLargeSelection = entityIds.length >= 1_000
        const loadMask = this.loadMaskService.show({
            message: nls.localize('rockit/multiEdit/preparing', 'Preparing multi-edit...'),
            delay: isLargeSelection ? 0 : undefined,
        })

        let dialogResult: Promise<unknown> | undefined

        try {
            if (isLargeSelection) {
                await this.waitForLoadMaskPaint()
            }

            const dialog = new MultiEditDialog(
                entityIds,
                this.appStateService,
                this.profileManagerService,
                this.roCrateHistoryService,
                this.loadMaskService,
            )

            await dialog.prepare((worked, total) => {
                loadMask.update({ progress: { worked, total } })
            })

            dialogResult = dialog.open()
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
        } finally {
            loadMask.dispose()
        }

        await dialogResult
    }

    protected async waitForLoadMaskPaint(): Promise<void> {
        await new Promise<void>((resolve) => {
            let settled = false

            const finish = () => {
                if (settled) {
                    return
                }

                settled = true
                resolve()
            }

            setTimeout(finish, 50)
            requestAnimationFrame(() => requestAnimationFrame(finish))
        })
    }
}

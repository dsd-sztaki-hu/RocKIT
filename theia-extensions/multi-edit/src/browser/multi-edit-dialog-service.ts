import { inject, injectable } from '@theia/core/shared/inversify'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateHistoryService } from 'app-state/lib/browser/state/ro-crate-history-service'
import type { MetadataSchemaManager } from 'rockit-common/lib/browser'
import { LoadMaskService } from 'rockit-loadmask/lib/browser/loadmask-service'
import { MultiEditDialog } from './multi-edit-dialog'

@injectable()
export class MultiEditDialogService {
  @inject(AppStateService)
  protected readonly appStateService!: AppStateService

  @inject(RoCrateHistoryService)
  protected readonly roCrateHistoryService!: RoCrateHistoryService

  @inject(LoadMaskService)
  protected readonly loadMaskService!: LoadMaskService

  async open(
    entityIds: string[],
    schemaManagerService?: MetadataSchemaManager,
  ): Promise<void> {
    const isLargeSelection = entityIds.length >= 1_000
    const loadMask = this.loadMaskService.show({
      message: 'Preparing multi-edit...',
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
        schemaManagerService,
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

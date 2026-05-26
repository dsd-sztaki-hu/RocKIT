import { injectable, inject } from '@theia/core/shared/inversify'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateHistoryService } from 'app-state/lib/browser/state/ro-crate-history-service'
import type { MetadataSchemaManager } from 'aroma2-common/lib/browser'
import { MultiEditDialog } from './multi-edit-dialog'

@injectable()
export class MultiEditDialogService {
  @inject(AppStateService)
  protected readonly appStateService!: AppStateService

  @inject(RoCrateHistoryService)
  protected readonly roCrateHistoryService!: RoCrateHistoryService

  async open(
    entityIds: string[],
    schemaManagerService?: MetadataSchemaManager,
  ): Promise<void> {
    const dialog = new MultiEditDialog(
      entityIds,
      this.appStateService,
      schemaManagerService,
      this.roCrateHistoryService,
    )
    await dialog.open()
  }
}

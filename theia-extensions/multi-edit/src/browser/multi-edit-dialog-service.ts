import { injectable, inject, optional } from '@theia/core/shared/inversify'
import { AppStateService } from 'app-state/lib/browser/state/app-state-service'
import { RoCrateHistoryService } from 'app-state/lib/browser/state/ro-crate-history-service'
import {
  MetadataSchemaManager as MetadataSchemaManagerToken,
  type MetadataSchemaManager,
} from 'rockit-common/lib/browser'
import { MultiEditDialog } from './multi-edit-dialog'

@injectable()
export class MultiEditDialogService {
  @inject(AppStateService)
  protected readonly appStateService!: AppStateService

  @inject(RoCrateHistoryService)
  protected readonly roCrateHistoryService!: RoCrateHistoryService

  @inject(MetadataSchemaManagerToken) @optional()
  protected readonly schemaManagerService?: MetadataSchemaManager

  async open(entityIds: string[]): Promise<void> {
    const dialog = new MultiEditDialog(
      entityIds,
      this.appStateService,
      this.schemaManagerService,
      this.roCrateHistoryService,
    )
    await dialog.open()
  }
}

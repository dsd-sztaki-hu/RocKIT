import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import * as React from '@theia/core/shared/react'

export class MultiEditDialog extends ReactDialog<void> {
  constructor(private readonly entityIds: string[]) {
    super({ title: 'Multi Edit' })
    this.appendCloseButton('Close')
  }

  protected render(): React.ReactNode {
    return (
      <div className="entities-overview-edit-modal-body">
        <p className="entities-overview-edit-modal-title">
          {this.entityIds.length} entities selected
        </p>
        {this.entityIds.length === 0 ? (
          <p className="entities-overview-edit-modal-empty">No entities available.</p>
        ) : (
          <ul className="entities-overview-edit-modal-list">
            {this.entityIds.map((entityId) => (
              <li key={entityId}>{entityId}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  get value(): void {
    return undefined
  }
}

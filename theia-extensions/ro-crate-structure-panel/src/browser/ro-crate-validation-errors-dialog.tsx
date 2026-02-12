import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import * as React from 'react'

type ValidationError = {
  entityId?: string
  entityType?: string
  fieldLabel?: string
  error?: string
}

export class RoCrateValidationErrorsDialog extends ReactDialog<string> {
  constructor(
    private readonly errors: ValidationError[],
    private readonly onSelectEntity: (entityId: string) => void,
  ) {
    super({ title: 'Errors in RO-Crate' })
    this.appendCloseButton('Close')
  }

  protected render(): React.ReactNode {
    return (
      <div className="ro-crate-validation-dialog-body">
        {this.errors.length === 0 ? (
          <p className="ro-crate-validation-dialog-empty">No validation errors.</p>
        ) : (
          <div className="ro-crate-validation-dialog-list">
            {this.errors.map((error, index) => {
              const entityType = error.entityType ?? 'Unknown'
              const entityId = error.entityId ?? 'Unknown'
              const message = error.error ?? 'Unknown error'
              const fieldLabel = error.fieldLabel ?? 'Unknown field'
              const canOpen = Boolean(error.entityId)
              return (
                <button
                  key={`${entityType}:${entityId}:${index}`}
                  className="ro-crate-validation-dialog-item"
                  type="button"
                  onClick={() => {
                    if (error.entityId) {
                      this.onSelectEntity(error.entityId)
                      this.close()
                    }
                  }}
                  disabled={!canOpen}
                >
                  <span className="ro-crate-validation-dialog-item-type">
                    {entityType}
                  </span>{' '}
                  <span className="ro-crate-validation-dialog-item-id">({entityId})</span>
                  {' - '}
                  <span className="ro-crate-validation-dialog-item-type">
                    {fieldLabel}
                  </span>
                  {': '}
                  <span className="ro-crate-validation-dialog-item-message">
                    {message}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  get value(): string {
    return ''
  }
}

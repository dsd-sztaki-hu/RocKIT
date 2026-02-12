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
    private readonly onOpenSchemaValidator: () => void,
  ) {
    super({ title: 'Errors in RO-Crate' })
    this.appendCloseButton('Close')
  }

  protected render(): React.ReactNode {
    return (
      <div className="ro-crate-validation-dialog-body">
        <div className="ro-crate-validation-dialog-info">
          <div className="ro-crate-validation-dialog-info-text">
            Open the docked version of the validation error list for easier review in case
            of higher amount of errors for more details.
          </div>
          <button
            className="ro-crate-validation-dialog-info-button"
            type="button"
            onClick={() => {
              this.onOpenSchemaValidator()
              this.close()
            }}
          >
            Open Schema Validator
          </button>
        </div>
        {this.errors.length === 0 ? (
          <p className="ro-crate-validation-dialog-empty">No validation errors.</p>
        ) : (
          <div className="ro-crate-validation-dialog-list">
            {this.errors.map((error, index) => {
              const entityType = error.entityType ?? 'Unknown'
              const entityId = error.entityId ?? 'Unknown'
              const message = error.error ?? 'Unknown error'
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
                  {' - Error: '}
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

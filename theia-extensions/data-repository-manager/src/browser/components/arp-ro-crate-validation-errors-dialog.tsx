import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import * as React from 'react'
import {
  ArpRoCrateValidationEntityError,
  ArpRoCrateValidationIssue,
} from '../services/arp-ro-crate-export-service'
import '../styles/arp-ro-crate-validation-errors-dialog.css'

export class ArpRoCrateValidationErrorsDialog extends ReactDialog<string> {
  constructor(
    private readonly errors: ArpRoCrateValidationEntityError[],
    private readonly requestUrl: string,
    private readonly payload: unknown,
  ) {
    super({ title: 'Server RO-Crate Validation Failed', maxWidth: 860 })
    this.appendCloseButton('Close')
  }

  protected render(): React.ReactNode {
    const issueCount = this.errors.reduce(
      (count, entityError) => count + entityError.errors.length,
      0,
    )

    return (
      <div className="arp-validation-dialog">
        <div className="arp-validation-dialog__summary">
          <div>
            The backend RO-Crate validation endpoint rejected the upload.
          </div>
          <div className="arp-validation-dialog__meta">
            {this.errors.length} invalid entit{this.errors.length === 1 ? 'y' : 'ies'},
            {' '}
            {issueCount} issue{issueCount === 1 ? '' : 's'}
          </div>
          <div className="arp-validation-dialog__endpoint">{this.requestUrl}</div>
        </div>

        {this.errors.length === 0 ? (
          <div className="arp-validation-dialog__empty">
            The backend did not return detailed validation errors.
          </div>
        ) : (
          <div className="arp-validation-dialog__list">
            {this.errors.map((entityError, index) => (
              <section
                className="arp-validation-dialog__entity"
                key={`${entityError.errorEntity}:${index}`}
              >
                <div className="arp-validation-dialog__entity-title">
                  {entityError.errorEntity}
                </div>
                <div className="arp-validation-dialog__issues">
                  {entityError.errors.map((issue, issueIndex) =>
                    this.renderIssue(issue, issueIndex),
                  )}
                </div>
              </section>
            ))}
          </div>
        )}

        <details className="arp-validation-dialog__raw">
          <summary>Raw API response</summary>
          <pre>{this.formatPayload(this.payload)}</pre>
        </details>
      </div>
    )
  }

  protected renderIssue(
    issue: ArpRoCrateValidationIssue,
    issueIndex: number,
  ): React.ReactNode {
    return (
      <div className="arp-validation-dialog__issue" key={issueIndex}>
        {issue.errorField && (
          <div className="arp-validation-dialog__field">{issue.errorField}</div>
        )}
        {issue.errorMessage && (
          <div className="arp-validation-dialog__message">
            {issue.errorMessage}
          </div>
        )}
        {issue.errorSuggestion && (
          <div className="arp-validation-dialog__suggestion">
            {issue.errorSuggestion}
          </div>
        )}
      </div>
    )
  }

  get value(): string {
    return ''
  }

  protected formatPayload(payload: unknown): string {
    if (typeof payload === 'string') {
      return payload
    }
    try {
      return JSON.stringify(payload, null, 2)
    } catch {
      return String(payload)
    }
  }
}

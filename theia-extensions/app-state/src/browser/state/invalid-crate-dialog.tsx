import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog'
import { injectable } from '@theia/core/shared/inversify'
import type { WorkspaceService } from '@theia/workspace/lib/browser'
import type * as React from 'react'

@injectable()
export class InvalidCrateDialog extends ReactDialog<string> {
  constructor(protected readonly workspaceService: WorkspaceService) {
    super({
      title: 'Invalid RO-Crate Metadata',
    })
    this.title.closable = false
    this.appendAcceptButton('Close Workspace')
  }

  get value(): string {
    return ''
  }

  protected render(): React.ReactNode {
    return (
      <div style={{ padding: '20px', maxWidth: '400px' }}>
        <div
          style={{
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <i
            className="fa fa-exclamation-triangle"
            style={{ color: '#d9534f', fontSize: '24px' }}
          ></i>
          <span style={{ fontWeight: 'bold', fontSize: '14px' }}>
            Critical Parsing Error
          </span>
        </div>

        <p>
          The <code>ro-crate-metadata.json</code> file in this workspace is invalid and
          cannot be parsed.
        </p>
        <p style={{ fontSize: '0.9em', color: '#888' }}>
          To prevent data corruption, editing is disabled until this is resolved.
        </p>
      </div>
    )
  }

  protected async accept(): Promise<void> {
    await this.workspaceService.close()
    await super.accept()
  }
}

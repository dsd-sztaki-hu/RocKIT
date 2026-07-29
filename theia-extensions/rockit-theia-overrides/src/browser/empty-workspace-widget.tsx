import { codicon, OpenerService } from '@theia/core/lib/browser'
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { ApplicationServer } from '@theia/core/lib/common/application-protocol'
import { CommandService } from '@theia/core/lib/common/command'
import { nls } from '@theia/core/lib/common'
import { inject, injectable } from '@theia/core/shared/inversify'
import { WorkspaceCommands } from '@theia/workspace/lib/browser'
import * as React from 'react'
import {
  buildDocumentationUrl,
  openRockitDocumentationPage,
  ROCKIT_DOCUMENTATION_PAGES,
} from 'rockit-common/lib/browser'

const IMPORT_FROM_REMOTE_COMMAND_ID = 'data-repository-manager:import-from-remote'

@injectable()
export class EmptyWorkspaceWidget extends ReactWidget {
  static readonly ID = 'rockit-empty-workspace'
  static readonly LABEL = nls.localize('rockit/welcome/label', 'Welcome')

  @inject(CommandService)
  protected readonly commandService: CommandService

  @inject(ApplicationServer)
  protected readonly applicationServer: ApplicationServer

  @inject(OpenerService)
  protected readonly openerService: OpenerService

  protected quickstartUrl = buildDocumentationUrl(
    'latest',
    ROCKIT_DOCUMENTATION_PAGES.QUICK_START_OPEN_AND_EDIT,
  )

  constructor() {
    super()
    this.id = EmptyWorkspaceWidget.ID
    this.title.label = EmptyWorkspaceWidget.LABEL
    this.title.caption = EmptyWorkspaceWidget.LABEL
    this.title.closable = false
    this.addClass('rockit-empty-workspace-widget')
    this.update()
  }

  async initialize(): Promise<void> {
    const appInfo = await this.applicationServer.getApplicationInfo()
    this.quickstartUrl = buildDocumentationUrl(
      appInfo?.version ?? 'latest',
      ROCKIT_DOCUMENTATION_PAGES.QUICK_START_OPEN_AND_EDIT,
    )
    this.update()
  }

  protected executeCommand(commandId: string): void {
    void this.commandService.executeCommand(commandId)
  }

  protected openQuickstart(event: React.MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault()
    void openRockitDocumentationPage(
      this.applicationServer,
      this.openerService,
      ROCKIT_DOCUMENTATION_PAGES.QUICK_START_OPEN_AND_EDIT,
    )
  }

  protected render(): React.ReactNode {
    return (
      <main className="rockit-empty-workspace" aria-labelledby="rockit-welcome-heading">
        <div className="rockit-empty-workspace-content">
          <h1 id="rockit-welcome-heading">
            {nls.localize(
              'rockit/welcome/title',
              'Welcome to the RocKIT RO-Crate Editor',
            )}
          </h1>
          <p>
            {nls.localize(
              'rockit/welcome/emptyPrefix',
              'Your workspace is empty. To open or create a new RO-Crate, see our quickstart',
            )}{' '}
            <a href={this.quickstartUrl} onClick={(event) => this.openQuickstart(event)}>
              {nls.localize('rockit/welcome/documentation', 'documentation')}
            </a>
            .
          </p>

          <ul className="rockit-empty-workspace-actions">
            <li>
              <button
                type="button"
                onClick={() => this.executeCommand(WorkspaceCommands.OPEN_FOLDER.id)}
              >
                <span className={codicon('folder-opened')} aria-hidden="true" />
                <span>{nls.localize('rockit/file/openFolder', 'Open Folder as RO-Crate')}</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() =>
                  this.executeCommand(WorkspaceCommands.OPEN_RECENT_WORKSPACE.id)
                }
              >
                <span className={codicon('history')} aria-hidden="true" />
                <span>{nls.localize('rockit/file/openRecent', 'Open Recent RO-Crate')}</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => this.executeCommand(IMPORT_FROM_REMOTE_COMMAND_ID)}
              >
                <span className={codicon('cloud-download')} aria-hidden="true" />
                <span>
                  {nls.localize(
                    'rockit/welcome/importRemote',
                    'Import from Remote Repository',
                  )}
                </span>
              </button>
            </li>
          </ul>
        </div>
      </main>
    )
  }
}

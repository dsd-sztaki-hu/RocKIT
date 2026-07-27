import {
  ConnectionStatus,
  ConnectionStatusService,
} from '@theia/core/lib/browser/connection-status-service'
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution'
import { Disposable } from '@theia/core/lib/common/disposable'
import { MessageService } from '@theia/core/lib/common/message-service'
import { nls } from '@theia/core/lib/common'
import { inject, injectable } from '@theia/core/shared/inversify'

@injectable()
export class ConnectionNotificationContribution implements FrontendApplicationContribution {
  @inject(ConnectionStatusService)
  protected readonly connectionStatusService: ConnectionStatusService

  @inject(MessageService)
  protected readonly messageService: MessageService

  protected statusListener: Disposable | undefined
  protected wasOffline = false

  onStart(): void {
    this.wasOffline =
      this.connectionStatusService.currentStatus === ConnectionStatus.OFFLINE
    this.statusListener = this.connectionStatusService.onStatusChange((status) =>
      this.handleStatusChange(status),
    )

    if (this.wasOffline) {
      this.showDisconnectedMessage()
    }
  }

  onStop(): void {
    this.statusListener?.dispose()
    this.statusListener = undefined
  }

  protected handleStatusChange(status: ConnectionStatus): void {
    if (status === ConnectionStatus.OFFLINE) {
      this.wasOffline = true
      this.showDisconnectedMessage()
      return
    }

    if (this.wasOffline) {
      this.wasOffline = false
      void this.messageService.info(
        nls.localize(
          'rockit/connection/restored',
          'Connection to the application backend was restored.',
        ),
        { timeout: 8000 },
      )
    }
  }

  protected showDisconnectedMessage(): void {
    void this.messageService.error(
      nls.localize(
        'rockit/connection/lost',
        'Connection to the application backend was lost. Some actions will be unavailable until it reconnects.',
      ),
      { timeout: 15000 },
    )
  }
}

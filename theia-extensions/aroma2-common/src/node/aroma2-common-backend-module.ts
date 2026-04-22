import { ContainerModule } from 'inversify'
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging'
import { BackendApplicationContribution } from '@theia/core/lib/node'
import { SecureStorageService, SECURE_STORAGE_PATH } from '../common/secure-storage-protocol'
import { RocrateMcpDaemonManager } from './rocrate-mcp-daemon-manager'
import { SecureStorageServiceImpl } from './secure-storage-service-impl'

export default new ContainerModule((bind) => {
  bind(SecureStorageService).to(SecureStorageServiceImpl).inSingletonScope()
  bind(SecureStorageServiceImpl).toSelf().inSingletonScope()
  bind(RocrateMcpDaemonManager).toSelf().inSingletonScope()
  bind(BackendApplicationContribution).toService(RocrateMcpDaemonManager)

  bind(ConnectionHandler)
    .toDynamicValue((ctx) =>
      new JsonRpcConnectionHandler(SECURE_STORAGE_PATH, () => ctx.container.get(SecureStorageService)),
    )
    .inSingletonScope()
})

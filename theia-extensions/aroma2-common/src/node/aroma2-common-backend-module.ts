import { ContainerModule } from 'inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { SecureStorageService, SECURE_STORAGE_PATH } from '../common/secure-storage-protocol';
import { SecureStorageServiceImpl } from './secure-storage-service-impl';

export default new ContainerModule(bind => {
    bind(SecureStorageService).to(SecureStorageServiceImpl).inSingletonScope();
    bind(SecureStorageServiceImpl).toSelf().inSingletonScope();
    
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new JsonRpcConnectionHandler(SECURE_STORAGE_PATH, client => {
            return ctx.container.get(SecureStorageService);
        })
    ).inSingletonScope();
});
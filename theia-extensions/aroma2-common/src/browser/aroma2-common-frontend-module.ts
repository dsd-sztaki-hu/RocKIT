import { ContainerModule } from 'inversify';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { SecureStorageService, SECURE_STORAGE_PATH } from '../common/secure-storage-protocol';

export default new ContainerModule(bind => {
    bind(SecureStorageService).toDynamicValue(ctx => {
        const connectionProvider = ctx.container.get(WebSocketConnectionProvider);
        return connectionProvider.createProxy<SecureStorageService>(SECURE_STORAGE_PATH);
    }).inSingletonScope();
});
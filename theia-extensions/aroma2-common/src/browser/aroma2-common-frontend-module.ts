import { ContainerModule } from 'inversify';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { APPLICATION_RESET_PATH, ApplicationResetService } from '../common/application-reset-protocol';
import { SecureStorageService, SECURE_STORAGE_PATH } from '../common/secure-storage-protocol';

export default new ContainerModule(bind => {
    bind(ApplicationResetService).toDynamicValue(ctx => {
        const connectionProvider = ctx.container.get(WebSocketConnectionProvider);
        return connectionProvider.createProxy<ApplicationResetService>(APPLICATION_RESET_PATH);
    }).inSingletonScope();

    bind(SecureStorageService).toDynamicValue(ctx => {
        const connectionProvider = ctx.container.get(WebSocketConnectionProvider);
        return connectionProvider.createProxy<SecureStorageService>(SECURE_STORAGE_PATH);
    }).inSingletonScope();
});

import { ContainerModule } from 'inversify';
import { CommandContribution } from '@theia/core/lib/common/command';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { SecureStorageService, SECURE_STORAGE_PATH } from '../common/secure-storage-protocol';
import {
    RoCrateEntityDeleteCommandContribution,
    RoCrateEntityDeleteService,
} from './ro-crate-entity-delete-service';

export default new ContainerModule(bind => {
    bind(RoCrateEntityDeleteService).toSelf().inSingletonScope();
    bind(CommandContribution).to(RoCrateEntityDeleteCommandContribution).inSingletonScope();

    bind(SecureStorageService).toDynamicValue(ctx => {
        const connectionProvider = ctx.container.get(WebSocketConnectionProvider);
        return connectionProvider.createProxy<SecureStorageService>(SECURE_STORAGE_PATH);
    }).inSingletonScope();
});

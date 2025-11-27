import 'reflect-metadata';
import { Container } from 'inversify';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { AppStateService } from '../src/browser/state/app-state-service';
import { AppState } from '../src/browser/state/app-state';

/**
 * Very small fake StorageService to test persistence wiring.
 */
class InMemoryStorageService implements StorageService {
    private store = new Map<string, any>();

    async getData<T>(key: string): Promise<T | undefined> {
        return this.store.get(key);
    }

    async setData<T>(key: string, data: T): Promise<void> {
        this.store.set(key, data);
    }
}

describe('AppStateService', () => {
    it('can update and read state', async () => {
        const container = new Container();
        container.bind(StorageService).to(InMemoryStorageService).inSingletonScope();
        container.bind(AppStateService).toSelf().inSingletonScope();

        const service = container.get(AppStateService);
        await (service as any).init(); // manually call @postConstruct

        expect(service.dirty).toBe(false);
        service.dirty = true;
        expect(service.dirty).toBe(true);
    });

    it('persists state via StorageService', async () => {
        const container = new Container();
        container.bind(StorageService).to(InMemoryStorageService).inSingletonScope();
        container.bind(AppStateService).toSelf().inSingletonScope();

        const service1 = container.get(AppStateService);
        await (service1 as any).init();
        service1.updateState({ theme: 'dark', notifications: ['hello'] });

        const storage = container.get<InMemoryStorageService>(StorageService as any);
        const stored = await storage.getData<AppState>('theia-app-state-extension:app-state');
        expect(stored?.theme).toBe('dark');

        // simulate new instance restoring from storage
        const container2 = new Container();
        container2.bind(StorageService).toConstantValue(storage);
        container2.bind(AppStateService).toSelf().inSingletonScope();

        const service2 = container2.get(AppStateService);
        await (service2 as any).init();
        expect(service2.theme).toBe('dark');
        expect(service2.getState().notifications).toEqual(['hello']);
    });
});

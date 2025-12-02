import { SimpleStateStore } from '../src/browser/state/state-store';

interface TestState {
    count: number;
    label: string;
}

describe('SimpleStateStore', () => {
    it('initializes with given state', () => {
        const store = new SimpleStateStore<TestState>({ count: 1, label: 'a' });
        expect(store.getState()).toEqual({ count: 1, label: 'a' });
    });

    it('updates state with partial', () => {
        const store = new SimpleStateStore<TestState>({ count: 1, label: 'a' });
        store.updateState({ count: 2 });
        expect(store.getState()).toEqual({ count: 2, label: 'a' });
    });

    it('emits change events', () => {
        const store = new SimpleStateStore<TestState>({ count: 1, label: 'a' });
        let changes = 0;
        store.onDidChangeState(() => { changes++; });
        store.updateState({ count: 2 });
        expect(changes).toBe(1);
    });

    it('supports selector-based events', () => {
        const store = new SimpleStateStore<TestState>({ count: 1, label: 'a' });
        const values: number[] = [];
        const event = store.onDidChangeSelector(s => s.count);
        event(v => values.push(v));
        store.updateState({ count: 2 });
        store.updateState({ label: 'b' }); // should not trigger
        store.updateState({ count: 3 });
        expect(values).toEqual([1, 2, 3]);
    });
});

/// <reference types="jest" />
import { createPersistCoordinator } from '@/database/persistCoordinator';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('persist coordinator', () => {
  it('persists a single write', async () => {
    let state = { a: 'A' };
    let durable = '';
    const coordinator = createPersistCoordinator({
      serialize: () => JSON.stringify(state),
      write: async (serialized) => {
        durable = serialized;
      },
    });
    coordinator.requestPersist();
    await coordinator.flush();
    expect(JSON.parse(durable)).toEqual({ a: 'A' });
    expect(coordinator.stats().physicalWrites).toBe(1);
  });

  it('coalesces rapid writes to the latest snapshot', async () => {
    let state = { value: 'A' };
    const durable: string[] = [];
    const started = deferred();
    const first = deferred();
    let writes = 0;
    const coordinator = createPersistCoordinator({
      serialize: () => JSON.stringify(state),
      write: async (serialized) => {
        writes += 1;
        if (writes === 1) started.resolve();
        if (writes === 1) await first.promise;
        durable.push(serialized);
      },
    });
    coordinator.requestPersist();
    await started.promise;
    state = { value: 'B' };
    coordinator.requestPersist();
    state = { value: 'C' };
    coordinator.requestPersist();
    first.resolve();
    await coordinator.flush();
    expect(JSON.parse(durable[durable.length - 1] ?? '{}')).toEqual({ value: 'C' });
    expect(coordinator.stats().physicalWrites).toBeLessThan(coordinator.stats().persistRequests);
    expect(coordinator.stats().persistRequests).toBe(3);
  });

  it('queues the latest state while a write is active', async () => {
    let state = { value: 'A' };
    let durable = '';
    const started = deferred();
    const first = deferred();
    const coordinator = createPersistCoordinator({
      serialize: () => JSON.stringify(state),
      write: async (serialized) => {
        if (durable === '') {
          started.resolve();
          await first.promise;
        }
        durable = serialized;
      },
    });
    coordinator.requestPersist();
    await started.promise;
    state = { value: 'B' };
    coordinator.requestPersist();
    state = { value: 'C' };
    coordinator.requestPersist();
    first.resolve();
    await coordinator.flush();
    expect(JSON.parse(durable)).toEqual({ value: 'C' });
  });

  it('unlocks after a write failure so a later write can persist', async () => {
    let state = { value: 'A' };
    let durable = '';
    let shouldFail = true;
    const coordinator = createPersistCoordinator({
      serialize: () => JSON.stringify(state),
      write: async (serialized) => {
        if (shouldFail) throw new Error('disk full');
        durable = serialized;
      },
    });
    coordinator.requestPersist();
    await expect(coordinator.flush()).rejects.toThrow('disk full');
    expect(coordinator.isWriting()).toBe(false);
    shouldFail = false;
    state = { value: 'B' };
    coordinator.requestPersist();
    await coordinator.flush();
    expect(JSON.parse(durable)).toEqual({ value: 'B' });
  });

  it('flush waits until the latest requested state is durable', async () => {
    let state = { value: 'A' };
    let durable = '';
    const first = deferred();
    const coordinator = createPersistCoordinator({
      serialize: () => JSON.stringify(state),
      write: async (serialized) => {
        if (!durable) await first.promise;
        durable = serialized;
      },
    });
    coordinator.requestPersist();
    state = { value: 'B' };
    coordinator.requestPersist();
    const flushed = coordinator.flush();
    first.resolve();
    await flushed;
    expect(JSON.parse(durable)).toEqual({ value: 'B' });
  });

  it('prevents a stale in-flight write from replacing a newer generation', async () => {
    let state = { value: 'old' };
    let durable = '';
    const started = deferred();
    const first = deferred();
    const coordinator = createPersistCoordinator({
      serialize: () => JSON.stringify(state),
      write: async (serialized, generation) => {
        if (durable === '') {
          started.resolve();
          await first.promise;
        }
        if (coordinator.generation() !== generation) return;
        durable = serialized;
      },
    });
    coordinator.requestPersist();
    await started.promise;
    coordinator.invalidate();
    state = { value: 'new' };
    coordinator.requestPersist();
    first.resolve();
    await coordinator.flush();
    expect(JSON.parse(durable)).toEqual({ value: 'new' });
  });

  it('never runs more than one filesystem write at a time', async () => {
    let state = { value: 0 };
    let active = 0;
    let maxActive = 0;
    const coordinator = createPersistCoordinator({
      serialize: () => JSON.stringify(state),
      write: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
      },
    });
    for (let index = 0; index < 20; index += 1) {
      state = { value: index };
      coordinator.requestPersist();
    }
    await coordinator.flush();
    expect(maxActive).toBe(1);
    expect(coordinator.stats().maxConcurrentWrites).toBe(1);
  });

  it('propagates serialization failure and recovers for a later write', async () => {
    let state: Record<string, string> | null = { value: 'bad' };
    let durable = '';
    const coordinator = createPersistCoordinator({
      serialize: () => {
        if (!state) throw new Error('cannot serialize');
        return JSON.stringify(state);
      },
      write: async (serialized) => {
        durable = serialized;
      },
    });
    const broken = state;
    state = null;
    coordinator.requestPersist();
    await expect(coordinator.flush()).rejects.toThrow('cannot serialize');
    expect(coordinator.isWriting()).toBe(false);
    state = { ...broken, value: 'good' };
    coordinator.requestPersist();
    await coordinator.flush();
    expect(JSON.parse(durable)).toEqual({ value: 'good' });
  });

  it('reduces physical writes for a large synthetic snapshot under burst updates', async () => {
    const snapshot: Record<string, string> = {};
    for (let index = 0; index < 400; index += 1) {
      snapshot[`tx-${index}`] = JSON.stringify({ id: index, amount: index * 100 });
    }
    snapshot.accounts = JSON.stringify([{ id: 'bank' }, { id: 'card' }]);
    snapshot.categories = JSON.stringify([{ id: 'food' }]);
    snapshot.budgets = JSON.stringify([]);
    snapshot.recurring = JSON.stringify([]);
    snapshot.investments = JSON.stringify([]);
    snapshot.syncQueue = JSON.stringify([]);
    snapshot.syncState = JSON.stringify({ status: 'idle' });

    let durable = '';
    const started = deferred();
    const first = deferred();
    const coordinator = createPersistCoordinator({
      serialize: () => JSON.stringify(snapshot),
      write: async (serialized) => {
        if (!durable) {
          started.resolve();
          await first.promise;
        }
        durable = serialized;
      },
    });

    coordinator.requestPersist();
    await started.promise;
    for (let index = 0; index < 99; index += 1) {
      snapshot[`tx-${index}`] = JSON.stringify({ id: index, amount: index * 200 });
      coordinator.requestPersist();
    }
    first.resolve();
    await coordinator.flush();

    expect(coordinator.stats().persistRequests).toBe(100);
    expect(coordinator.stats().physicalWrites).toBeLessThanOrEqual(2);
    expect(coordinator.stats().maxConcurrentWrites).toBe(1);
    expect(JSON.parse(durable)['tx-1']).toContain('200');
  });
});

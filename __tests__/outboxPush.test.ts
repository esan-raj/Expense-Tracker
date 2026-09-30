/// <reference types="jest" />

const enqueue = jest.fn(async (..._args: unknown[]) => undefined);
const currentUser = jest.fn((): string | null => 'u1');

jest.mock('@/database/repositories/syncQueueRepository', () => ({
  syncQueueRepository: { enqueue: (...args: unknown[]) => enqueue(...args) },
}));

jest.mock('@/database/session', () => ({
  getCurrentUserId: () => currentUser(),
}));

jest.mock('@/services/financeRevision', () => ({
  bumpFinanceRevision: jest.fn(),
}));

import { LOCAL_CHANGE_PUSH_DELAY_MS, queueChange, setLocalChangeHandler } from '@/services/outbox';
import { syncGate } from '@/services/syncSingleFlight';

describe('outbox push after local change', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    currentUser.mockReturnValue('u1');
    syncGate.reset();
  });

  afterEach(() => {
    setLocalChangeHandler(null);
    syncGate.reset();
    jest.useRealTimers();
  });

  it('pushes shortly after a delete when no sync is running', async () => {
    const handler = jest.fn();
    setLocalChangeHandler(handler);

    await queueChange('transaction', 't1', 'delete', { id: 't1', deletedAt: '2026-09-30T00:00:00.000Z' });
    expect(handler).not.toHaveBeenCalled();

    jest.advanceTimersByTime(LOCAL_CHANGE_PUSH_DELAY_MS);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('batches a burst of writes into one push', async () => {
    const handler = jest.fn();
    setLocalChangeHandler(handler);

    await queueChange('transaction', 'src', 'create', { id: 'src' });
    await queueChange('transaction', 'dst', 'create', { id: 'dst' });
    jest.advanceTimersByTime(LOCAL_CHANGE_PUSH_DELAY_MS);

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('asks the running sync for a follow-up instead of scheduling another', async () => {
    const handler = jest.fn();
    setLocalChangeHandler(handler);
    let release!: () => void;
    const execute = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );

    const running = syncGate.run('full', execute);
    await queueChange('transaction', 't1', 'update', { id: 't1' });
    jest.advanceTimersByTime(LOCAL_CHANGE_PUSH_DELAY_MS);
    expect(handler).not.toHaveBeenCalled();

    release();
    for (let i = 0; i < 10 && execute.mock.calls.length < 2; i += 1) await Promise.resolve();
    release();
    await running;
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('does not queue or push when signed out', async () => {
    const handler = jest.fn();
    setLocalChangeHandler(handler);
    currentUser.mockReturnValue(null);

    await queueChange('transaction', 't1', 'create', { id: 't1' });
    jest.advanceTimersByTime(LOCAL_CHANGE_PUSH_DELAY_MS);

    expect(enqueue).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});

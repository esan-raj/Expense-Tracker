/// <reference types="jest" />
import { createSyncGate, syncGate } from '@/services/syncSingleFlight';

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe('sync single-flight', () => {
  afterEach(() => {
    syncGate.reset();
  });

  it('runs one pipeline when two full syncs start together and both callers resolve', async () => {
    const gate = createSyncGate();
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    const execute = async () => {
      runs += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(25);
      active -= 1;
    };

    const first = gate.run('full', execute);
    const second = gate.run('full', execute);
    await Promise.all([first, second]);

    expect(runs).toBe(1);
    expect(maxActive).toBe(1);
  });

  it('releases the lock after a rejection so a later sync can run', async () => {
    const gate = createSyncGate();
    const execute = jest.fn(async () => {
      if (execute.mock.calls.length === 1) throw new Error('network down');
    });

    await expect(gate.run('full', execute)).rejects.toThrow('network down');
    expect(gate.isRunning()).toBe(false);
    await expect(gate.run('full', execute)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('keeps a follow-up run for queue items that appear during sync', async () => {
    const gate = createSyncGate();
    const processed: string[] = [];
    let pending = ['existing'];
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });

    const execute = async () => {
      const batch = [...pending];
      pending = [];
      processed.push(...batch);
      if (processed.length === 1) {
        release();
        await delay(20);
      }
    };

    const first = gate.run('full', execute);
    await started;
    pending.push('created-during-sync');
    gate.requestFollowUp('full');
    await first;

    expect(processed).toEqual(['existing', 'created-during-sync']);
    expect(gate.isRunning()).toBe(false);
  });

  it('does not run push/pull pipelines concurrently under repeated triggers', async () => {
    const gate = createSyncGate();
    let active = 0;
    let maxActive = 0;
    const execute = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(15);
      active -= 1;
    };

    await Promise.all([
      gate.run('full', execute),
      gate.run('full', execute),
      gate.run('pull', execute),
      gate.run('full', execute),
      gate.run('pull', execute),
    ]);

    expect(maxActive).toBe(1);
    expect(gate.isRunning()).toBe(false);
  });
});

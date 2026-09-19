export interface PersistWriteStats {
  persistRequests: number;
  physicalWrites: number;
  maxConcurrentWrites: number;
  lastByteSize: number;
}

export interface PersistCoordinator {
  requestPersist: () => void;
  flush: () => Promise<void>;
  invalidate: () => void;
  generation: () => number;
  stats: () => PersistWriteStats;
  isWriting: () => boolean;
}

export function createPersistCoordinator(options: {
  serialize: () => string;
  write: (serialized: string, generation: number) => Promise<void>;
}): PersistCoordinator {
  let generation = 0;
  let dirty = false;
  let writing = false;
  let scheduled = false;
  let activeWrites = 0;
  let persistRequests = 0;
  let physicalWrites = 0;
  let maxConcurrentWrites = 0;
  let lastByteSize = 0;
  let runPromise: Promise<void> | null = null;
  let waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];

  function rejectWaiters(error: unknown) {
    const pending = waiters;
    waiters = [];
    pending.forEach((waiter) => waiter.reject(error));
  }

  function resolveWaiters() {
    if (dirty || writing || scheduled) return;
    const pending = waiters;
    waiters = [];
    pending.forEach((waiter) => waiter.resolve());
  }

  async function runLoop(): Promise<void> {
    while (dirty) {
      const gen = generation;
      dirty = false;
      let serialized: string;
      try {
        serialized = options.serialize();
        lastByteSize = serialized.length;
      } catch (error) {
        dirty = true;
        rejectWaiters(error);
        return;
      }
      if (generation !== gen) {
        continue;
      }
      writing = true;
      activeWrites += 1;
      maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
      try {
        await options.write(serialized, gen);
        if (generation === gen) {
          physicalWrites += 1;
        }
      } catch (error) {
        if (generation === gen) dirty = true;
        rejectWaiters(error);
        return;
      } finally {
        activeWrites -= 1;
        writing = false;
      }
    }
    resolveWaiters();
  }

  function ensureRunning(): Promise<void> {
    if (!runPromise) {
      runPromise = runLoop().finally(() => {
        runPromise = null;
      });
    }
    return runPromise;
  }

  function schedule() {
    if (writing || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (dirty) void ensureRunning();
    });
  }

  return {
    requestPersist() {
      persistRequests += 1;
      dirty = true;
      schedule();
    },
    async flush() {
      if (!dirty && !writing && !scheduled && !runPromise) return;
      return new Promise<void>((resolve, reject) => {
        waiters.push({ resolve, reject });
        void ensureRunning().catch(() => undefined);
      });
    },
    invalidate() {
      generation += 1;
      dirty = false;
      scheduled = false;
      const pending = waiters;
      waiters = [];
      pending.forEach((waiter) => waiter.resolve());
    },
    generation() {
      return generation;
    },
    stats() {
      return { persistRequests, physicalWrites, maxConcurrentWrites, lastByteSize };
    },
    isWriting() {
      return writing;
    },
  };
}

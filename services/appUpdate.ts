import { create } from 'zustand';
import { flushPersistentStorage } from '@/database';
import { createAppUpdateController, createInitialAppUpdateState } from '@/services/appUpdate/controller';
import { createExpoUpdatesAdapter } from '@/services/appUpdate/expoAdapter';
import type { AppUpdateState } from '@/services/appUpdate/types';
import { isCriticalWorkActive } from '@/store/useCriticalWorkStore';

const adapter = createExpoUpdatesAdapter();

export const useAppUpdateStore = create<AppUpdateState>(() => createInitialAppUpdateState(adapter));

export const appUpdateController = createAppUpdateController({
  adapter,
  flush: flushPersistentStorage,
  isCriticalWork: isCriticalWorkActive,
  getState: () => useAppUpdateStore.getState(),
  setState: (partial) => useAppUpdateStore.setState(partial),
});

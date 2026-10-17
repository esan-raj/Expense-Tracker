import { AppState } from 'react-native';
import { getRxStorageLocalstorage } from 'rxdb/plugins/storage-localstorage';
import * as FileSystem from 'expo-file-system/legacy';
import { createPersistCoordinator, type PersistCoordinator } from './persistCoordinator';
import { rxError, rxLog } from './logger';

const FILE = `${FileSystem.documentDirectory ?? ''}spendwise-rxdb-localstorage.json`;
const TMP_FILE = `${FILE}.tmp`;
const BAK_FILE = `${FILE}.bak`;

let storagePromise: Promise<ReturnType<typeof getRxStorageLocalstorage>> | null = null;
let coordinator: PersistCoordinator | null = null;
let appStateSubscription: { remove: () => void } | null = null;

function isDevMode(): boolean {
  return typeof __DEV__ !== 'undefined' && Boolean(__DEV__);
}

function logPersist(message: string, extra?: Record<string, number | string | null>) {
  if (!isDevMode()) return;
  rxLog('storage', message, extra);
}

async function readJsonObject(uri: string): Promise<Record<string, string> | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(uri)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, string>;
  } catch (error) {
    rxError('storage.load', error);
    return null;
  }
}

async function persistFile(serialized: string, generation: number): Promise<void> {
  if (!FileSystem.documentDirectory) return;
  if (coordinator && coordinator.generation() !== generation) return;

  const started = Date.now();
  await FileSystem.writeAsStringAsync(TMP_FILE, serialized);
  if (coordinator && coordinator.generation() !== generation) {
    await FileSystem.deleteAsync(TMP_FILE, { idempotent: true });
    return;
  }

  const current = await FileSystem.getInfoAsync(FILE);
  if (current.exists) {
    await FileSystem.deleteAsync(BAK_FILE, { idempotent: true });
    await FileSystem.moveAsync({ from: FILE, to: BAK_FILE });
  }
  if (coordinator && coordinator.generation() !== generation) {
    if (current.exists) {
      await FileSystem.moveAsync({ from: BAK_FILE, to: FILE }).catch(() => undefined);
    }
    await FileSystem.deleteAsync(TMP_FILE, { idempotent: true });
    return;
  }

  await FileSystem.moveAsync({ from: TMP_FILE, to: FILE });
  await FileSystem.deleteAsync(BAK_FILE, { idempotent: true });
  logPersist('write', {
    bytes: serialized.length,
    ms: Date.now() - started,
    physical: coordinator?.stats().physicalWrites ?? 0,
    requests: coordinator?.stats().persistRequests ?? 0,
  });
}

function createMemoryLocalStorage(initial: Record<string, string> = {}): Storage {
  const data = { ...initial };
  coordinator = createPersistCoordinator({
    serialize: () => JSON.stringify(data),
    write: persistFile,
  });

  const persist = () => {
    if (!FileSystem.documentDirectory) return;
    coordinator?.requestPersist();
  };

  return {
    get length() {
      return Object.keys(data).length;
    },
    clear() {
      for (const key of Object.keys(data)) delete data[key];
      persist();
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    key(index: number) {
      return Object.keys(data)[index] ?? null;
    },
    removeItem(key: string) {
      delete data[key];
      persist();
    },
    setItem(key: string, value: string) {
      data[key] = value;
      persist();
    },
  };
}

function attachAppStateFlush() {
  if (appStateSubscription) return;
  appStateSubscription = AppState.addEventListener('change', (next) => {
    if (next === 'background' || next === 'inactive') {
      void coordinator?.flush().catch((error) => rxError('storage.flush', error));
    }
  });
}

export async function flushPersistentStorage(): Promise<void> {
  await coordinator?.flush();
}

export function invalidatePersistentStorage(): void {
  coordinator?.invalidate();
}

export async function getPersistentStorage() {
  if (storagePromise) return storagePromise;
  storagePromise = (async () => {
    let initial: Record<string, string> = {};
    try {
      if (FileSystem.documentDirectory) {
        initial =
          (await readJsonObject(FILE)) ??
          (await readJsonObject(TMP_FILE)) ??
          (await readJsonObject(BAK_FILE)) ??
          {};
      }
    } catch (error) {
      rxError('storage.load', error);
    }
    rxLog('storage', 'using filesystem-backed localstorage adapter');
    attachAppStateFlush();
    return getRxStorageLocalstorage({
      localStorage: createMemoryLocalStorage(initial),
    });
  })();
  return storagePromise;
}

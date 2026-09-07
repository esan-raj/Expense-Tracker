import { getRxStorageLocalstorage } from 'rxdb/plugins/storage-localstorage';
import * as FileSystem from 'expo-file-system/legacy';
import { rxError, rxLog } from './logger';

const FILE = `${FileSystem.documentDirectory ?? ''}spendwise-rxdb-localstorage.json`;

function createMemoryLocalStorage(initial: Record<string, string> = {}): Storage {
  const data = { ...initial };
  const persist = () => {
    if (!FileSystem.documentDirectory) return;
    void FileSystem.writeAsStringAsync(FILE, JSON.stringify(data)).catch((error) => {
      rxError('storage', error);
    });
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

let storagePromise: Promise<ReturnType<typeof getRxStorageLocalstorage>> | null = null;

export async function getPersistentStorage() {
  if (storagePromise) return storagePromise;
  storagePromise = (async () => {
    let initial: Record<string, string> = {};
    try {
      if (FileSystem.documentDirectory) {
        const info = await FileSystem.getInfoAsync(FILE);
        if (info.exists) {
          initial = JSON.parse(await FileSystem.readAsStringAsync(FILE)) as Record<string, string>;
        }
      }
    } catch (error) {
      rxError('storage.load', error);
    }
    rxLog('storage', 'using filesystem-backed localstorage adapter');
    return getRxStorageLocalstorage({
      localStorage: createMemoryLocalStorage(initial),
    });
  })();
  return storagePromise;
}

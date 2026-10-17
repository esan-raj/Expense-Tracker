import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { rxLog } from './logger';

export async function flushPersistentStorage(): Promise<void> {}

export function invalidatePersistentStorage(): void {}

export async function getPersistentStorage() {
  rxLog('storage', 'using Dexie RxStorage (IndexedDB via RxDB)');
  return getRxStorageDexie();
}

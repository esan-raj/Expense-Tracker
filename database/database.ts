import { verifyWebCryptoDigest } from './cryptoPolyfill';
import { addRxPlugin, createRxDatabase, removeRxDatabase, type RxDatabase, type RxStorage } from 'rxdb';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import { RxDBMigrationSchemaPlugin } from 'rxdb/plugins/migration-schema';
import { transactionSchema } from './schemas/transaction.schema';
import { categorySchema } from './schemas/category.schema';
import { accountSchema } from './schemas/account.schema';
import { budgetSchema } from './schemas/budget.schema';
import { recurringTransactionSchema } from './schemas/recurringTransaction.schema';
import { settingsSchema } from './schemas/settings.schema';
import { syncQueueSchema } from './schemas/syncQueue.schema';
import { syncStateSchema } from './schemas/syncState.schema';
import { investmentSchema } from './schemas/investment.schema';
import { rxError, rxLog } from './logger';
import type { SpendWiseCollections, SpendWiseDatabase } from './types';

addRxPlugin(RxDBMigrationSchemaPlugin);

export const SPENDWISE_DATABASE_NAME = 'spendwise';
const EXPECTED_COLLECTIONS = [
  'transactions',
  'categories',
  'accounts',
  'budgets',
  'recurring',
  'settings',
  'investments',
  'syncQueue',
  'syncState',
] as const;

let database: SpendWiseDatabase | null = null;
let initializing: Promise<SpendWiseDatabase> | null = null;

function isTestRuntime(): boolean {
  return typeof process !== 'undefined' && Boolean(process.env.JEST_WORKER_ID);
}

function isDevMode(): boolean {
  return typeof __DEV__ !== 'undefined' && Boolean(__DEV__);
}

async function maybeEnableDevMode(): Promise<void> {
  if (isTestRuntime() || !isDevMode()) return;
  const { RxDBDevModePlugin } = await import('rxdb/plugins/dev-mode');
  addRxPlugin(RxDBDevModePlugin);
}

async function maybeWrapDevModeStorage(
  storage: RxStorage<any, any>
): Promise<RxStorage<any, any>> {
  if (isTestRuntime() || !isDevMode()) return storage;
  const { wrappedValidateAjvStorage } = await import('rxdb/plugins/validate-ajv');
  return wrappedValidateAjvStorage({ storage });
}

function isMultiInstance(): boolean {
  return !isTestRuntime() && typeof document !== 'undefined';
}

function isRxDb6(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'DB6');
}

function isLocalResetAllowed(): boolean {
  if (isTestRuntime() || isDevMode()) return true;
  return typeof process !== 'undefined' && process.env.SPENDWISE_ALLOW_LOCAL_DB_RESET === '1';
}

async function getRawStorage() {
  return isTestRuntime()
    ? getRxStorageMemory()
    : (await import('./storage')).getPersistentStorage();
}

function logReadyCollections(db: SpendWiseDatabase): void {
  const missing = EXPECTED_COLLECTIONS.filter((name) => !db[name]);
  rxLog('init', `collections ${EXPECTED_COLLECTIONS.join(', ')}`);
  if (missing.length > 0) {
    throw new Error(`RxDB collections missing after init: ${missing.join(', ')}`);
  }
}

async function wipeLocalDatabase(name: string): Promise<void> {
  if (database && database.name === name) {
    await database.remove();
    database = null;
    rxLog('reset', `removed local database ${name} (RxDB instance)`);
    return;
  }
  const storage = await getRawStorage();
  const removed = await removeRxDatabase(name, storage, isMultiInstance());
  rxLog('reset', `removed local database ${name}`, {
    collections: removed.join(',') || 'none',
  });
}

export async function createSpendWiseDatabase(name = SPENDWISE_DATABASE_NAME): Promise<SpendWiseDatabase> {
  await verifyWebCryptoDigest();
  await maybeEnableDevMode();
  const rawStorage = await getRawStorage();
  const storage = await maybeWrapDevModeStorage(rawStorage);
  const db = await createRxDatabase<SpendWiseCollections>({
    name,
    storage,
    multiInstance: isMultiInstance(),
    closeDuplicates: true,
    eventReduce: true,
  });

  try {
    await db.addCollections({
      transactions: {
        schema: transactionSchema,
        migrationStrategies: {
          1: (doc) => doc,
        },
      },
      categories: { schema: categorySchema },
      accounts: { schema: accountSchema },
      budgets: { schema: budgetSchema },
      recurring: {
        schema: recurringTransactionSchema,
        migrationStrategies: {
          1: (doc) => doc,
        },
      },
      settings: {
        schema: settingsSchema,
        migrationStrategies: {
          1: (doc) => ({
            ...doc,
            accentPreset: typeof doc.accentPreset === 'string' ? doc.accentPreset : 'emerald',
            accentColor: typeof doc.accentColor === 'string' ? doc.accentColor : '#0E7C66',
          }),
        },
      },
      investments: { schema: investmentSchema },
      syncQueue: { schema: syncQueueSchema },
      syncState: { schema: syncStateSchema },
    });
    return db;
  } catch (error) {
    await db.close().catch((closeError) => rxError('init.close', closeError));
    throw error;
  }
}

async function bootstrapDatabase(): Promise<SpendWiseDatabase> {
  rxLog('init', 'creating database');
  const db = await createSpendWiseDatabase(isTestRuntime() ? `spendwise-test-${Date.now()}` : SPENDWISE_DATABASE_NAME);
  const { migrateJsonSnapshot } = await import('./migrateJson');
  const { seedDefaults } = await import('./seed');
  await migrateJsonSnapshot(db);
  await seedDefaults(db);
  database = db;
  const { categoryDedupeService } = await import('@/services/categoryDedupeService');
  await categoryDedupeService.apply();
  logReadyCollections(db);
  rxLog('init', 'ready');
  return db;
}

export async function getRxDatabase(): Promise<SpendWiseDatabase> {
  if (database) return database;
  if (initializing) return initializing;

  initializing = (async () => {
    try {
      return await bootstrapDatabase();
    } catch (error) {
      if (isDevMode() && isRxDb6(error)) {
        rxLog('init', 'DB6 schema hash mismatch; resetting local RxDB only (Supabase untouched)');
        await wipeLocalDatabase(SPENDWISE_DATABASE_NAME);
        return await bootstrapDatabase();
      }
      rxError('init', error);
      initializing = null;
      throw error;
    }
  })();

  return initializing;
}

export async function resetSpendWiseDatabase(): Promise<SpendWiseDatabase> {
  if (!isLocalResetAllowed()) {
    throw new Error('Local RxDB reset is development-only and does not run in production.');
  }
  const name = database?.name ?? SPENDWISE_DATABASE_NAME;
  await wipeLocalDatabase(name);
  database = null;
  initializing = null;
  return getRxDatabase();
}

export async function resetDatabaseConnection(): Promise<void> {
  if (database) {
    await database.close();
  }
  database = null;
  initializing = null;
}

export type SpendWiseDb = RxDatabase<SpendWiseCollections>;

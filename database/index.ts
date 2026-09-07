import { AppError, logError } from '@/utils/errors';
import { getRxDatabase, resetDatabaseConnection, resetSpendWiseDatabase } from './database';
import type { SpendWiseDatabase } from './types';

export async function getStore(): Promise<SpendWiseDatabase> {
  try {
    return await getRxDatabase();
  } catch (error) {
    logError('database.init', error);
    throw new AppError('We could not open your local data. Please restart the app.', error);
  }
}

export const getDatabase = getStore;
export { getRxDatabase, resetDatabaseConnection, resetSpendWiseDatabase };
export type { SpendWiseDatabase } from './types';

import { useCallback, useEffect } from 'react';
import { useTransactionStore } from '@/store/useTransactionStore';

export function useTransactions() {
  const store = useTransactionStore();

  useEffect(() => {
    void store.load();
  }, []);

  const refresh = useCallback(() => store.load(store.query), [store]);

  return { ...store, refresh };
}

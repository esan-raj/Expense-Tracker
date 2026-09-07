import { useCallback, useEffect } from 'react';
import { useBudgetStore } from '@/store/useBudgetStore';

export function useBudgets() {
  const store = useBudgetStore();

  useEffect(() => {
    void store.load();
  }, []);

  const refresh = useCallback(() => store.load(), [store]);

  return { ...store, refresh };
}

import { useCallback, useEffect } from 'react';
import { useBudgetStore } from '@/store/useBudgetStore';

export function useBudgets() {
  const items = useBudgetStore((state) => state.items);
  const loading = useBudgetStore((state) => state.loading);
  const error = useBudgetStore((state) => state.error);
  const month = useBudgetStore((state) => state.month);
  const year = useBudgetStore((state) => state.year);
  const load = useBudgetStore((state) => state.load);
  const create = useBudgetStore((state) => state.create);
  const update = useBudgetStore((state) => state.update);
  const remove = useBudgetStore((state) => state.remove);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => load(), [load]);

  return { items, loading, error, month, year, load, create, update, remove, refresh };
}

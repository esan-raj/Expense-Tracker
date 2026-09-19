import { useCallback, useEffect } from 'react';
import { useTransactionStore } from '@/store/useTransactionStore';

export function useTransactions() {
  const items = useTransactionStore((state) => state.items);
  const loading = useTransactionStore((state) => state.loading);
  const error = useTransactionStore((state) => state.error);
  const query = useTransactionStore((state) => state.query);
  const load = useTransactionStore((state) => state.load);
  const loadMore = useTransactionStore((state) => state.loadMore);
  const setQuery = useTransactionStore((state) => state.setQuery);
  const create = useTransactionStore((state) => state.create);
  const transfer = useTransactionStore((state) => state.transfer);
  const update = useTransactionStore((state) => state.update);
  const remove = useTransactionStore((state) => state.remove);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => load(query), [load, query]);

  return { items, loading, error, query, load, loadMore, setQuery, create, transfer, update, remove, refresh };
}

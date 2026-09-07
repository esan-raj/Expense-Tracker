import { create } from 'zustand';
import { transactionService } from '@/services/transactionService';
import type { TransactionInput, TransactionQuery, TransactionWithCategory, TransferInput } from '@/types';
import { PAGE_SIZE } from '@/utils/constants';

interface TransactionState {
  items: TransactionWithCategory[];
  recent: TransactionWithCategory[];
  total: number;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
  query: TransactionQuery;
  load: (query?: TransactionQuery, reset?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  loadRecent: () => Promise<void>;
  create: (input: TransactionInput) => Promise<void>;
  transfer: (input: TransferInput) => Promise<void>;
  update: (id: string, input: TransactionInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setQuery: (query: TransactionQuery) => Promise<void>;
}

export const useTransactionStore = create<TransactionState>((set, get) => ({
  items: [],
  recent: [],
  total: 0,
  loading: false,
  refreshing: false,
  loadingMore: false,
  error: null,
  query: { filters: { type: 'all' }, sort: 'newest', limit: PAGE_SIZE, offset: 0 },
  load: async (query, reset = true) => {
    const nextQuery = query ?? get().query;
    set({
      query: nextQuery,
      loading: reset && get().items.length === 0,
      refreshing: reset && get().items.length > 0,
      error: null,
    });
    try {
      const [items, total] = await Promise.all([
        transactionService.query({ ...nextQuery, offset: 0, limit: PAGE_SIZE }),
        transactionService.count(nextQuery),
      ]);
      set({ items, total, loading: false, refreshing: false });
    } catch (error) {
      set({
        loading: false,
        refreshing: false,
        error: error instanceof Error ? error.message : 'Could not load transactions',
      });
    }
  },
  loadMore: async () => {
    const { items, total, query, loadingMore } = get();
    if (loadingMore || items.length >= total) return;
    set({ loadingMore: true });
    const more = await transactionService.query({
      ...query,
      offset: items.length,
      limit: PAGE_SIZE,
    });
    set({ items: [...items, ...more], loadingMore: false });
  },
  loadRecent: async () => {
    const recent = await transactionService.recent(5);
    set({ recent });
  },
  create: async (input) => {
    await transactionService.create(input);
    await Promise.all([get().load(get().query), get().loadRecent()]);
  },
  transfer: async (input) => {
    await transactionService.transfer(input);
    await Promise.all([get().load(get().query), get().loadRecent()]);
  },
  update: async (id, input) => {
    await transactionService.update(id, input);
    await Promise.all([get().load(get().query), get().loadRecent()]);
  },
  remove: async (id) => {
    await transactionService.delete(id);
    await Promise.all([get().load(get().query), get().loadRecent()]);
  },
  setQuery: async (query) => {
    await get().load({ ...get().query, ...query, filters: { ...get().query.filters, ...query.filters } });
  },
}));

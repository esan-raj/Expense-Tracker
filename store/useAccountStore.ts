import { create } from 'zustand';
import { accountService } from '@/services/accountService';
import type { Account, AccountInput, AccountWithBalances } from '@/types';

interface AccountState {
  accounts: AccountWithBalances[];
  lastUsedId: string | null;
  loading: boolean;
  load: () => Promise<void>;
  create: (input: AccountInput) => Promise<Account>;
  update: (id: string, input: AccountInput) => Promise<void>;
  archive: (id: string) => Promise<void>;
  reactivate: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  remember: (id: string) => void;
  reset: () => void;
}

export const useAccountStore = create<AccountState>((set, get) => ({
  accounts: [],
  lastUsedId: null,
  loading: false,
  load: async () => {
    set({ loading: get().accounts.length === 0 });
    const accounts = await accountService.list(true);
    set({ accounts, loading: false });
  },
  create: async (input) => {
    const created = await accountService.create(input);
    set({ lastUsedId: created.id });
    await get().load();
    return created;
  },
  update: async (id, input) => {
    await accountService.update(id, input);
    await get().load();
  },
  archive: async (id) => {
    await accountService.archive(id);
    await get().load();
  },
  reactivate: async (id) => {
    await accountService.reactivate(id);
    await get().load();
  },
  remove: async (id) => {
    await accountService.remove(id);
    await get().load();
  },
  remember: (id) => set({ lastUsedId: id }),
  reset: () => set({ accounts: [], lastUsedId: null, loading: false }),
}));

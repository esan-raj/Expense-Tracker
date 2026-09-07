import { create } from 'zustand';
import { investmentService } from '@/services/investmentService';
import type { Investment, InvestmentInput } from '@/types';

interface InvestmentState {
  investments: Investment[];
  loading: boolean;
  load: () => Promise<void>;
  create: (input: InvestmentInput) => Promise<void>;
  update: (id: string, input: InvestmentInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useInvestmentStore = create<InvestmentState>((set, get) => ({
  investments: [],
  loading: false,
  load: async () => {
    set({ loading: get().investments.length === 0 });
    const investments = await investmentService.list();
    set({ investments, loading: false });
  },
  create: async (input) => {
    await investmentService.create(input);
    await get().load();
  },
  update: async (id, input) => {
    await investmentService.update(id, input);
    await get().load();
  },
  remove: async (id) => {
    await investmentService.remove(id);
    await get().load();
  },
}));

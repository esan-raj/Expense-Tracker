import { create } from 'zustand';
import { budgetService } from '@/services/budgetService';
import type { BudgetInput, BudgetWithUsage } from '@/types';
import { currentMonthYear } from '@/utils/dates';

interface BudgetState {
  items: BudgetWithUsage[];
  warnings: Array<BudgetWithUsage & { level: 50 | 75 | 90 | 100 }>;
  month: number;
  year: number;
  loading: boolean;
  error: string | null;
  load: (month?: number, year?: number) => Promise<void>;
  create: (input: BudgetInput) => Promise<void>;
  update: (id: string, input: BudgetInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useBudgetStore = create<BudgetState>((set, get) => {
  const initial = currentMonthYear();
  return {
    items: [],
    warnings: [],
    month: initial.month,
    year: initial.year,
    loading: false,
    error: null,
    load: async (month, year) => {
      const period = {
        month: month ?? get().month,
        year: year ?? get().year,
      };
      set({ loading: get().items.length === 0, error: null, ...period });
      try {
        const [items, warnings] = await Promise.all([
          budgetService.listWithUsage(period.month, period.year),
          budgetService.warnings(period.month, period.year),
        ]);
        set({ items, warnings, loading: false });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : 'Could not load budgets',
        });
      }
    },
    create: async (input) => {
      await budgetService.create(input);
      await get().load(input.month, input.year);
    },
    update: async (id, input) => {
      await budgetService.update(id, input);
      await get().load(input.month, input.year);
    },
    remove: async (id) => {
      await budgetService.delete(id);
      await get().load();
    },
  };
});

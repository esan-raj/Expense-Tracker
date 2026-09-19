import { create } from 'zustand';
import { categoryService } from '@/services/categoryService';
import type { Category, CategoryInput } from '@/types';

interface CategoryState {
  categories: Category[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (input: CategoryInput) => Promise<Category>;
  update: (id: string, input: CategoryInput) => Promise<void>;
  remove: (id: string, reassignToId?: string) => Promise<void>;
}

export const useCategoryStore = create<CategoryState>((set, get) => ({
  categories: [],
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const categories = await categoryService.list();
      set({ categories, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Could not load categories',
      });
    }
  },
  create: async (input) => {
    const created = await categoryService.create(input);
    await get().load();
    return created;
  },
  update: async (id, input) => {
    await categoryService.update(id, input);
    await get().load();
  },
  remove: async (id, reassignToId) => {
    await categoryService.delete(id, reassignToId);
    await get().load();
  },
}));

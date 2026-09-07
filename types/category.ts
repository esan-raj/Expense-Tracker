export type CategoryType = 'expense' | 'income' | 'both';

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: CategoryType;
  isDefault: boolean;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

export interface CategoryInput {
  name: string;
  icon: string;
  color: string;
  type: CategoryType;
}

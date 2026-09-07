export interface Budget {
  id: string;
  categoryId: string | null;
  amount: number;
  month: number;
  year: number;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetWithUsage extends Budget {
  spent: number;
  remaining: number;
  percent: number;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
}

export interface BudgetInput {
  categoryId?: string | null;
  amount: number;
  month: number;
  year: number;
}

export type BudgetWarningLevel = 50 | 75 | 90 | 100;

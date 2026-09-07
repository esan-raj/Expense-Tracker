import type { CategoryInput } from '@/types';

export const CATEGORY_ICONS = [
  'restaurant',
  'cart',
  'car',
  'bag-handle',
  'receipt',
  'home',
  'film',
  'medkit',
  'school',
  'airplane',
  'card',
  'sparkles',
  'gift',
  'ellipse',
  'cash',
  'laptop',
  'briefcase',
  'trending-up',
  'fitness',
  'cafe',
  'phone-portrait',
  'musical-notes',
  'paw',
  'construct',
] as const;

export const CATEGORY_COLORS = [
  '#F97316',
  '#84CC16',
  '#3B82F6',
  '#EC4899',
  '#8B5CF6',
  '#0EA5E9',
  '#F59E0B',
  '#EF4444',
  '#6366F1',
  '#14B8A6',
  '#A855F7',
  '#F43F5E',
  '#E11D48',
  '#64748B',
  '#059669',
  '#10B981',
  '#0D9488',
  '#2563EB',
  '#DB2777',
] as const;

export const DEFAULT_EXPENSE_CATEGORIES: CategoryInput[] = [
  { name: 'Food', icon: 'restaurant', color: '#F97316', type: 'expense' },
  { name: 'Groceries', icon: 'cart', color: '#84CC16', type: 'expense' },
  { name: 'Transport', icon: 'car', color: '#3B82F6', type: 'expense' },
  { name: 'Shopping', icon: 'bag-handle', color: '#EC4899', type: 'expense' },
  { name: 'Bills', icon: 'receipt', color: '#8B5CF6', type: 'expense' },
  { name: 'Rent', icon: 'home', color: '#0EA5E9', type: 'expense' },
  { name: 'Entertainment', icon: 'film', color: '#F59E0B', type: 'expense' },
  { name: 'Health', icon: 'medkit', color: '#EF4444', type: 'expense' },
  { name: 'Education', icon: 'school', color: '#6366F1', type: 'expense' },
  { name: 'Travel', icon: 'airplane', color: '#14B8A6', type: 'expense' },
  { name: 'Subscriptions', icon: 'card', color: '#A855F7', type: 'expense' },
  { name: 'Personal Care', icon: 'sparkles', color: '#F43F5E', type: 'expense' },
  { name: 'Gifts', icon: 'gift', color: '#E11D48', type: 'expense' },
  { name: 'Other', icon: 'ellipse', color: '#64748B', type: 'expense' },
];

export const DEFAULT_INCOME_CATEGORIES: CategoryInput[] = [
  { name: 'Salary', icon: 'cash', color: '#059669', type: 'income' },
  { name: 'Freelance', icon: 'laptop', color: '#10B981', type: 'income' },
  { name: 'Business', icon: 'briefcase', color: '#0D9488', type: 'income' },
  { name: 'Investment', icon: 'trending-up', color: '#2563EB', type: 'income' },
  { name: 'Gift', icon: 'gift', color: '#DB2777', type: 'income' },
  { name: 'Other Income', icon: 'ellipse', color: '#64748B', type: 'income' },
];

export const DEFAULT_CATEGORIES: CategoryInput[] = [
  ...DEFAULT_EXPENSE_CATEGORIES,
  ...DEFAULT_INCOME_CATEGORIES,
];

import { z } from 'zod';
import { PAYMENT_METHODS, FREQUENCIES, BACKUP_VERSION } from './constants';
import { ACCOUNT_TYPES } from '@/types/account';
import { INVESTMENT_TYPES } from '@/types/investment';

const paymentMethodValues = PAYMENT_METHODS.map((item) => item.value) as [
  (typeof PAYMENT_METHODS)[number]['value'],
  ...(typeof PAYMENT_METHODS)[number]['value'][],
];
const frequencyValues = FREQUENCIES.map((item) => item.value) as [
  (typeof FREQUENCIES)[number]['value'],
  ...(typeof FREQUENCIES)[number]['value'][],
];

export const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid date');

export const transactionFormSchema = z.object({
  entryType: z.enum(['expense', 'income', 'transfer']),
  type: z.enum(['expense', 'income']),
  amount: z
    .number()
    .positive('Amount must be greater than 0')
    .max(1_000_000_000, 'Amount is too large'),
  title: z.string().trim().min(1, 'Title is required').max(80, 'Title is too long'),
  categoryId: z.string().optional().or(z.literal('')),
  accountId: z.string().optional().or(z.literal('')),
  sourceAccountId: z.string().optional().or(z.literal('')),
  destinationAccountId: z.string().optional().or(z.literal('')),
  date: dateKeySchema,
  paymentMethod: z.enum(paymentMethodValues),
  notes: z.string().max(500, 'Notes are too long').optional().or(z.literal('')),
  isRecurring: z.boolean(),
  frequency: z.enum(frequencyValues).optional(),
  recurringStartDate: dateKeySchema.optional(),
}).superRefine((value, ctx) => {
  if (value.entryType === 'transfer') {
    if (!value.sourceAccountId) {
      ctx.addIssue({ code: 'custom', path: ['sourceAccountId'], message: 'Choose an account to send from' });
    }
    if (!value.destinationAccountId) {
      ctx.addIssue({ code: 'custom', path: ['destinationAccountId'], message: 'Choose an account to send to' });
    }
    if (value.sourceAccountId && value.sourceAccountId === value.destinationAccountId) {
      ctx.addIssue({ code: 'custom', path: ['destinationAccountId'], message: 'Choose two different accounts' });
    }
    return;
  }
  if (!value.categoryId) {
    ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Choose a category' });
  }
  if (value.isRecurring && !value.frequency) {
    ctx.addIssue({
      code: 'custom',
      path: ['frequency'],
      message: 'Choose how often this repeats',
    });
  }
});

export const investmentFormSchema = z.object({
  name: z.string().trim().min(1, 'Investment name is required').max(80, 'Name is too long'),
  type: z.enum(INVESTMENT_TYPES),
  investedAmount: z.number().positive('Amount invested must be greater than 0').max(1_000_000_000),
  currentValue: z.number().min(0, 'Current value cannot be negative').max(1_000_000_000).optional(),
  investmentDate: dateKeySchema,
  accountId: z.string().optional().or(z.literal('')),
  notes: z.string().max(500, 'Notes are too long').optional().or(z.literal('')),
});

export const accountFormSchema = z.object({
  type: z.enum(ACCOUNT_TYPES),
  name: z.string().trim().min(1, 'Account name is required').max(60, 'Name is too long'),
  institutionName: z.string().max(60, 'Institution is too long').optional().or(z.literal('')),
  openingBalance: z.number().min(0, 'Opening value cannot be negative').max(1_000_000_000),
  creditLimit: z.number().min(0, 'Credit limit cannot be negative').max(1_000_000_000).optional(),
}).superRefine((value, ctx) => {
  if (value.type === 'credit_card' && value.creditLimit == null) {
    ctx.addIssue({ code: 'custom', path: ['creditLimit'], message: 'Credit limit is required' });
  }
});

export const budgetFormSchema = z.object({
  categoryId: z.string().nullable(),
  amount: z
    .number()
    .positive('Budget must be greater than 0')
    .max(1_000_000_000, 'Budget is too large'),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
});

export const categoryFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(40, 'Name is too long'),
  icon: z.string().min(1, 'Choose an icon'),
  color: z.string().regex(/^#([0-9A-Fa-f]{6})$/, 'Choose a valid color'),
  type: z.enum(['expense', 'income', 'both']),
});

export const recurringFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(80, 'Title is too long'),
  amount: z
    .number()
    .positive('Amount must be greater than 0')
    .max(1_000_000_000, 'Amount is too large'),
  type: z.enum(['expense', 'income']),
  categoryId: z.string().min(1, 'Choose a category'),
  accountId: z.string().optional().or(z.literal('')),
  frequency: z.enum(frequencyValues),
  startDate: dateKeySchema,
  paymentMethod: z.enum(paymentMethodValues),
});

export const authEmailSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

export const signUpSchema = authEmailSchema
  .extend({
    confirmPassword: z.string().min(8, 'Password must be at least 8 characters.'),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address.'),
});

export type AuthEmailValues = z.infer<typeof authEmailSchema>;
export type SignUpValues = z.infer<typeof signUpSchema>;

export const onboardingSchema = z.object({
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'JPY']),
  monthlyBudget: z
    .number()
    .positive('Budget must be greater than 0')
    .max(1_000_000_000, 'Budget is too large')
    .nullable(),
});

const backupTransactionSchema = z.object({
  id: z.string(),
  type: z.enum(['expense', 'income']),
  amount: z.number().int(),
  categoryId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  date: dateKeySchema,
  paymentMethod: z.enum(paymentMethodValues),
  notes: z.string().nullable(),
  isRecurring: z.boolean(),
  recurringId: z.string().nullable(),
  accountId: z.string().nullable().optional(),
  isTransfer: z.boolean().optional(),
  transferGroupId: z.string().nullable().optional(),
  transferRole: z.enum(['source', 'destination']).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const backupCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  color: z.string(),
  type: z.enum(['expense', 'income', 'both']),
  isDefault: z.boolean(),
  createdAt: z.string(),
});

const backupBudgetSchema = z.object({
  id: z.string(),
  categoryId: z.string().nullable(),
  amount: z.number().int().positive(),
  month: z.number().int().min(1).max(12),
  year: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const backupRecurringSchema = z.object({
  id: z.string(),
  title: z.string(),
  amount: z.number().int().positive(),
  type: z.enum(['expense', 'income']),
  categoryId: z.string(),
  frequency: z.enum(frequencyValues),
  startDate: dateKeySchema,
  nextDate: dateKeySchema,
  paymentMethod: z.enum(paymentMethodValues),
  accountId: z.string().nullable().optional(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const backupInvestmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(INVESTMENT_TYPES),
  investedAmount: z.number().int(),
  currentValue: z.number().int(),
  investmentDate: dateKeySchema,
  accountId: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const backupAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(ACCOUNT_TYPES),
  institutionName: z.string().nullable(),
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'JPY']),
  openingBalance: z.number().int(),
  creditLimit: z.number().int().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const backupSettingsSchema = z.object({
  id: z.string(),
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'JPY']),
  currencySymbol: z.string(),
  theme: z.enum(['system', 'light', 'dark']),
  accentPreset: z.enum(['emerald', 'ocean', 'indigo', 'violet', 'amber', 'rose', 'custom']).optional().default('emerald'),
  accentColor: z.string().optional().default('#0E7C66'),
  firstDayOfWeek: z.number().int().min(0).max(6),
  monthlyBudget: z.number().int().nullable(),
  onboardingComplete: z.boolean(),
});

export const backupSchema = z.object({
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string(),
  transactions: z.array(backupTransactionSchema),
  categories: z.array(backupCategorySchema).min(1, 'Backup is missing categories'),
  budgets: z.array(backupBudgetSchema),
  recurringTransactions: z.array(backupRecurringSchema),
  accounts: z.array(backupAccountSchema).optional().default([]),
  investments: z.array(backupInvestmentSchema).optional().default([]),
  settings: backupSettingsSchema,
});

export type TransactionFormValues = z.infer<typeof transactionFormSchema>;
export type BudgetFormValues = z.infer<typeof budgetFormSchema>;
export type CategoryFormValues = z.infer<typeof categoryFormSchema>;
export type RecurringFormValues = z.infer<typeof recurringFormSchema>;
export type AccountFormValues = z.infer<typeof accountFormSchema>;
export type InvestmentFormValues = z.infer<typeof investmentFormSchema>;
export type BackupPayload = z.infer<typeof backupSchema>;

export function validateBackup(data: unknown): BackupPayload {
  return backupSchema.parse(data);
}

export function safeValidateBackup(data: unknown) {
  return backupSchema.safeParse(data);
}

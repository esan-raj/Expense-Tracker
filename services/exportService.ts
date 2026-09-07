import { transactionRepository } from '@/database/repositories/transactionRepository';
import { pickTextFile, saveAndShare } from '@/services/platform/files';
import { categoryRepository } from '@/database/repositories/categoryRepository';
import { paymentMethodLabel } from '@/utils/constants';
import { AppError, logError } from '@/utils/errors';
import { fromMinorUnits } from '@/utils/currency';
import { getCurrency } from '@/constants/currencies';
import type { CurrencyCode } from '@/types';

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export const exportService = {
  async exportCsv(currency: CurrencyCode): Promise<void> {
    try {
      const { accountRepository } = await import('@/database/repositories/accountRepository');
      const [transactions, categories, accounts] = await Promise.all([
        transactionRepository.exportAll(),
        categoryRepository.list(),
        accountRepository.list(true),
      ]);
      const categoryMap = Object.fromEntries(categories.map((item) => [item.id, item.name]));
      const accountMap = Object.fromEntries(accounts.map((item) => [item.id, item.name]));
      const definition = getCurrency(currency);
      const header = 'Date,Type,Title,Category,Amount,Payment Method,Notes,Account';
      const rows = transactions.map((item) =>
        [
          item.date,
          item.isTransfer ? 'transfer' : item.type,
          csvEscape(item.title),
          csvEscape(categoryMap[item.categoryId] ?? ''),
          fromMinorUnits(item.amount, definition.decimals).toFixed(definition.decimals),
          csvEscape(paymentMethodLabel(item.paymentMethod)),
          csvEscape(item.notes ?? ''),
          csvEscape(item.accountId ? accountMap[item.accountId] ?? '' : ''),
        ].join(',')
      );
      const csv = [header, ...rows].join('\n');
      await saveAndShare('spendwise-transactions.csv', csv, 'text/csv');
    } catch (error) {
      logError('export.csv', error);
      if (error instanceof AppError) throw error;
      throw new AppError('We could not export your transactions.', error);
    }
  },

  async importCsv(currency: CurrencyCode): Promise<number> {
    try {
      const content = await pickTextFile(['text/csv', '.csv']);
      if (!content) {
        return 0;
      }
      const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length < 2) {
        throw new AppError('This file does not contain any transactions.');
      }

      const header = lines[0].toLowerCase();
      if (!header.includes('date') || !header.includes('amount') || !header.includes('title')) {
        throw new AppError('This file does not look like a SpendWise CSV export.');
      }

      const { accountRepository } = await import('@/database/repositories/accountRepository');
      const [categories, accountList] = await Promise.all([
        categoryRepository.list(),
        accountRepository.list(true),
      ]);
      const definition = getCurrency(currency);
      let imported = 0;

      for (const line of lines.slice(1)) {
        const parts = parseCsvLine(line);
        if (parts.length < 6) continue;
        const [date, type, title, categoryName, amount, paymentMethod, notes, accountName] = parts;
        const category =
          categories.find((item) => item.name.toLowerCase() === (categoryName ?? '').toLowerCase()) ??
          categories.find((item) => item.type === type || item.type === 'both');
        if (!category) continue;
        const parsedAmount = Number(amount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) continue;
        if (type !== 'expense' && type !== 'income') continue;
        const account = accountName
          ? accountList.find((item) => item.name.toLowerCase() === accountName.toLowerCase())
          : undefined;

        await transactionRepository.create({
          type,
          amount: Math.round(parsedAmount * 10 ** definition.decimals),
          categoryId: category.id,
          title,
          date,
          paymentMethod: normalizePayment(paymentMethod),
          notes: notes || null,
          accountId: account?.id ?? null,
        });
        imported += 1;
      }

      if (imported === 0) {
        throw new AppError('No valid transactions were found in this file.');
      }
      return imported;
    } catch (error) {
      logError('export.importCsv', error);
      if (error instanceof AppError) throw error;
      throw new AppError('We could not import this file.', error);
    }
  },
};

function normalizePayment(value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, '_');
  const allowed = ['cash', 'upi', 'credit_card', 'debit_card', 'bank_transfer', 'wallet', 'other'] as const;
  return (allowed.find((item) => item === normalized) ?? 'other') as (typeof allowed)[number];
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

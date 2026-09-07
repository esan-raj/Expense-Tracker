import { investmentRepository } from '@/database/repositories/investmentRepository';
import { queueChange } from '@/services/outbox';
import type { Investment, InvestmentInput, InvestmentSummary, InvestmentType } from '@/types';
import { AppError, logError } from '@/utils/errors';
import { nowIso } from '@/utils/dates';

export function summarizeInvestments(items: Investment[]): InvestmentSummary {
  const totalInvested = items.reduce((sum, item) => sum + item.investedAmount, 0);
  const currentValue = items.reduce((sum, item) => sum + item.currentValue, 0);
  const returns = currentValue - totalInvested;
  const byTypeMap = new Map<InvestmentType, { investedAmount: number; currentValue: number }>();
  for (const item of items) {
    const current = byTypeMap.get(item.type) ?? { investedAmount: 0, currentValue: 0 };
    current.investedAmount += item.investedAmount;
    current.currentValue += item.currentValue;
    byTypeMap.set(item.type, current);
  }
  return {
    totalInvested,
    currentValue,
    returns,
    returnPercent: totalInvested > 0 ? Math.round((returns / totalInvested) * 10000) / 100 : null,
    byType: [...byTypeMap.entries()]
      .map(([type, amounts]) => ({ type, ...amounts }))
      .sort((a, b) => b.investedAmount - a.investedAmount),
  };
}

export const investmentService = {
  list() {
    return investmentRepository.list();
  },

  async getById(id: string): Promise<Investment> {
    const item = await investmentRepository.getById(id);
    if (!item) throw new AppError('This investment could not be found.');
    return item;
  },

  async summary(): Promise<InvestmentSummary> {
    return summarizeInvestments(await investmentRepository.list());
  },

  async create(input: InvestmentInput): Promise<Investment> {
    try {
      const created = await investmentRepository.create(input);
      await queueChange('investment', created.id, 'create', created);
      return created;
    } catch (error) {
      logError('investment.create', error);
      if (error instanceof AppError) throw error;
      throw new AppError('We could not save this investment.', error);
    }
  },

  async update(id: string, input: InvestmentInput): Promise<Investment> {
    try {
      const updated = await investmentRepository.update(id, input);
      await queueChange('investment', updated.id, 'update', updated);
      return updated;
    } catch (error) {
      logError('investment.update', error);
      if (error instanceof AppError) throw error;
      throw new AppError('We could not update this investment.', error);
    }
  },

  async remove(id: string): Promise<void> {
    await investmentRepository.delete(id);
    await queueChange('investment', id, 'delete', { id, deletedAt: nowIso() });
  },
};

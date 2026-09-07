import { recurringRepository } from '@/database/repositories/recurringRepository';
import { transactionRepository } from '@/database/repositories/transactionRepository';
import { queueChange } from '@/services/outbox';
import type { RecurringInput } from '@/types';
import { nowIso } from '@/utils/dates';
import { AppError, logError } from '@/utils/errors';
import { addFrequency, dueOccurrences, fromDateKey, toDateKey, todayKey } from '@/utils/dates';

export const recurringService = {
  list() {
    return recurringRepository.list();
  },

  async create(input: RecurringInput) {
    try {
      const start = fromDateKey(input.startDate);
      const today = fromDateKey(todayKey());
      const nextDate = start > today ? toDateKey(start) : toDateKey(start);
      const created = await recurringRepository.create(input, nextDate);
      await queueChange('recurring', created.id, 'create', created);
      await this.processDue();
      return recurringRepository.getById(created.id);
    } catch (error) {
      logError('recurring.create', error);
      throw new AppError('We could not save this recurring transaction.', error);
    }
  },

  async update(id: string, input: RecurringInput) {
    try {
      const start = fromDateKey(input.startDate);
      const nextDate = toDateKey(start);
      const updated = await recurringRepository.update(id, input, nextDate);
      await queueChange('recurring', updated.id, 'update', updated);
      await this.processDue();
      return recurringRepository.getById(id);
    } catch (error) {
      logError('recurring.update', error);
      throw new AppError('We could not update this recurring transaction.', error);
    }
  },

  async setActive(id: string, isActive: boolean) {
    await recurringRepository.setActive(id, isActive);
    const item = await recurringRepository.getById(id);
    if (item) await queueChange('recurring', id, 'update', item);
    if (isActive) {
      await this.processDue();
    }
  },

  async delete(id: string) {
    try {
      await recurringRepository.delete(id);
      await queueChange('recurring', id, 'delete', { id, deletedAt: nowIso() });
    } catch (error) {
      logError('recurring.delete', error);
      throw new AppError('We could not delete this recurring transaction.', error);
    }
  },

  async processDue(): Promise<number> {
    const today = todayKey();
    const due = await recurringRepository.listDue(today);
    let created = 0;

    for (const item of due) {
      const dates = dueOccurrences(fromDateKey(item.nextDate), item.frequency, fromDateKey(today));
      for (const date of dates) {
        const dateKey = toDateKey(date);
        const exists = await transactionRepository.existsForRecurringOnDate(item.id, dateKey);
        if (exists) {
          continue;
        }
        const generated = await transactionRepository.create({
          type: item.type,
          amount: item.amount,
          categoryId: item.categoryId,
          title: item.title,
          date: dateKey,
          paymentMethod: item.paymentMethod,
          notes: 'Generated from recurring transaction',
          isRecurring: true,
          recurringId: item.id,
          accountId: item.accountId,
        });
        await queueChange('transaction', generated.id, 'create', generated);
        created += 1;
      }
      const last = dates[dates.length - 1] ?? fromDateKey(item.nextDate);
      const next = addFrequency(last, item.frequency);
      await recurringRepository.setNextDate(item.id, toDateKey(next));
      const updated = await recurringRepository.getById(item.id);
      if (updated) await queueChange('recurring', updated.id, 'update', updated);
    }

    return created;
  },
};

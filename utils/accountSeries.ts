import { calculateAccountBalances, isLiabilityAccount, signedAccountDelta, type AccountLedgerEntry } from '@/utils/accountLogic';
import { percentChange } from '@/utils/calculations';
import { lastNDaysKeys } from '@/utils/dates';
import type { Account, AccountType } from '@/types';

export interface SeriesPoint {
  date: string;
  value: number;
}

export function isMeaningfulSeries(series: SeriesPoint[]): boolean {
  if (series.length < 2) return false;
  const first = series[0]?.value;
  return series.some((point) => point.value !== first);
}

export function accountBalanceSeries(
  account: Pick<Account, 'type' | 'openingBalance' | 'creditLimit'>,
  entries: Array<AccountLedgerEntry & { date: string }>,
  days = 14,
  from = new Date()
): SeriesPoint[] {
  const keys = lastNDaysKeys(days, from);
  const start = keys[0];
  if (!start) return [];
  const prior = entries.filter((item) => item.date < start);
  const startBalances = calculateAccountBalances(account, prior);
  let running = isLiabilityAccount(account.type) ? startBalances.outstanding : startBalances.currentBalance;
  const byDate = new Map<string, typeof entries>();
  for (const entry of entries) {
    if (entry.date < start) continue;
    const list = byDate.get(entry.date) ?? [];
    list.push(entry);
    byDate.set(entry.date, list);
  }

  return keys.map((date) => {
    const dayEntries = byDate.get(date) ?? [];
    const movement = dayEntries.reduce((sum, entry) => sum + signedAccountDelta(account.type, entry), 0);
    running += movement;
    if (isLiabilityAccount(account.type)) running = Math.max(0, running);
    return { date, value: running };
  });
}

export function seriesTrendPercent(series: SeriesPoint[]): number | null {
  if (!isMeaningfulSeries(series)) return null;
  const first = series[0]?.value ?? 0;
  const last = series[series.length - 1]?.value ?? 0;
  return percentChange(last, first);
}

export function visualizationForAccount(type: AccountType): 'credit-utilization' | 'balance-trend' {
  return isLiabilityAccount(type) ? 'credit-utilization' : 'balance-trend';
}

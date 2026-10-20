/// <reference types="jest" />

jest.mock('@/utils/id', () => ({ createId: () => '11111111-1111-4111-8111-111111111111' }));

import type { AiSafeFinancialSnapshot } from '@/services/financialIntelligence';
import { AI_REQUEST_MAX_UTF8_BYTES } from '@/services/aiAssistant/constants';
import { AiClientError } from '@/services/aiAssistant/errors';
import {
  buildBudgetSuggestionsRequest,
  buildCategorizeMerchantRequest,
  buildMonthlySummaryRequest,
  serializeAiRequest,
} from '@/services/aiAssistant/buildRequests';
import { utf8ByteLength } from '@/services/aiAssistant/redactFinancialText';

const CONSENT = { cloudAi: true as const, policyVersion: 1 as const };

function aiSafeSnapshot(overrides: Partial<AiSafeFinancialSnapshot> = {}): AiSafeFinancialSnapshot {
  const base: AiSafeFinancialSnapshot = {
    schemaVersion: 1,
    kind: 'ai_safe',
    snapshotId: 'snap_abcd1234_0',
    snapshotComputedAt: '2026-10-18T12:00:00.000Z',
    financeRevision: 0,
    contentRevision: 'abcd1234',
    currency: 'INR',
    period: { month: 9, year: 2026 },
    periodStatus: 'completed',
    overallBudget: { amountMinor: 7_000_000, source: 'budget_row' },
    totals: {
      incomeMinor: 8_000_000,
      expenseMinor: 5_000_000,
      netMinor: 3_000_000,
      savingsRatePercent: 38,
      averageDailyExpenseMinor: 166667,
      averageDailyMethod: 'full_month',
      projectedMonthEndExpenseMinor: null,
      projectedMonthEndMethod: 'unavailable',
      expenseDayCount: 10,
      divisorDays: 30,
    },
    previousPeriod: null,
    topCategories: [
      {
        categoryId: 'food',
        categoryName: 'Food',
        amountMinor: 1_000_000,
        percent: 20,
        transactionCount: 4,
      },
    ],
    budgets: [],
    trends: [],
    recurringPatterns: [],
    anomalies: [],
    budgetBaseline: {
      lookbackMonths: 3,
      overall: {
        currentBudgetMinor: 7_000_000,
        averageSpendMinor: 4_500_000,
        medianSpendMinor: 4_400_000,
        source: 'budget_row',
      },
      categories: [],
    },
    flags: {
      hasIncome: true,
      hasExpenses: true,
      transferExcluded: true,
      insufficientData: false,
    },
    dataQuality: {
      skippedDeletedTransactions: 0,
      skippedInvalidTransactions: 0,
      skippedDeletedBudgets: 0,
      skippedInvalidBudgets: 0,
      skippedDeletedCategories: 0,
      unknownCategoryBuckets: 0,
      assumedSingleCurrency: true,
      assumedUserScopedInputs: true,
    },
    truncation: {
      truncated: false,
      utf8Bytes: 1000,
      maxUtf8Bytes: 8192,
      dropped: {},
      exceededLimit: false,
      reason: null,
    },
  };
  return { ...base, ...overrides };
}

describe('AI-safe request builders', () => {
  it('builds monthly_summary with allowlisted fields only', () => {
    const body = buildMonthlySummaryRequest({
      snapshot: aiSafeSnapshot(),
      locale: 'en-IN',
      consent: CONSENT,
    });
    expect(body.capability).toBe('monthly_summary');
    expect(body.consent).toEqual(CONSENT);
    expect(body.snapshot.kind).toBe('ai_safe');
    const keys = Object.keys(body).sort();
    expect(keys).toEqual([
      'capability',
      'consent',
      'currency',
      'locale',
      'requestId',
      'schemaVersion',
      'snapshot',
    ]);
    const json = serializeAiRequest(body);
    expect(json).not.toMatch(/userId|accessToken|refreshToken|"notes"|"title"|transactionId/i);
  });

  it('builds budget_suggestions capability', () => {
    const body = buildBudgetSuggestionsRequest({
      snapshot: aiSafeSnapshot(),
      locale: 'en-IN',
      consent: CONSENT,
    });
    expect(body.capability).toBe('budget_suggestions');
  });

  it('builds categorize_merchant with redacted merchant and amount bucket', () => {
    const body = buildCategorizeMerchantRequest({
      merchantText: 'CITY CAFE alice@example.com',
      descriptionText: 'lunch',
      paymentMethod: 'upi',
      amountMinor: 750,
      candidates: [
        { categoryId: 'misc', categoryName: 'Misc' },
        { categoryId: 'food', categoryName: 'Food' },
      ],
      locale: 'en-IN',
      currency: 'INR',
      consent: CONSENT,
      snapshotId: 'snap_abcd1234_0',
      snapshotComputedAt: '2026-10-18T12:00:00.000Z',
    });
    expect(body.capability).toBe('categorize_merchant');
    expect(body.payload.merchantLabelRedacted).toContain('[REDACTED_EMAIL]');
    expect(body.payload.amountBucket).toBe('b500_2k');
    expect(body.payload.candidates.map((c) => c.categoryId)).toEqual(['food', 'misc']);
    expect(body.payload).not.toHaveProperty('notes');
  });

  it('uses stable candidate ordering', () => {
    const a = buildCategorizeMerchantRequest({
      merchantText: 'Cafe',
      amountBucket: 'b0_500',
      candidates: [
        { categoryId: 'z', categoryName: 'Z' },
        { categoryId: 'a', categoryName: 'A' },
      ],
      locale: 'en-IN',
      currency: 'INR',
      consent: CONSENT,
      snapshotId: 'snap_a',
      snapshotComputedAt: '2026-10-18T12:00:00.000Z',
    });
    const b = buildCategorizeMerchantRequest({
      merchantText: 'Cafe',
      amountBucket: 'b0_500',
      candidates: [
        { categoryId: 'a', categoryName: 'A' },
        { categoryId: 'z', categoryName: 'Z' },
      ],
      locale: 'en-IN',
      currency: 'INR',
      consent: CONSENT,
      snapshotId: 'snap_a',
      snapshotComputedAt: '2026-10-18T12:00:00.000Z',
    });
    expect(a.payload.candidates).toEqual(b.payload.candidates);
  });

  it('rejects oversized requests rather than truncating', () => {
    const hugeName = 'X'.repeat(400);
    const categories = Array.from({ length: 40 }, (_, i) => ({
      categoryId: `cat_${i}_${hugeName}`,
      categoryName: hugeName,
      amountMinor: 1,
      percent: 1,
      transactionCount: 1,
    }));
    expect(() =>
      buildMonthlySummaryRequest({
        snapshot: aiSafeSnapshot({
          topCategories: categories,
          budgetBaseline: {
            lookbackMonths: 3,
            overall: {
              currentBudgetMinor: 1,
              averageSpendMinor: 1,
              medianSpendMinor: 1,
              source: 'budget_row',
            },
            categories: Array.from({ length: 30 }, (_, i) => ({
              categoryId: `b_${i}_${hugeName}`,
              categoryName: hugeName,
              averageSpendMinor: 1,
              medianSpendMinor: 1,
              currentBudgetMinor: null,
              volatility: 'low' as const,
              monthsWithSpend: 1,
            })),
          },
        }),
        locale: 'en-IN',
        consent: CONSENT,
      })
    ).toThrow(AiClientError);
  });

  it('rejects invalid enums and non-finite numbers', () => {
    expect(() =>
      buildCategorizeMerchantRequest({
        merchantText: 'Cafe',
        amountBucket: 'nope' as never,
        candidates: [{ categoryId: 'food', categoryName: 'Food' }],
        locale: 'en-IN',
        currency: 'INR',
        consent: CONSENT,
        snapshotId: 'snap_a',
        snapshotComputedAt: '2026-10-18T12:00:00.000Z',
      })
    ).toThrow(/amountBucket/);

    expect(() =>
      buildMonthlySummaryRequest({
        snapshot: aiSafeSnapshot({
          totals: {
            ...aiSafeSnapshot().totals,
            incomeMinor: Number.NaN as unknown as number,
          },
        }),
        locale: 'en-IN',
        consent: CONSENT,
      })
    ).toThrow(AiClientError);
  });

  it('rejects missing consent contract', () => {
    expect(() =>
      buildMonthlySummaryRequest({
        snapshot: aiSafeSnapshot(),
        locale: 'en-IN',
        consent: { cloudAi: true, policyVersion: 2 } as never,
      })
    ).toThrow(/consent/);
  });

  it('keeps serialized size under the documented 8 KiB for a normal snapshot', () => {
    const body = buildMonthlySummaryRequest({
      snapshot: aiSafeSnapshot(),
      locale: 'en-IN',
      consent: CONSENT,
    });
    expect(utf8ByteLength(serializeAiRequest(body))).toBeLessThanOrEqual(AI_REQUEST_MAX_UTF8_BYTES);
  });
});

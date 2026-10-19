/// <reference types="jest" />
import { extractBearerToken } from '../supabase/functions/financial-assistant/auth';
import { handleFinancialAssistantRequest } from '../supabase/functions/financial-assistant/handler';
import { collectProhibitedPaths, looksUnredacted, utf8ByteLength } from '../supabase/functions/financial-assistant/privacy';
import { UnavailableFinancialAiProvider } from '../supabase/functions/financial-assistant/provider';
import { resetRateLimitForTests } from '../supabase/functions/financial-assistant/rateLimit';
import { MAX_REQUEST_UTF8_BYTES } from '../supabase/functions/financial-assistant/constants';
import { parseAndValidateRequest } from '../supabase/functions/financial-assistant/validateRequest';
import type { FinancialAiProvider } from '../supabase/functions/financial-assistant/provider';

const USER_JWT = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyLTEifQ.sig';

function aiSafeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function summaryBody(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    requestId: '11111111-1111-4111-8111-111111111111',
    capability: 'monthly_summary',
    locale: 'en-IN',
    currency: 'INR',
    snapshot: aiSafeSnapshot(),
    ...overrides,
  };
}

async function invoke(
  body: unknown,
  options: {
    auth?: string | null;
    provider?: FinancialAiProvider;
    userId?: string | null;
    env?: Record<string, string>;
  } = {}
) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const req = new Request('http://localhost/functions/v1/financial-assistant', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.auth === null
        ? {}
        : { Authorization: options.auth ?? `Bearer ${USER_JWT}` }),
    },
    body: raw,
  });

  return handleFinancialAssistantRequest(req, {
    getEnv: (key) => options.env?.[key] ?? (key === 'FINANCIAL_AI_PROVIDER' ? 'unavailable' : undefined),
    getUserFromJwt: async () =>
      options.userId === null ? null : { id: options.userId ?? 'user-1' },
    provider: options.provider,
    now: () => new Date('2026-10-19T12:00:00.000Z'),
  });
}

beforeEach(() => {
  resetRateLimitForTests();
});

describe('privacy guards', () => {
  it('flags prohibited keys including transactions and titles', () => {
    expect(collectProhibitedPaths({ snapshot: { title: 'x', transactions: [] } })).toEqual(
      expect.arrayContaining(['$.snapshot.title', '$.snapshot.transactions'])
    );
  });

  it('detects unredacted merchant labels', () => {
    expect(looksUnredacted('CITY CAFE')).toBe(false);
    expect(looksUnredacted('user@okhdfcbank')).toBe(true);
    expect(looksUnredacted('card 4111111111111111')).toBe(true);
    expect(looksUnredacted('see https://evil.example')).toBe(true);
  });
});

describe('parseAndValidateRequest', () => {
  it('accepts AiSafeFinancialSnapshot for monthly_summary', () => {
    const parsed = parseAndValidateRequest(JSON.stringify(summaryBody()));
    expect(parsed.capability).toBe('monthly_summary');
    if (parsed.capability === 'monthly_summary') {
      expect(parsed.snapshot.kind).toBe('ai_safe');
    }
  });

  it('rejects LocalFinancialSnapshot', () => {
    expect(() =>
      parseAndValidateRequest(
        JSON.stringify(
          summaryBody({
            snapshot: aiSafeSnapshot({ kind: 'local' }),
          })
        )
      )
    ).toThrow(/LocalFinancialSnapshot|ai_safe/);
  });

  it('rejects prohibited raw fields and oversized bodies', () => {
    expect(() =>
      parseAndValidateRequest(
        JSON.stringify(
          summaryBody({
            snapshot: aiSafeSnapshot({ title: 'CITY CAFE' }),
          })
        )
      )
    ).toThrow(/Prohibited/);

    const huge = 'x'.repeat(MAX_REQUEST_UTF8_BYTES + 10);
    expect(() => parseAndValidateRequest(huge)).toThrow(/UTF-8/);
  });

  it('validates categorize_merchant minimal redacted contract', () => {
    const parsed = parseAndValidateRequest(
      JSON.stringify({
        schemaVersion: 1,
        requestId: '33333333-3333-4333-8333-333333333333',
        capability: 'categorize_merchant',
        locale: 'en-IN',
        currency: 'INR',
        snapshotId: '44444444-4444-4444-8444-444444444444',
        snapshotComputedAt: '2026-10-18T12:05:00.000Z',
        payload: {
          merchantLabelRedacted: 'CITY CAFE',
          paymentMethod: 'upi',
          amountBucket: 'b500_2k',
          candidates: [
            { categoryId: 'food', categoryName: 'Food' },
            { categoryId: 'misc', categoryName: 'Miscellaneous' },
          ],
        },
      })
    );
    expect(parsed.capability).toBe('categorize_merchant');
  });

  it('rejects categorize payloads that still look unredacted', () => {
    expect(() =>
      parseAndValidateRequest(
        JSON.stringify({
          schemaVersion: 1,
          requestId: '33333333-3333-4333-8333-333333333333',
          capability: 'categorize_merchant',
          locale: 'en-IN',
          currency: 'INR',
          snapshotId: '44444444-4444-4444-8444-444444444444',
          snapshotComputedAt: '2026-10-18T12:05:00.000Z',
          payload: {
            merchantLabelRedacted: 'pay@okhdfcbank',
            amountBucket: 'b500_2k',
            candidates: [{ categoryId: 'food', categoryName: 'Food' }],
          },
        })
      )
    ).toThrow(/redaction/);
  });
});

describe('handleFinancialAssistantRequest', () => {
  it('requires a user JWT', async () => {
    const res = await invoke(summaryBody(), { auth: null });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe('auth');
  });

  it('rejects API keys used as bearer tokens', () => {
    expect(() => extractBearerToken('Bearer sb_secret_test')).toThrow(/user session JWT/);
  });

  it('returns provider_unavailable with the default stub provider', async () => {
    const res = await invoke(summaryBody());
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error.code).toBe('provider_unavailable');
    expect(json.requestId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('does not call provider when monthly_summary lacks expenses', async () => {
    const provider: FinancialAiProvider = {
      id: 'mock',
      generateMonthlySummary: jest.fn(),
      suggestBudgets: jest.fn(),
      categorizeMerchant: jest.fn(),
    };
    const res = await invoke(
      summaryBody({
        snapshot: aiSafeSnapshot({
          flags: {
            hasIncome: true,
            hasExpenses: false,
            transferExcluded: true,
            insufficientData: true,
          },
        }),
      }),
      { provider }
    );
    expect(res.status).toBe(400);
    expect(provider.generateMonthlySummary).not.toHaveBeenCalled();
  });

  it('returns success when a mock provider is injected', async () => {
    const provider: FinancialAiProvider = {
      id: 'mock',
      async generateMonthlySummary() {
        return {
          headline: 'Steady month',
          bullets: ['Expenses tracked'],
          interpretations: [],
          suggestedActions: [],
          confidence: 0.7,
        };
      },
      suggestBudgets: jest.fn(),
      categorizeMerchant: jest.fn(),
    };
    const res = await invoke(summaryBody(), { provider });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.headline).toBe('Steady month');
    expect(json.stale).toBe(false);
    expect(utf8ByteLength(JSON.stringify(json))).toBeLessThanOrEqual(16 * 1024);
  });

  it('filters categorize suggestions to candidates only', async () => {
    const provider: FinancialAiProvider = {
      id: 'mock',
      generateMonthlySummary: jest.fn(),
      suggestBudgets: jest.fn(),
      async categorizeMerchant() {
        return {
          suggestions: [
            { categoryId: 'food', confidence: 0.9, reason: 'Cafe pattern' },
            { categoryId: 'injected', confidence: 0.99, reason: 'Should drop' },
          ],
        };
      },
    };
    const res = await invoke(
      {
        schemaVersion: 1,
        requestId: '33333333-3333-4333-8333-333333333333',
        capability: 'categorize_merchant',
        locale: 'en-IN',
        currency: 'INR',
        snapshotId: '44444444-4444-4444-8444-444444444444',
        snapshotComputedAt: '2026-10-18T12:05:00.000Z',
        payload: {
          merchantLabelRedacted: 'CITY CAFE',
          amountBucket: 'b500_2k',
          candidates: [{ categoryId: 'food', categoryName: 'Food' }],
        },
      },
      { provider }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.suggestions).toEqual([
      expect.objectContaining({ categoryId: 'food' }),
    ]);
  });

  it('rate limits repeated calls for the same user', async () => {
    for (let i = 0; i < 20; i += 1) {
      const res = await invoke(summaryBody(), { provider: new UnavailableFinancialAiProvider() });
      expect([503, 429]).toContain(res.status);
    }
    const limited = await invoke(summaryBody(), { provider: new UnavailableFinancialAiProvider() });
    expect(limited.status).toBe(429);
    const json = await limited.json();
    expect(json.error.code).toBe('rate_limit');
  });
});

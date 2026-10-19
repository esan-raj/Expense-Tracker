/// <reference types="jest" />
import { extractBearerToken } from '../supabase/functions/financial-assistant/auth';
import { buildCorsHeaders } from '../supabase/functions/financial-assistant/cors';
import { handleFinancialAssistantRequest } from '../supabase/functions/financial-assistant/handler';
import { collectProhibitedPaths, looksUnredacted, utf8ByteLength } from '../supabase/functions/financial-assistant/privacy';
import { UnavailableFinancialAiProvider } from '../supabase/functions/financial-assistant/provider';
import { resetRateLimitForTests } from '../supabase/functions/financial-assistant/rateLimit';
import { MAX_REQUEST_UTF8_BYTES } from '../supabase/functions/financial-assistant/constants';
import { withProviderTimeout } from '../supabase/functions/financial-assistant/timeout';
import { parseAndValidateRequest } from '../supabase/functions/financial-assistant/validateRequest';
import {
  validateBudgetSuggestionResult,
  validateMerchantCategorisationResult,
  validateMonthlySummaryResult,
} from '../supabase/functions/financial-assistant/validateResponse';
import type { FinancialAiProvider } from '../supabase/functions/financial-assistant/provider';
import type { AiSafeSnapshotWire } from '../supabase/functions/financial-assistant/types';

/**
 * Synthetic three-segment bearer for auth shape tests only.
 * Intentionally not a real JWT / not base64url — avoids secret-scanner false positives.
 */
const SYNTHETIC_BEARER = 'test-header.test-payload.test-signature';

const NOW_MS = Date.parse('2026-10-19T12:00:00.000Z');

function aiSafeSnapshot(overrides: Record<string, unknown> = {}): AiSafeSnapshotWire {
  const base: AiSafeSnapshotWire = {
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
      categories: [
        {
          categoryId: 'food',
          categoryName: 'Food',
          averageSpendMinor: 900_000,
          medianSpendMinor: 850_000,
          currentBudgetMinor: 1_000_000,
          volatility: 'medium',
          monthsWithSpend: 3,
        },
      ],
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
  return { ...base, ...overrides } as AiSafeSnapshotWire;
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
    method?: string;
    contentType?: string | null;
    origin?: string;
    providerTimeoutMs?: number;
  } = {}
) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const headers: Record<string, string> = {};
  if (options.contentType !== null) {
    headers['Content-Type'] = options.contentType ?? 'application/json';
  }
  if (options.auth !== null) {
    headers.Authorization = options.auth ?? `Bearer ${SYNTHETIC_BEARER}`;
  }
  if (options.origin) {
    headers.Origin = options.origin;
  }

  const req = new Request('http://localhost/functions/v1/financial-assistant', {
    method: options.method ?? 'POST',
    headers,
    body: options.method === 'GET' || options.method === 'OPTIONS' ? undefined : raw,
  });

  return handleFinancialAssistantRequest(req, {
    getEnv: (key) =>
      options.env?.[key] ??
      (key === 'FINANCIAL_AI_PROVIDER'
        ? 'unavailable'
        : key === 'FINANCIAL_AI_CORS_ORIGINS'
          ? 'https://app.spendwise.example'
          : undefined),
    getUserFromJwt: async () =>
      options.userId === null ? null : { id: options.userId ?? 'user-1' },
    provider: options.provider,
    now: () => new Date(NOW_MS),
    providerTimeoutMs: options.providerTimeoutMs,
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
    const parsed = parseAndValidateRequest(JSON.stringify(summaryBody()), NOW_MS);
    expect(parsed.capability).toBe('monthly_summary');
    if (parsed.capability === 'monthly_summary') {
      expect(parsed.snapshot.kind).toBe('ai_safe');
    }
  });

  it('rejects LocalFinancialSnapshot', () => {
    expect(() =>
      parseAndValidateRequest(
        JSON.stringify(summaryBody({ snapshot: aiSafeSnapshot({ kind: 'local' }) })),
        NOW_MS
      )
    ).toThrow(/LocalFinancialSnapshot|ai_safe|unknown fields/);
  });

  it('rejects prohibited raw fields and oversized bodies', () => {
    expect(() =>
      parseAndValidateRequest(
        JSON.stringify(summaryBody({ snapshot: { ...aiSafeSnapshot(), title: 'CITY CAFE' } })),
        NOW_MS
      )
    ).toThrow(/Prohibited|unknown fields/);

    const huge = 'x'.repeat(MAX_REQUEST_UTF8_BYTES + 10);
    expect(() => parseAndValidateRequest(huge, NOW_MS)).toThrow(/UTF-8/);
  });

  it('rejects arbitrary unknown snapshot fields', () => {
    expect(() =>
      parseAndValidateRequest(
        JSON.stringify(
          summaryBody({
            snapshot: { ...aiSafeSnapshot(), extraLeak: 'secret-account' },
          })
        ),
        NOW_MS
      )
    ).toThrow(/unknown fields/);
  });

  it('rejects malformed totals and unsafe integers', () => {
    expect(() =>
      parseAndValidateRequest(
        JSON.stringify(
          summaryBody({
            snapshot: aiSafeSnapshot({
              totals: {
                ...aiSafeSnapshot().totals,
                expenseMinor: Number.MAX_SAFE_INTEGER + 1,
              },
            }),
          })
        ),
        NOW_MS
      )
    ).toThrow(/safe integer/);

    expect(() =>
      parseAndValidateRequest(
        JSON.stringify(
          summaryBody({
            snapshot: aiSafeSnapshot({
              topCategories: 'not-an-array',
            }),
          })
        ),
        NOW_MS
      )
    ).toThrow(/array/);
  });

  it('rejects future snapshot timestamps', () => {
    expect(() =>
      parseAndValidateRequest(
        JSON.stringify(
          summaryBody({
            snapshot: aiSafeSnapshot({
              snapshotComputedAt: '2099-01-01T00:00:00.000Z',
            }),
          })
        ),
        NOW_MS
      )
    ).toThrow(/future/);
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
      }),
      NOW_MS
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
        }),
        NOW_MS
      )
    ).toThrow(/redaction/);
  });
});

describe('model output validation (fail closed)', () => {
  const snapshot = aiSafeSnapshot();

  it('rejects invalid confidence instead of clamping', () => {
    expect(() =>
      validateMonthlySummaryResult(
        {
          headline: 'ok',
          bullets: ['a'],
          interpretations: [],
          suggestedActions: [],
          confidence: 1.5,
        },
        snapshot
      )
    ).toThrow(/confidence/);
  });

  it('rejects oversized model text instead of truncating', () => {
    expect(() =>
      validateMonthlySummaryResult(
        {
          headline: 'x'.repeat(121),
          bullets: ['a'],
          interpretations: [],
          suggestedActions: [],
          confidence: 0.5,
        },
        snapshot
      )
    ).toThrow(/exceeds/);
  });

  it('rejects invalid action kinds and unknown category IDs', () => {
    expect(() =>
      validateMonthlySummaryResult(
        {
          headline: 'ok',
          bullets: ['a'],
          interpretations: [],
          suggestedActions: [
            { id: 'x', label: 'Go', kind: 'delete_ledger', categoryId: 'food' },
          ],
          confidence: 0.5,
        },
        snapshot
      )
    ).toThrow(/kind/);

    expect(() =>
      validateMonthlySummaryResult(
        {
          headline: 'ok',
          bullets: ['a'],
          interpretations: [],
          suggestedActions: [
            { id: 'x', label: 'Go', kind: 'review_category', categoryId: 'invented' },
          ],
          confidence: 0.5,
        },
        snapshot
      )
    ).toThrow(/categoryId/);
  });

  it('requires explicit confirmation flag on budget recommendations', () => {
    expect(() =>
      validateBudgetSuggestionResult(
        {
          categories: [],
          caveats: [],
        },
        snapshot
      )
    ).toThrow(/requiresConfirmation/);
  });

  it('rejects invented merchant categories instead of silently dropping them', () => {
    expect(() =>
      validateMerchantCategorisationResult(
        {
          suggestions: [
            { categoryId: 'food', confidence: 0.9, reason: 'Cafe pattern' },
            { categoryId: 'injected', confidence: 0.99, reason: 'Should fail closed' },
          ],
        },
        {
          merchantLabelRedacted: 'CITY CAFE',
          amountBucket: 'b500_2k',
          candidates: [{ categoryId: 'food', categoryName: 'Food' }],
        }
      )
    ).toThrow(/not in candidates/);
  });
});

describe('handleFinancialAssistantRequest', () => {
  it('requires a user bearer token', async () => {
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

  it('rejects categorize responses that invent categories', async () => {
    const provider: FinancialAiProvider = {
      id: 'mock',
      generateMonthlySummary: jest.fn(),
      suggestBudgets: jest.fn(),
      async categorizeMerchant() {
        return {
          suggestions: [
            { categoryId: 'food', confidence: 0.9, reason: 'Cafe pattern' },
            { categoryId: 'injected', confidence: 0.99, reason: 'Should fail' },
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
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error.code).toBe('invalid_model_output');
  });

  it('enforces provider timeout', async () => {
    const provider: FinancialAiProvider = {
      id: 'slow',
      async generateMonthlySummary() {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          headline: 'late',
          bullets: ['x'],
          interpretations: [],
          suggestedActions: [],
          confidence: 0.5,
        };
      },
      suggestBudgets: jest.fn(),
      categorizeMerchant: jest.fn(),
    };
    const res = await invoke(summaryBody(), { provider, providerTimeoutMs: 5 });
    expect(res.status).toBe(504);
    const json = await res.json();
    expect(json.error.code).toBe('timeout');
  });

  it('does not permit wildcard CORS', () => {
    const headers = buildCorsHeaders('https://evil.example', 'https://app.spendwise.example');
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    const allowed = buildCorsHeaders('https://app.spendwise.example', 'https://app.spendwise.example');
    expect(allowed['Access-Control-Allow-Origin']).toBe('https://app.spendwise.example');
    expect(JSON.stringify(buildCorsHeaders(null, '*'))).not.toContain('"*"');
  });

  it('returns 405 for unsupported methods', async () => {
    const res = await invoke(summaryBody(), { method: 'GET' });
    expect(res.status).toBe(405);
  });

  it('rejects invalid content type', async () => {
    const res = await invoke(summaryBody(), { contentType: 'text/plain' });
    expect(res.status).toBe(415);
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

describe('withProviderTimeout', () => {
  it('resolves when the provider finishes in time', async () => {
    await expect(withProviderTimeout(Promise.resolve(1), 100)).resolves.toBe(1);
  });
});

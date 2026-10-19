/// <reference types="jest" />
import { extractBearerToken } from '../supabase/functions/financial-assistant/auth';
import { evaluateRequestOrigin, parseCorsAllowlist } from '../supabase/functions/financial-assistant/cors';
import { handleFinancialAssistantRequest } from '../supabase/functions/financial-assistant/handler';
import {
  collectProhibitedPaths,
  looksUnredacted,
  utf8ByteLength,
} from '../supabase/functions/financial-assistant/privacy';
import { UnavailableFinancialAiProvider } from '../supabase/functions/financial-assistant/provider';
import { resetRateLimitForTests } from '../supabase/functions/financial-assistant/rateLimit';
import { MAX_REQUEST_UTF8_BYTES } from '../supabase/functions/financial-assistant/constants';
import { runWithProviderTimeout } from '../supabase/functions/financial-assistant/timeout';
import { parseAndValidateRequest } from '../supabase/functions/financial-assistant/validateRequest';
import {
  validateBudgetSuggestionResult,
  validateMerchantCategorisationResult,
  validateMonthlySummaryResult,
} from '../supabase/functions/financial-assistant/validateResponse';
import type { FinancialAiProvider } from '../supabase/functions/financial-assistant/provider';
import type {
  AiSafeSnapshotWire,
  ProviderRequestContext,
} from '../supabase/functions/financial-assistant/types';

/**
 * Synthetic three-segment bearer for auth shape tests only.
 * Intentionally not a real JWT / not base64url — avoids secret-scanner false positives.
 */
const SYNTHETIC_BEARER = 'test-header.test-payload.test-signature';

const NOW_MS = Date.parse('2026-10-19T12:00:00.000Z');
const CONSENT = { cloudAi: true as const, policyVersion: 1 as const };

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
      {
        categoryId: 'rent',
        categoryName: 'Rent',
        amountMinor: 2_000_000,
        percent: 40,
        transactionCount: 1,
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
        {
          categoryId: 'rent',
          categoryName: 'Rent',
          averageSpendMinor: 2_000_000,
          medianSpendMinor: 2_000_000,
          currentBudgetMinor: 2_000_000,
          volatility: 'low',
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
    consent: CONSENT,
    snapshot: aiSafeSnapshot(),
    ...overrides,
  };
}

function categorizeBody(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    requestId: '33333333-3333-4333-8333-333333333333',
    capability: 'categorize_merchant',
    locale: 'en-IN',
    currency: 'INR',
    consent: CONSENT,
    snapshotId: '44444444-4444-4444-8444-444444444444',
    snapshotComputedAt: '2026-10-18T12:05:00.000Z',
    payload: {
      merchantLabelRedacted: 'CITY CAFE',
      amountBucket: 'b500_2k',
      candidates: [
        { categoryId: 'food', categoryName: 'Food' },
        { categoryId: 'misc', categoryName: 'Miscellaneous' },
      ],
    },
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

function assertNoSensitiveLeak(text: string): void {
  expect(text).not.toMatch(/sb_secret_|service_role|SUPABASE_SERVICE/i);
  expect(text).not.toMatch(/pay@okhdfcbank|4111111111111111/);
  expect(text).not.toMatch(/sampleTitle|titleKey|"transactions"/);
}

beforeEach(() => {
  resetRateLimitForTests();
  jest.useRealTimers();
});

afterEach(() => {
  jest.useRealTimers();
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
  });
});

describe('consent contract', () => {
  it('rejects missing consent', () => {
    const body = summaryBody();
    delete (body as { consent?: unknown }).consent;
    expect(() => parseAndValidateRequest(JSON.stringify(body), NOW_MS)).toThrow(/consent/);
  });

  it('rejects consent.cloudAi false', () => {
    expect(() =>
      parseAndValidateRequest(
        JSON.stringify(summaryBody({ consent: { cloudAi: false, policyVersion: 1 } })),
        NOW_MS
      )
    ).toThrow(/cloudAi/);
  });

  it('rejects unsupported policy version', () => {
    expect(() =>
      parseAndValidateRequest(
        JSON.stringify(summaryBody({ consent: { cloudAi: true, policyVersion: 99 } })),
        NOW_MS
      )
    ).toThrow(/policyVersion/);
  });

  it('rejects unknown consent fields', () => {
    expect(() =>
      parseAndValidateRequest(
        JSON.stringify(
          summaryBody({
            consent: { cloudAi: true, policyVersion: 1, extra: true },
          })
        ),
        NOW_MS
      )
    ).toThrow(/unknown fields/);
  });
});

describe('parseAndValidateRequest', () => {
  it('accepts AiSafeFinancialSnapshot for monthly_summary', () => {
    const parsed = parseAndValidateRequest(JSON.stringify(summaryBody()), NOW_MS);
    expect(parsed.capability).toBe('monthly_summary');
    expect(parsed.consent).toEqual(CONSENT);
  });

  it('rejects LocalFinancialSnapshot', () => {
    expect(() =>
      parseAndValidateRequest(
        JSON.stringify(summaryBody({ snapshot: aiSafeSnapshot({ kind: 'local' }) })),
        NOW_MS
      )
    ).toThrow(/LocalFinancialSnapshot|ai_safe|unknown fields/);
  });

  it('rejects prohibited raw fields, oversized bodies, unknown fields, unsafe integers, future timestamps', () => {
    expect(() =>
      parseAndValidateRequest(
        JSON.stringify(summaryBody({ snapshot: { ...aiSafeSnapshot(), title: 'CITY CAFE' } })),
        NOW_MS
      )
    ).toThrow(/Prohibited|unknown fields/);

    expect(() => parseAndValidateRequest('x'.repeat(MAX_REQUEST_UTF8_BYTES + 10), NOW_MS)).toThrow(
      /UTF-8/
    );

    expect(() =>
      parseAndValidateRequest(
        JSON.stringify(summaryBody({ snapshot: { ...aiSafeSnapshot(), extraLeak: 'x' } })),
        NOW_MS
      )
    ).toThrow(/unknown fields/);

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
            snapshot: aiSafeSnapshot({ snapshotComputedAt: '2099-01-01T00:00:00.000Z' }),
          })
        ),
        NOW_MS
      )
    ).toThrow(/future/);
  });

  it('validates categorize_merchant contract and rejects unredacted labels', () => {
    expect(parseAndValidateRequest(JSON.stringify(categorizeBody()), NOW_MS).capability).toBe(
      'categorize_merchant'
    );
    expect(() =>
      parseAndValidateRequest(
        JSON.stringify(
          categorizeBody({
            payload: {
              merchantLabelRedacted: 'pay@okhdfcbank',
              amountBucket: 'b500_2k',
              candidates: [{ categoryId: 'food', categoryName: 'Food' }],
            },
          })
        ),
        NOW_MS
      )
    ).toThrow(/redaction/);
  });
});

describe('model output validation (fail closed)', () => {
  const snapshot = aiSafeSnapshot();

  it('rejects invalid confidence, oversized text, bad kinds, unknown IDs', () => {
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

    expect(() =>
      validateMonthlySummaryResult(
        {
          headline: 'ok',
          bullets: ['a'],
          interpretations: [],
          suggestedActions: [{ id: 'x', label: 'Go', kind: 'delete_ledger' }],
          confidence: 0.5,
        },
        snapshot
      )
    ).toThrow(/kind/);
  });

  it('requires requiresConfirmation and rejects duplicate budget category IDs', () => {
    expect(() =>
      validateBudgetSuggestionResult({ categories: [], caveats: [] }, snapshot)
    ).toThrow(/requiresConfirmation/);

    expect(() =>
      validateBudgetSuggestionResult(
        {
          requiresConfirmation: true,
          categories: [
            { categoryId: 'food', recommendedMinor: 1, rationale: 'a', confidence: 0.5 },
            { categoryId: 'food', recommendedMinor: 2, rationale: 'b', confidence: 0.6 },
          ],
          caveats: [],
        },
        snapshot
      )
    ).toThrow(/duplicate/);
  });

  it('rejects duplicate and unknown categorization IDs; orders ties by categoryId', () => {
    expect(() =>
      validateMerchantCategorisationResult(
        {
          suggestions: [
            { categoryId: 'food', confidence: 0.9, reason: 'a' },
            { categoryId: 'food', confidence: 0.8, reason: 'b' },
          ],
        },
        {
          merchantLabelRedacted: 'CITY CAFE',
          amountBucket: 'b500_2k',
          candidates: [
            { categoryId: 'food', categoryName: 'Food' },
            { categoryId: 'misc', categoryName: 'Miscellaneous' },
          ],
        }
      )
    ).toThrow(/duplicate/);

    expect(() =>
      validateMerchantCategorisationResult(
        {
          suggestions: [{ categoryId: 'injected', confidence: 0.9, reason: 'x' }],
        },
        {
          merchantLabelRedacted: 'CITY CAFE',
          amountBucket: 'b500_2k',
          candidates: [{ categoryId: 'food', categoryName: 'Food' }],
        }
      )
    ).toThrow(/not in candidates/);

    const ordered = validateMerchantCategorisationResult(
      {
        suggestions: [
          { categoryId: 'misc', confidence: 0.5, reason: 'm' },
          { categoryId: 'food', confidence: 0.5, reason: 'f' },
        ],
      },
      {
        merchantLabelRedacted: 'CITY CAFE',
        amountBucket: 'b500_2k',
        candidates: [
          { categoryId: 'food', categoryName: 'Food' },
          { categoryId: 'misc', categoryName: 'Miscellaneous' },
        ],
      }
    );
    expect(ordered.suggestions.map((item) => item.categoryId)).toEqual(['food', 'misc']);
  });
});

describe('runWithProviderTimeout cancellation lifecycle', () => {
  it('passes signal and deadline to successful provider work', async () => {
    const now = 1_000_000;
    let seen: { signal?: AbortSignal; deadlineMs?: number } = {};
    const value = await runWithProviderTimeout(
      async ({ signal, deadlineMs }) => {
        seen = { signal, deadlineMs };
        expect(signal.aborted).toBe(false);
        return 42;
      },
      5_000,
      now
    );
    expect(value).toBe(42);
    expect(seen.deadlineMs).toBe(now + 5_000);
    expect(seen.signal?.aborted).toBe(false);
  });

  it('aborts the signal on timeout; late resolve/reject are harmless', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    let resolveLate!: (value: string) => void;
    let rejectLate!: (error: Error) => void;

    const slow = runWithProviderTimeout(
      ({ signal: s }) => {
        signal = s;
        return new Promise<string>((resolve, reject) => {
          resolveLate = resolve;
          rejectLate = reject;
        });
      },
      25,
      Date.now()
    );

    const assertion = expect(slow).rejects.toMatchObject({ code: 'timeout' });
    await jest.advanceTimersByTimeAsync(25);
    await assertion;
    expect(signal?.aborted).toBe(true);

    expect(() => resolveLate('late')).not.toThrow();
    expect(() => rejectLate(new Error('late-reject'))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('clears the timeout timer after provider success', async () => {
    jest.useFakeTimers();
    const pending = runWithProviderTimeout(async () => 'ok', 10_000, Date.now());
    await expect(pending).resolves.toBe('ok');
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('CORS origin gate', () => {
  it('allows approved origin and rejects disallowed / empty allowlist browser origins', () => {
    const ok = evaluateRequestOrigin('https://app.spendwise.example', 'https://app.spendwise.example');
    expect(ok.allowed).toBe(true);
    expect(ok.headers['Access-Control-Allow-Origin']).toBe('https://app.spendwise.example');
    expect(ok.headers.Vary).toBe('Origin');

    const bad = evaluateRequestOrigin('https://evil.example', 'https://app.spendwise.example');
    expect(bad.allowed).toBe(false);
    expect(bad.headers['Access-Control-Allow-Origin']).toBeUndefined();

    const empty = evaluateRequestOrigin('https://app.spendwise.example', '');
    expect(empty.allowed).toBe(false);

    const star = parseCorsAllowlist('*, https://ok.example');
    expect(star).toEqual(['https://ok.example']);

    const native = evaluateRequestOrigin(null, '');
    expect(native.allowed).toBe(true);
  });

  it('rejects disallowed Origin before provider invocation', async () => {
    const provider: FinancialAiProvider = {
      id: 'mock',
      generateMonthlySummary: jest.fn(),
      suggestBudgets: jest.fn(),
      categorizeMerchant: jest.fn(),
    };
    const res = await invoke(summaryBody(), {
      provider,
      origin: 'https://evil.example',
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe('origin_not_allowed');
    expect(provider.generateMonthlySummary).not.toHaveBeenCalled();
    assertNoSensitiveLeak(JSON.stringify(json));
  });

  it('rejects disallowed OPTIONS and allows approved OPTIONS with exact headers', async () => {
    const denied = await invoke(null, {
      method: 'OPTIONS',
      origin: 'https://evil.example',
      contentType: null,
      auth: null,
    });
    expect(denied.status).toBe(403);

    const allowed = await invoke(null, {
      method: 'OPTIONS',
      origin: 'https://app.spendwise.example',
      contentType: null,
      auth: null,
    });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://app.spendwise.example');
    expect(allowed.headers.get('Vary')).toBe('Origin');
  });

  it('allows originless native requests', async () => {
    const res = await invoke(summaryBody(), {
      provider: new UnavailableFinancialAiProvider(),
    });
    expect(res.status).toBe(503);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('handleFinancialAssistantRequest', () => {
  it('requires auth; rejects API keys as bearer; returns provider_unavailable', async () => {
    const unauth = await invoke(summaryBody(), { auth: null });
    expect(unauth.status).toBe(401);
    expect(() => extractBearerToken('Bearer sb_secret_test')).toThrow(/user session JWT/);

    const res = await invoke(summaryBody());
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error.code).toBe('provider_unavailable');
    assertNoSensitiveLeak(JSON.stringify(json));
  });

  it('passes AbortSignal and deadline into a successful provider call', async () => {
    let context: ProviderRequestContext | undefined;
    const provider: FinancialAiProvider = {
      id: 'mock',
      async generateMonthlySummary(_input, ctx) {
        context = ctx;
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
    expect(context?.signal).toBeInstanceOf(AbortSignal);
    expect(context?.signal.aborted).toBe(false);
    expect(typeof context?.deadlineMs).toBe('number');
    expect(context!.deadlineMs).toBeGreaterThan(NOW_MS);
  });

  it('times out, aborts signal, and ignores late provider completion', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    let resolveLate!: (value: {
      headline: string;
      bullets: string[];
      interpretations: [];
      suggestedActions: [];
      confidence: number;
    }) => void;

    const provider: FinancialAiProvider = {
      id: 'slow',
      generateMonthlySummary(_input, ctx) {
        signal = ctx.signal;
        return new Promise((resolve) => {
          resolveLate = resolve;
        });
      },
      suggestBudgets: jest.fn(),
      categorizeMerchant: jest.fn(),
    };

    const pending = invoke(summaryBody(), { provider, providerTimeoutMs: 20 });
    const assertion = expect(pending).resolves.toMatchObject({ status: 504 });
    await jest.advanceTimersByTimeAsync(20);
    const res = await pending;
    await assertion;
    const json = await res.json();
    expect(json.error.code).toBe('timeout');
    expect(signal?.aborted).toBe(true);
    expect(() =>
      resolveLate({
        headline: 'late',
        bullets: ['x'],
        interpretations: [],
        suggestedActions: [],
        confidence: 0.5,
      })
    ).not.toThrow();
    await Promise.resolve();
    assertNoSensitiveLeak(JSON.stringify(json));
  });

  it('returns 405 / 415 for method and content-type; rate limits', async () => {
    expect((await invoke(summaryBody(), { method: 'GET' })).status).toBe(405);
    expect((await invoke(summaryBody(), { contentType: 'text/plain' })).status).toBe(415);

    for (let i = 0; i < 20; i += 1) {
      const res = await invoke(summaryBody(), { provider: new UnavailableFinancialAiProvider() });
      expect([503, 429]).toContain(res.status);
    }
    const limited = await invoke(summaryBody(), { provider: new UnavailableFinancialAiProvider() });
    expect(limited.status).toBe(429);
  });

  it('rejects invented categorize categories as invalid_model_output', async () => {
    const provider: FinancialAiProvider = {
      id: 'mock',
      generateMonthlySummary: jest.fn(),
      suggestBudgets: jest.fn(),
      async categorizeMerchant() {
        return {
          suggestions: [
            { categoryId: 'food', confidence: 0.9, reason: 'Cafe' },
            { categoryId: 'injected', confidence: 0.99, reason: 'bad' },
          ],
        };
      },
    };
    const res = await invoke(categorizeBody(), { provider });
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('invalid_model_output');
  });
});

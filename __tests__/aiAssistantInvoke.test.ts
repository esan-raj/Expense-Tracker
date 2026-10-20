/// <reference types="jest" />

jest.mock('@/utils/id', () => ({ createId: () => '11111111-1111-4111-8111-111111111111' }));

import type { AiSafeFinancialSnapshot } from '@/services/financialIntelligence';
import { AiClientError } from '@/services/aiAssistant/errors';
import { buildMonthlySummaryRequest } from '@/services/aiAssistant/buildRequests';
import {
  invokeFinancialAssistant,
  resetAiInvokeStateForTests,
  type AiInvokeTransport,
} from '@/services/aiAssistant/invokeFinancialAssistant';

const CONSENT = { cloudAi: true as const, policyVersion: 1 as const };

type InvokeResult = { data: unknown; error: unknown };

function aiSafeSnapshot(): AiSafeFinancialSnapshot {
  return {
    schemaVersion: 1,
    kind: 'ai_safe',
    snapshotId: 'snap_abcd1234_0',
    snapshotComputedAt: '2026-10-18T12:00:00.000Z',
    financeRevision: 0,
    contentRevision: 'rev-1',
    currency: 'INR',
    period: { month: 9, year: 2026 },
    periodStatus: 'completed',
    overallBudget: { amountMinor: 1, source: 'none' },
    totals: {
      incomeMinor: 1,
      expenseMinor: 1,
      netMinor: 0,
      savingsRatePercent: 0,
      averageDailyExpenseMinor: null,
      averageDailyMethod: 'unavailable',
      projectedMonthEndExpenseMinor: null,
      projectedMonthEndMethod: 'unavailable',
      expenseDayCount: 0,
      divisorDays: null,
    },
    previousPeriod: null,
    topCategories: [],
    budgets: [],
    trends: [],
    recurringPatterns: [],
    anomalies: [],
    budgetBaseline: {
      lookbackMonths: 1,
      overall: {
        currentBudgetMinor: null,
        averageSpendMinor: 1,
        medianSpendMinor: 1,
        source: 'none',
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
      utf8Bytes: 100,
      maxUtf8Bytes: 8192,
      dropped: {},
      exceededLimit: false,
      reason: null,
    },
  };
}

function body() {
  return buildMonthlySummaryRequest({
    snapshot: aiSafeSnapshot(),
    locale: 'en-IN',
    consent: CONSENT,
  });
}

/** Wait until the transport invoke has been entered (past session/consent gates). */
async function waitForInvoke(invoke: jest.Mock, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (invoke.mock.calls.length === 0) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('invoke was not called');
    }
    await Promise.resolve();
  }
}

describe('invokeFinancialAssistant', () => {
  beforeEach(() => {
    resetAiInvokeStateForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
    resetAiInvokeStateForTests();
  });

  it('rejects signed-out requests locally', async () => {
    const transport: AiInvokeTransport = {
      invoke: jest.fn(),
      getSessionUserId: async () => null,
    };
    await expect(
      invokeFinancialAssistant({
        body: body(),
        userInitiated: true,
        transport,
        recheckConsent: async () => CONSENT,
        getUserId: () => 'u1',
        getGeneration: () => 1,
      })
    ).rejects.toMatchObject({ kind: 'signed_out' });
    expect(transport.invoke).not.toHaveBeenCalled();
  });

  it('rejects disabled consent locally', async () => {
    const transport: AiInvokeTransport = {
      invoke: jest.fn(),
      getSessionUserId: async () => 'u1',
    };
    await expect(
      invokeFinancialAssistant({
        body: body(),
        userInitiated: true,
        transport,
        recheckConsent: async () => {
          throw new AiClientError('opt_in_required', 'off');
        },
        getUserId: () => 'u1',
        getGeneration: () => 1,
      })
    ).rejects.toMatchObject({ kind: 'opt_in_required' });
    expect(transport.invoke).not.toHaveBeenCalled();
  });

  it('rejects when consent is revoked between preparation and invocation', async () => {
    let checks = 0;
    const transport: AiInvokeTransport = {
      invoke: jest.fn(async () => ({ data: { ok: true }, error: null })),
      getSessionUserId: async () => 'u1',
    };
    await expect(
      invokeFinancialAssistant({
        body: body(),
        userInitiated: true,
        transport,
        recheckConsent: async () => {
          checks += 1;
          if (checks >= 2) throw new AiClientError('opt_in_required', 'revoked');
          return CONSENT;
        },
        getUserId: () => 'u1',
        getGeneration: () => 1,
      })
    ).rejects.toMatchObject({ kind: 'opt_in_required' });
    expect(transport.invoke).not.toHaveBeenCalled();
  });

  it('requires explicit userInitiated flag', async () => {
    await expect(
      invokeFinancialAssistant({
        body: body(),
        // @ts-expect-error intentional
        userInitiated: false,
        transport: { invoke: jest.fn(), getSessionUserId: async () => 'u1' },
        recheckConsent: async () => CONSENT,
        getUserId: () => 'u1',
        getGeneration: () => 1,
      })
    ).rejects.toMatchObject({ kind: 'invalid_request' });
  });

  it('performs authenticated invocation via injected transport', async () => {
    const invoke = jest.fn(async (_name: string, options: { body: Record<string, unknown> }) => {
      expect(options.body).not.toHaveProperty('accessToken');
      expect(options.body).not.toHaveProperty('refreshToken');
      expect(options.body.consent).toEqual(CONSENT);
      return { data: { schemaVersion: 1, result: { headline: 'ok' } }, error: null };
    });
    const result = await invokeFinancialAssistant({
      body: body(),
      userInitiated: true,
      transport: { invoke, getSessionUserId: async () => 'u1' },
      recheckConsent: async () => CONSENT,
      getUserId: () => 'u1',
      getGeneration: () => 1,
    });
    expect(result.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith('financial-assistant', expect.any(Object));
  });

  it('supports cancellation', async () => {
    const controller = new AbortController();
    const invoke = jest.fn(async (_n, options) => {
      await new Promise<void>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
      return { data: null, error: null };
    });
    const transport: AiInvokeTransport = {
      invoke,
      getSessionUserId: async () => 'u1',
    };
    const pending = invokeFinancialAssistant({
      body: body(),
      userInitiated: true,
      signal: controller.signal,
      transport,
      recheckConsent: async () => CONSENT,
      getUserId: () => 'u1',
      getGeneration: () => 1,
    });
    await waitForInvoke(invoke as jest.Mock);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('enforces client timeout', async () => {
    const invoke = jest.fn(async (_n, options) => {
      await new Promise<void>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
      return { data: null, error: null };
    });
    const transport: AiInvokeTransport = {
      invoke,
      getSessionUserId: async () => 'u1',
    };
    const pending = invokeFinancialAssistant({
      body: body(),
      userInitiated: true,
      timeoutMs: 40,
      transport,
      recheckConsent: async () => CONSENT,
      getUserId: () => 'u1',
      getGeneration: () => 1,
    });
    await waitForInvoke(invoke as jest.Mock);
    await expect(pending).rejects.toMatchObject({ kind: 'timeout' });
  }, 10000);

  it('ignores late response after logout', async () => {
    let userId: string | null = 'u1';
    const holder: { resolve: ((value: InvokeResult) => void) | null } = { resolve: null };
    const invoke = jest.fn(
      () =>
        new Promise<InvokeResult>((resolve) => {
          holder.resolve = resolve;
        })
    );
    const transport: AiInvokeTransport = {
      invoke,
      getSessionUserId: async () => 'u1',
    };
    const pending = invokeFinancialAssistant({
      body: body(),
      userInitiated: true,
      transport,
      recheckConsent: async () => CONSENT,
      getUserId: () => userId,
      getGeneration: () => 1,
    });
    await waitForInvoke(invoke as jest.Mock);
    userId = null;
    holder.resolve?.({ data: { ok: true }, error: null });
    await expect(pending).rejects.toMatchObject({ kind: 'stale_session' });
  });

  it('ignores late response after account switch', async () => {
    let generation = 1;
    const holder: { resolve: ((value: InvokeResult) => void) | null } = { resolve: null };
    const invoke = jest.fn(
      () =>
        new Promise<InvokeResult>((resolve) => {
          holder.resolve = resolve;
        })
    );
    const transport: AiInvokeTransport = {
      invoke,
      getSessionUserId: async () => 'u1',
    };
    const pending = invokeFinancialAssistant({
      body: body(),
      userInitiated: true,
      transport,
      recheckConsent: async () => CONSENT,
      getUserId: () => 'u1',
      getGeneration: () => generation,
    });
    await waitForInvoke(invoke as jest.Mock);
    generation = 2;
    holder.resolve?.({ data: { ok: true }, error: null });
    await expect(pending).rejects.toMatchObject({ kind: 'stale_session' });
  });

  it('ignores stale response after a newer request for the same capability', async () => {
    const holder: { resolveFirst: ((value: InvokeResult) => void) | null } = { resolveFirst: null };
    const invoke: AiInvokeTransport['invoke'] = jest
      .fn<Promise<InvokeResult>, [string, { body: Record<string, unknown>; signal?: AbortSignal }]>()
      .mockImplementationOnce(
        () =>
          new Promise<InvokeResult>((resolve) => {
            holder.resolveFirst = resolve;
          })
      )
      .mockImplementationOnce(async () => ({ data: { second: true }, error: null }));

    const transport: AiInvokeTransport = {
      invoke,
      getSessionUserId: async () => 'u1',
    };

    const firstBody = buildMonthlySummaryRequest({
      snapshot: { ...aiSafeSnapshot(), contentRevision: 'rev-a' },
      locale: 'en-IN',
      consent: CONSENT,
    });
    const secondBody = buildMonthlySummaryRequest({
      snapshot: { ...aiSafeSnapshot(), contentRevision: 'rev-b' },
      locale: 'en-IN',
      consent: CONSENT,
    });

    const first = invokeFinancialAssistant({
      body: firstBody,
      userInitiated: true,
      transport,
      recheckConsent: async () => CONSENT,
      getUserId: () => 'u1',
      getGeneration: () => 1,
    });
    await waitForInvoke(invoke as unknown as jest.Mock);
    const second = await invokeFinancialAssistant({
      body: secondBody,
      userInitiated: true,
      transport,
      recheckConsent: async () => CONSENT,
      getUserId: () => 'u1',
      getGeneration: () => 1,
    });
    expect(second.ok).toBe(true);
    holder.resolveFirst?.({ data: { first: true }, error: null });
    await expect(first).rejects.toMatchObject({ kind: 'stale_session' });
  });

  it('deduplicates identical concurrent requests', async () => {
    const holder: { resolve: ((value: InvokeResult) => void) | null } = { resolve: null };
    const invoke: AiInvokeTransport['invoke'] = jest.fn(
      () =>
        new Promise<InvokeResult>((resolve) => {
          holder.resolve = resolve;
        })
    );
    const transport: AiInvokeTransport = {
      invoke,
      getSessionUserId: async () => 'u1',
    };
    const shared = body();
    const a = invokeFinancialAssistant({
      body: shared,
      userInitiated: true,
      transport,
      recheckConsent: async () => CONSENT,
      getUserId: () => 'u1',
      getGeneration: () => 1,
    });
    const b = invokeFinancialAssistant({
      body: shared,
      userInitiated: true,
      transport,
      recheckConsent: async () => CONSENT,
      getUserId: () => 'u1',
      getGeneration: () => 1,
    });
    await waitForInvoke(invoke as jest.Mock);
    expect(invoke).toHaveBeenCalledTimes(1);
    holder.resolve?.({ data: { schemaVersion: 1 }, error: null });
    await expect(Promise.all([a, b])).resolves.toHaveLength(2);
  });

  it('maps Edge errors safely without fake success', async () => {
    const transport: AiInvokeTransport = {
      invoke: jest.fn(async () => ({
        data: { error: { code: 'provider_unavailable', message: 'unavailable' } },
        error: null,
      })),
      getSessionUserId: async () => 'u1',
    };
    await expect(
      invokeFinancialAssistant({
        body: body(),
        userInitiated: true,
        transport,
        recheckConsent: async () => CONSENT,
        getUserId: () => 'u1',
        getGeneration: () => 1,
      })
    ).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('never logs payloads, tokens, or free text', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const transport: AiInvokeTransport = {
      invoke: jest.fn(async () => ({ data: { ok: true }, error: null })),
      getSessionUserId: async () => 'u1',
    };
    await invokeFinancialAssistant({
      body: body(),
      userInitiated: true,
      transport,
      recheckConsent: async () => CONSENT,
      getUserId: () => 'u1',
      getGeneration: () => 1,
    });
    const joined = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ');
    expect(joined).not.toMatch(/rev-1|accessToken|Bearer|alice@/i);
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

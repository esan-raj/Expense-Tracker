import type { AuthDeps } from './auth.ts';
import { requireUser } from './auth.ts';
import { MAX_RESPONSE_UTF8_BYTES } from './constants.ts';
import { evaluateRequestOrigin, jsonResponse } from './cors.ts';
import { FinancialAssistantError, errorResponse, httpStatusFor } from './errors.ts';
import { utf8ByteLength } from './privacy.ts';
import type { FinancialAiProvider } from './provider.ts';
import { resolveProvider } from './provider.ts';
import { assertWithinRateLimit } from './rateLimit.ts';
import { runWithProviderTimeout } from './timeout.ts';
import type { AiAssistantResponse, ProviderRequestContext } from './types.ts';
import {
  assertJsonContentType,
  isSnapshotStale,
  parseAndValidateRequest,
} from './validateRequest.ts';
import {
  assertResponseSize,
  validateBudgetSuggestionResult,
  validateMerchantCategorisationResult,
  validateMonthlySummaryResult,
} from './validateResponse.ts';

export type HandlerDeps = AuthDeps & {
  getEnv: (key: string) => string | undefined;
  now?: () => Date;
  provider?: FinancialAiProvider;
  providerTimeoutMs?: number;
};

function snapshotIdOf(request: ReturnType<typeof parseAndValidateRequest>): string {
  return request.capability === 'categorize_merchant' ? request.snapshotId : request.snapshot.snapshotId;
}

function computedAtOf(request: ReturnType<typeof parseAndValidateRequest>): string {
  return request.capability === 'categorize_merchant'
    ? request.snapshotComputedAt
    : request.snapshot.snapshotComputedAt;
}

/**
 * Core Edge Function handler — portable for Jest.
 * Does not call paid providers when FINANCIAL_AI_PROVIDER=unavailable (default).
 */
export async function handleFinancialAssistantRequest(
  req: Request,
  deps: HandlerDeps
): Promise<Response> {
  const originGate = evaluateRequestOrigin(
    req.headers.get('Origin'),
    deps.getEnv('FINANCIAL_AI_CORS_ORIGINS')
  );
  const cors = originGate.headers;

  if (!originGate.allowed) {
    const body = errorResponse(
      '00000000-0000-4000-8000-000000000000',
      'origin_not_allowed',
      'Origin is not allowed'
    );
    return jsonResponse(body, 403, cors, { 'Cache-Control': 'no-store' });
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  let requestId = '00000000-0000-4000-8000-000000000000';

  try {
    if (req.method !== 'POST') {
      throw new FinancialAssistantError('invalid_request', 'Only POST is supported', 405);
    }

    assertJsonContentType(req.headers.get('Content-Type'));

    const user = await requireUser(req.headers.get('Authorization'), deps);
    const now = deps.now?.() ?? new Date();
    assertWithinRateLimit(user.id, now.getTime());

    const rawBody = await req.text();
    const request = parseAndValidateRequest(rawBody, now.getTime());
    requestId = request.requestId;

    const stale = isSnapshotStale(computedAtOf(request), now.getTime());

    if (request.capability === 'monthly_summary' && request.snapshot.flags.hasExpenses !== true) {
      throw new FinancialAssistantError(
        'invalid_request',
        'Insufficient expense data for monthly_summary',
        400
      );
    }
    if (request.capability === 'budget_suggestions') {
      const lookback = request.snapshot.budgetBaseline.lookbackMonths;
      const avg = request.snapshot.budgetBaseline.overall.averageSpendMinor;
      if (lookback < 1 || avg <= 0) {
        throw new FinancialAssistantError(
          'invalid_request',
          'Insufficient lookback spend for budget_suggestions',
          400
        );
      }
    }

    const provider =
      deps.provider ?? resolveProvider(deps.getEnv('FINANCIAL_AI_PROVIDER') ?? 'unavailable');

    const result = await runWithProviderTimeout(
      async ({ signal, deadlineMs }) => {
        const context: ProviderRequestContext = {
          requestId: request.requestId,
          userId: user.id,
          locale: request.locale,
          currency: request.currency,
          capability: request.capability,
          signal,
          deadlineMs,
        };

        if (request.capability === 'monthly_summary') {
          return validateMonthlySummaryResult(
            await provider.generateMonthlySummary({ snapshot: request.snapshot }, context),
            request.snapshot
          );
        }
        if (request.capability === 'budget_suggestions') {
          return validateBudgetSuggestionResult(
            await provider.suggestBudgets({ snapshot: request.snapshot }, context),
            request.snapshot
          );
        }
        if (request.capability === 'categorize_merchant') {
          return validateMerchantCategorisationResult(
            await provider.categorizeMerchant({ payload: request.payload }, context),
            request.payload
          );
        }
        throw new FinancialAssistantError('invalid_request', 'capability invalid', 400);
      },
      deps.providerTimeoutMs,
      now.getTime()
    );

    const success: AiAssistantResponse = {
      schemaVersion: 1,
      requestId: request.requestId,
      snapshotId: snapshotIdOf(request),
      generatedAt: now.toISOString(),
      stale,
      capability: request.capability,
      result,
    };

    const encoded = JSON.stringify(success);
    assertResponseSize(encoded);
    return jsonResponse(success, 200, cors, {
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
  } catch (error) {
    if (error instanceof FinancialAssistantError) {
      const body = errorResponse(requestId, error.code, error.message);
      const encoded = JSON.stringify(body);
      if (utf8ByteLength(encoded) > MAX_RESPONSE_UTF8_BYTES) {
        return jsonResponse(
          errorResponse(requestId, error.code, 'Error response truncated'),
          httpStatusFor(error.code),
          cors
        );
      }
      return jsonResponse(body, error.httpStatus || httpStatusFor(error.code), cors, {
        'Cache-Control': 'no-store',
      });
    }

    return jsonResponse(
      errorResponse(requestId, 'provider_unavailable', 'Unexpected assistant failure'),
      500,
      cors,
      { 'Cache-Control': 'no-store' }
    );
  }
}

import type { AuthDeps } from './auth.ts';
import { requireUser } from './auth.ts';
import { MAX_RESPONSE_UTF8_BYTES } from './constants.ts';
import { CORS_HEADERS, jsonResponse } from './cors.ts';
import { FinancialAssistantError, errorResponse, httpStatusFor } from './errors.ts';
import { utf8ByteLength } from './privacy.ts';
import type { FinancialAiProvider } from './provider.ts';
import { resolveProvider } from './provider.ts';
import { assertWithinRateLimit } from './rateLimit.ts';
import type { AiAssistantResponse, ProviderRequestContext } from './types.ts';
import { isSnapshotStale, parseAndValidateRequest } from './validateRequest.ts';
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 204, headers: CORS_HEADERS });
  }

  let requestId = '00000000-0000-4000-8000-000000000000';

  try {
    if (req.method !== 'POST') {
      throw new FinancialAssistantError('invalid_request', 'Only POST is supported', 400);
    }

    const user = await requireUser(req.headers.get('Authorization'), deps);
    assertWithinRateLimit(user.id, (deps.now?.() ?? new Date()).getTime());

    const rawBody = await req.text();
    const request = parseAndValidateRequest(rawBody);
    requestId = request.requestId;

    const now = deps.now?.() ?? new Date();
    const stale = isSnapshotStale(computedAtOf(request), now.getTime());

    // Insufficient-data short-circuit before provider (spec F4).
    if (request.capability === 'monthly_summary' && request.snapshot.flags.hasExpenses !== true) {
      throw new FinancialAssistantError(
        'invalid_request',
        'Insufficient expense data for monthly_summary',
        400
      );
    }
    if (request.capability === 'budget_suggestions') {
      const baseline = request.snapshot.budgetBaseline as
        | { lookbackMonths?: number; overall?: { averageSpendMinor?: number } }
        | undefined;
      const lookback = typeof baseline?.lookbackMonths === 'number' ? baseline.lookbackMonths : 0;
      const avg = baseline?.overall?.averageSpendMinor ?? 0;
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

    const context: ProviderRequestContext = {
      requestId: request.requestId,
      userId: user.id,
      locale: request.locale,
      currency: request.currency,
      capability: request.capability,
    };

    let result: unknown;
    if (request.capability === 'monthly_summary') {
      result = validateMonthlySummaryResult(
        await provider.generateMonthlySummary({ snapshot: request.snapshot }, context)
      );
    } else if (request.capability === 'budget_suggestions') {
      result = validateBudgetSuggestionResult(
        await provider.suggestBudgets({ snapshot: request.snapshot }, context)
      );
    } else if (request.capability === 'categorize_merchant') {
      result = validateMerchantCategorisationResult(
        await provider.categorizeMerchant({ payload: request.payload }, context),
        request.payload
      );
    } else {
      throw new FinancialAssistantError('invalid_request', 'capability invalid', 400);
    }

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
    return jsonResponse(success, 200, {
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
          httpStatusFor(error.code)
        );
      }
      return jsonResponse(body, error.httpStatus || httpStatusFor(error.code), {
        'Cache-Control': 'no-store',
      });
    }

    // Do not leak internal exception text (may contain env/provider details).
    return jsonResponse(errorResponse(requestId, 'provider_unavailable', 'Unexpected assistant failure'), 500, {
      'Cache-Control': 'no-store',
    });
  }
}

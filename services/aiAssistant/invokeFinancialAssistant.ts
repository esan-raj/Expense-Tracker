import { getCurrentUserId, getSessionGeneration } from '@/database/session';
import { supabase } from '@/services/supabase';
import { requireCloudAiConsentWire } from './consent';
import {
  AI_CLIENT_TIMEOUT_MS,
  FINANCIAL_ASSISTANT_FUNCTION,
  type AiCapability,
} from './constants';
import { AiClientError, mapEdgeErrorToClient } from './errors';
import type { FinancialAssistantClientRequest } from './buildRequests';
import { serializeAiRequest } from './buildRequests';

export type AiInvokeTransport = {
  /**
   * Prefer supabase.functions.invoke so the signed-in user JWT is attached automatically.
   * Must not put tokens into the JSON body.
   */
  invoke: (
    functionName: string,
    options: { body: Record<string, unknown>; signal?: AbortSignal }
  ) => Promise<{ data: unknown; error: unknown; response?: Response | null }>;
  getSessionUserId: () => Promise<string | null>;
};

export type InvokeFinancialAssistantOptions = {
  body: FinancialAssistantClientRequest;
  /** Explicit user action required — callers must pass true. */
  userInitiated: true;
  signal?: AbortSignal;
  timeoutMs?: number;
  transport?: AiInvokeTransport;
  /** For tests: override consent recheck. */
  recheckConsent?: () => Promise<unknown>;
  getUserId?: () => string | null;
  getGeneration?: () => number;
};

export type AiInvokeSuccess = {
  ok: true;
  data: unknown;
  requestId: string;
  capability: AiCapability;
};

let inflight = new Map<string, Promise<AiInvokeSuccess>>();
const capabilityEpoch = new Map<AiCapability, number>();

function dedupeKey(body: FinancialAssistantClientRequest): string {
  if (body.capability === 'categorize_merchant') {
    return `${body.capability}:${serializeAiRequest({ ...body, requestId: '_' })}`;
  }
  return `${body.capability}:${body.snapshot.contentRevision}`;
}

function bumpCapabilityEpoch(capability: AiCapability): number {
  const next = (capabilityEpoch.get(capability) ?? 0) + 1;
  capabilityEpoch.set(capability, next);
  return next;
}

function createDefaultTransport(): AiInvokeTransport {
  return {
    invoke: async (functionName, options) => {
      const result = await supabase.functions.invoke(functionName, {
        body: options.body,
        ...(options.signal ? { signal: options.signal } : {}),
      } as Parameters<typeof supabase.functions.invoke>[1]);
      return {
        data: result.data,
        error: result.error,
        response: (result as { response?: Response | null }).response ?? null,
      };
    },
    getSessionUserId: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.user?.id ?? null;
    },
  };
}

function extractEdgeCode(data: unknown, error: unknown): { status?: number; code?: string } {
  if (data && typeof data === 'object' && 'error' in data) {
    const err = (data as { error?: { code?: string } }).error;
    if (err?.code) return { code: err.code };
  }
  if (error && typeof error === 'object') {
    const e = error as { context?: { status?: number }; status?: number; message?: string };
    const status = e.context?.status ?? e.status;
    const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';
    if (message.includes('provider_unavailable')) return { status, code: 'provider_unavailable' };
    if (message.includes('opt_in')) return { status, code: 'opt_in_required' };
    if (message.includes('rate')) return { status, code: 'rate_limit' };
    return { status };
  }
  return {};
}

/**
 * Authenticated invoke of financial-assistant.
 * Never call automatically — requires userInitiated: true.
 * Late responses after logout / account switch / newer request / consent revoke are ignored.
 */
export async function invokeFinancialAssistant(
  options: InvokeFinancialAssistantOptions
): Promise<AiInvokeSuccess> {
  if (options.userInitiated !== true) {
    throw new AiClientError('invalid_request', 'Explicit user action required', { retryable: false });
  }

  const transport = options.transport ?? createDefaultTransport();
  const getUserId = options.getUserId ?? getCurrentUserId;
  const getGeneration = options.getGeneration ?? getSessionGeneration;
  const recheckConsent = options.recheckConsent ?? requireCloudAiConsentWire;

  const sessionUserId = await transport.getSessionUserId();
  const localUserId = getUserId();
  if (!sessionUserId || !localUserId || sessionUserId !== localUserId) {
    throw new AiClientError('signed_out', 'Sign in required', { retryable: false });
  }

  // Recheck consent immediately before network (not only at screen open / build time).
  await recheckConsent();

  const startUserId = localUserId;
  const startGeneration = getGeneration();
  const key = dedupeKey(options.body);

  const existing = inflight.get(key);
  if (existing) {
    return existing;
  }

  const epoch = bumpCapabilityEpoch(options.body.capability);

  const run = (async (): Promise<AiInvokeSuccess> => {
    const timeoutMs = options.timeoutMs ?? AI_CLIENT_TIMEOUT_MS;
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onExternalAbort);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      // Final consent gate immediately before transport.
      await recheckConsent();

      if (getUserId() !== startUserId || getGeneration() !== startGeneration) {
        throw new AiClientError('stale_session', 'Session changed before request', { retryable: false });
      }

      const bodyRecord = JSON.parse(serializeAiRequest(options.body)) as Record<string, unknown>;

      let data: unknown;
      let error: unknown;
      try {
        const result = await transport.invoke(FINANCIAL_ASSISTANT_FUNCTION, {
          body: bodyRecord,
          signal: controller.signal,
        });
        data = result.data;
        error = result.error;
      } catch {
        if (controller.signal.aborted) {
          throw mapEdgeErrorToClient({ aborted: !timedOut, timedOut });
        }
        throw new AiClientError('network', 'Network request failed', { retryable: false });
      }

      if (controller.signal.aborted) {
        throw mapEdgeErrorToClient({ aborted: !timedOut, timedOut });
      }

      if (
        getUserId() !== startUserId ||
        getGeneration() !== startGeneration ||
        capabilityEpoch.get(options.body.capability) !== epoch
      ) {
        throw new AiClientError('stale_session', 'Response ignored after session or request change', {
          retryable: false,
        });
      }

      try {
        await recheckConsent();
      } catch {
        throw new AiClientError('opt_in_required', 'Cloud AI consent was revoked', { retryable: false });
      }

      if (error) {
        throw mapEdgeErrorToClient(extractEdgeCode(data, error));
      }

      if (data && typeof data === 'object' && 'error' in data) {
        throw mapEdgeErrorToClient(extractEdgeCode(data, null));
      }

      return {
        ok: true,
        data,
        requestId: options.body.requestId,
        capability: options.body.capability,
      };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
      inflight.delete(key);
    }
  })();

  inflight.set(key, run);
  return run;
}

/** Test helper — clears concurrent-dedupe and epoch state. */
export function resetAiInvokeStateForTests(): void {
  inflight = new Map();
  capabilityEpoch.clear();
}

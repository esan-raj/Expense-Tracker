export type AiClientErrorKind =
  | 'signed_out'
  | 'opt_in_required'
  | 'unsupported_policy'
  | 'invalid_request'
  | 'timeout'
  | 'cancelled'
  | 'unavailable'
  | 'auth'
  | 'rate_limit'
  | 'stale_session'
  | 'network'
  | 'unknown';

export class AiClientError extends Error {
  readonly kind: AiClientErrorKind;
  readonly retryable: boolean;

  constructor(kind: AiClientErrorKind, message: string, options?: { retryable?: boolean }) {
    super(message);
    this.name = 'AiClientError';
    this.kind = kind;
    this.retryable = options?.retryable ?? false;
  }
}

/** Map Edge / transport failures to safe client kinds — no server internals. */
export function mapEdgeErrorToClient(input: {
  status?: number;
  code?: string;
  aborted?: boolean;
  timedOut?: boolean;
}): AiClientError {
  if (input.aborted) {
    return new AiClientError('cancelled', 'Request was cancelled', { retryable: false });
  }
  if (input.timedOut) {
    return new AiClientError('timeout', 'The request timed out', { retryable: false });
  }

  const code = (input.code ?? '').toLowerCase();
  if (code === 'opt_in_required') {
    return new AiClientError('opt_in_required', 'Cloud AI consent is required', { retryable: false });
  }
  if (code === 'provider_unavailable') {
    return new AiClientError('unavailable', 'AI assistant is unavailable', { retryable: false });
  }
  if (code === 'rate_limit') {
    return new AiClientError('rate_limit', 'Too many requests. Try again later.', { retryable: false });
  }
  if (code === 'auth' || input.status === 401 || input.status === 403) {
    return new AiClientError('auth', 'Sign in required', { retryable: false });
  }
  if (code === 'invalid_request' || code === 'invalid_model_output') {
    return new AiClientError('invalid_request', 'The request could not be completed', { retryable: false });
  }
  if (code === 'stale_snapshot') {
    return new AiClientError('invalid_request', 'Financial data is stale. Refresh and try again.', {
      retryable: false,
    });
  }
  if (input.status != null && input.status >= 500) {
    return new AiClientError('unavailable', 'AI assistant is unavailable', { retryable: false });
  }
  return new AiClientError('unknown', 'The request could not be completed', { retryable: false });
}
